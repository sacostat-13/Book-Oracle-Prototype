// Anthropic Claude proxy — with Oracle quota enforcement.
//
// Security model (v0.39 hardening):
//   1. The JWT is VERIFIED against Supabase Auth (signature + expiry), not
//      just decoded. A forged `sub` no longer works.
//   2. Quota FAILS CLOSED: if the quota lookup errors or returns nothing,
//      the call is denied (503) instead of proceeding unmetered.
//   3. `model` is allowlisted, `maxTokens` is clamped, and prompt/system
//      prompt sizes are capped, so cost-per-call is bounded.
//   4. CORS is restricted to known origins (see _shared/auth.js).
//   4b. `source` (the label shown in the user's call history) is allowlisted
//       independently of `feature`, so labelling a surface can never widen the
//       curator exemption.
//   5. Quota-skip for local dev only applies under `netlify dev`
//      (NETLIFY_DEV=true). In production, missing Supabase env vars is a
//      hard 503 — never an open proxy.
//
// Flow:
//   1. Parse and validate request body.
//   2. Verify JWT → check quota via get_oracle_quota (read-only).
//      Return 402 if exceeded, 503 if quota can't be determined.
//   3. Forward to Anthropic.
//   4. Only on Anthropic 2xx, consume one call via consume_oracle_call —
//      a failed Anthropic call never costs the user a quota slot.
//
// Required env vars (Netlify → Site → Environment variables):
//   ANTHROPIC_API_KEY
//   SUPABASE_URL              (same value as VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY (secret — never expose client-side)

import { corsHeaders, bearerToken, verifySupabaseJwt } from './_shared/auth.js';

// ── Abuse limits ──────────────────────────────────────────────────────────────
// The app only ever uses the default model; categorization batches ask for up
// to 4000 output tokens (oracleCategorizationService.js).
const ALLOWED_MODELS = ['claude-sonnet-4-5', 'claude-haiku-4-5'];
const DEFAULT_MODEL = 'claude-sonnet-4-5';
const MAX_OUTPUT_TOKENS = 4000;
const MAX_PROMPT_CHARS = 50_000;
const MAX_SYSTEM_PROMPT_CHARS = 10_000;

// Book-identification search fallback (NavSearch). This is a FREE tier — it does
// NOT consume Oracle quota (searching for a book you may not read shouldn't burn
// a monthly call). To keep it cheap and abuse-resistant it is forced server-side
// to Haiku with a small output cap, and rate limited per user (below).
const SEARCH_MODEL = 'claude-haiku-4-5';
const SEARCH_MAX_TOKENS = 400;

// Per-user sliding-window limit for the free search tier. This lives in the warm
// Lambda's memory, so it's best-effort (not shared across concurrent instances)
// — acceptable as a throttle layered on top of the client-side cache + debounce.
// A durable, fleet-wide limit would need a Supabase table.
const SEARCH_WINDOW_MS = 60_000;
const SEARCH_MAX_PER_WINDOW = 15;
const searchHits = new Map(); // userId -> timestamps[]

function allowFreeSearch(userId) {
  const now = Date.now();
  const recent = (searchHits.get(userId) || []).filter((t) => now - t < SEARCH_WINDOW_MS);
  if (recent.length >= SEARCH_MAX_PER_WINDOW) {
    searchHits.set(userId, recent);
    return false;
  }
  recent.push(now);
  searchHits.set(userId, recent);
  if (searchHits.size > 5000) searchHits.clear(); // crude memory cap for long-warm instances
  return true;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are a literary book recommendation expert with deep knowledge of horror, gothic, literary fiction, and Latin American literature.';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const QUOTA_ENABLED = !!(supabaseUrl && serviceKey);
const IS_LOCAL_DEV = process.env.NETLIFY_DEV === 'true';

if (!QUOTA_ENABLED) {
  console.warn(
    'claude.js: Supabase env vars not set — ' +
      (IS_LOCAL_DEV ? 'quota disabled (netlify dev)' : 'requests will be REFUSED (fail closed)')
  );
}

async function supabaseRpc(rpcName, params) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`${rpcName} RPC error ${res.status}:`, text);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`${rpcName} fetch failed:`, String(e));
    return null;
  }
}

export async function handler(event) {
  const CORS = corsHeaders(event);
  const json = (statusCode, data) => ({
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  // ── 1. Parse + validate body ─────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON body' }); }

  const { prompt, systemPrompt } = body;
  if (!prompt || typeof prompt !== 'string') return json(400, { error: 'Missing prompt' });
  if (prompt.length > MAX_PROMPT_CHARS) return json(413, { error: 'Prompt too long' });
  if (systemPrompt && (typeof systemPrompt !== 'string' || systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS)) {
    return json(413, { error: 'System prompt too long' });
  }

  // ── Feature + run id (drive both the model choice and the quota flow) ────────
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const runId = typeof body.runId === 'string' && UUID_RE.test(body.runId) ? body.runId : null;

  // Allowlisted, not passed through. `feature` decides whether the curator
  // exemption applies, so an arbitrary client string must never reach the RPC.
  // 'search' is the FREE book-identification fallback: authenticated + rate
  // limited, but never charged against the Oracle quota.
  const EXEMPTIBLE_FEATURES = ['categorization'];
  const rawFeature = typeof body.feature === 'string' ? body.feature : null;
  const isFreeSearch = rawFeature === 'search';
  const feature = EXEMPTIBLE_FEATURES.includes(rawFeature) ? rawFeature : null;

  // v0.58: the label written to the user-visible call log (schema_v44).
  // Deliberately a SEPARATE parameter from `feature`, and allowlisted
  // separately. `feature` decides whether the curator exemption applies, so it
  // stays as narrow as it has always been; `source` is display metadata the
  // quota logic never reads. Splitting them means a new surface can be given a
  // history label without anyone having to reason about whether they have just
  // widened an exemption. Anything unrecognised logs as 'unknown' rather than
  // being echoed back — the log renders these strings.
  const LOGGED_SOURCES = [
    'spark', 'ask', 'similar', 'categories', 'plan',
    'categorization', 'club_poll', 'club_discussion',
  ];
  const rawSource = typeof body.source === 'string' ? body.source : null;
  const source = LOGGED_SOURCES.includes(rawSource) ? rawSource : 'unknown';

  // Free search is forced to the cheap model with a small output cap, whatever
  // the client asked for. Everything else uses the allowlisted default.
  const model = isFreeSearch
    ? SEARCH_MODEL
    : (ALLOWED_MODELS.includes(body.model) ? body.model : DEFAULT_MODEL);
  const maxTokens = isFreeSearch
    ? SEARCH_MAX_TOKENS
    : Math.min(Math.max(parseInt(body.maxTokens, 10) || 2000, 1), MAX_OUTPUT_TOKENS);

  // ── 2. Auth + quota (fail closed) ────────────────────────────────────────────
  let userId = null;
  let quotaEnforced = false;

  if (!QUOTA_ENABLED) {
    if (!IS_LOCAL_DEV) {
      // Production without Supabase config must never become an open proxy.
      return json(503, { error: 'service_unavailable', message: 'The Oracle is resting. Try again soon.' });
    }
    // netlify dev without service role key — skip quota silently.
  } else {
    const jwt = bearerToken(event);
    if (!jwt) return json(401, { error: 'unauthenticated', message: 'Sign in to use the Oracle.' });

    // Verify signature/expiry with Supabase Auth — do NOT trust a decoded sub.
    const user = await verifySupabaseJwt(jwt);
    if (!user) return json(401, { error: 'invalid_token', message: 'Your session has expired. Sign in again.' });
    userId = user.userId;

    if (isFreeSearch) {
      // FREE tier: no quota read, no charge. Just throttle abuse per user so the
      // (paid) Anthropic call can't be scripted for free inference.
      if (!allowFreeSearch(userId)) {
        return json(429, {
          error: 'rate_limited',
          message: 'Too many searches in a short time. Please slow down.',
        });
      }
    } else {
      // READ quota first — does not consume a slot yet.
      // p_run_id lets a multi-batch operation (Oracle categorization) pay once
      // for the whole run: the first batch is charged, the rest come back with
      // run_charged = true and pass the gate below even on a spent quota.
      // Validated as a uuid so a client can't smuggle arbitrary text into the
      // ledger's primary key.
      const quota = await supabaseRpc('get_oracle_quota', { p_user_id: userId, p_run_id: runId, p_feature: feature });

      // Fail closed: no quota row / RPC error / explicit error status → deny.
      if (!quota || quota.status === 'error') {
        console.error('claude.js: quota lookup failed for user', userId, '— denying (fail closed)');
        return json(503, { error: 'quota_unavailable', message: 'The Oracle cannot verify your quota right now. Try again in a moment.' });
      }

      quotaEnforced = true;
      if (!quota.unlimited && !quota.run_charged && quota.calls_remaining <= 0) {
        const resetDate = quota.reset_at
          ? new Date(quota.reset_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
          : null;
        return json(402, {
          error:       'quota_exceeded',
          calls_used:  quota.calls_used,
          calls_limit: quota.calls_limit,
          reset_at:    quota.reset_at,
          message:     `You've used all ${quota.calls_limit} free Oracle calls this month.${resetDate ? ` Your quota resets on ${resetDate}.` : ''}`,
        });
      }
    }
  }

  // ── 3. Anthropic call ────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'Server misconfigured' });

  let upstreamStatus;
  let responseText;
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt || DEFAULT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    upstreamStatus = upstream.status;
    responseText   = await upstream.text();
  } catch (e) {
    console.error('claude.js upstream error:', String(e));
    return json(502, { error: 'Upstream request failed' });
  }

  // ── 4. Consume quota ONLY on Anthropic success ───────────────────────────────
  // Must be awaited — fire-and-forget is killed when the Lambda returns.
  if (!isFreeSearch && quotaEnforced && userId && upstreamStatus >= 200 && upstreamStatus < 300) {
    await supabaseRpc('consume_oracle_call', {
      p_user_id: userId, p_run_id: runId, p_feature: feature, p_source: source,
    });
  }

  return {
    statusCode: upstreamStatus,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: responseText,
  };
}
