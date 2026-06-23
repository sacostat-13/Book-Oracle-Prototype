// Anthropic Claude proxy — with Oracle quota enforcement.
//
// Flow:
//   1. Parse and validate request body.
//   2. If Supabase env vars are present AND a JWT is provided:
//      a. Decode user_id from JWT.
//      b. Check quota via get_oracle_quota (READ ONLY — does not consume).
//         Return 402 immediately if already exceeded.
//      c. Forward to Anthropic.
//      d. Only if Anthropic succeeds (2xx), consume one call via
//         consume_oracle_call. This way a failed Anthropic call never
//         costs the user a quota slot.
//   3. If Supabase env vars are missing (local dev), skip quota entirely.
//
// Required env vars (Netlify → Site → Environment variables):
//   ANTHROPIC_API_KEY
//   SUPABASE_URL              (same value as VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY (secret — never expose client-side)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(statusCode, data) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

async function supabaseRpc(supabaseUrl, serviceKey, rpcName, params) {
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
      return null; // fail open
    }
    return await res.json();
  } catch (e) {
    // Network failure talking to Supabase (e.g. local dev without env vars).
    // Fail open rather than blocking the user.
    console.error(`${rpcName} fetch failed:`, String(e));
    return null;
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  // ── 1. Parse body ────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON body' }); }

  const { prompt, systemPrompt, maxTokens = 2000, model = 'claude-sonnet-4-5' } = body;
  if (!prompt) return json(400, { error: 'Missing prompt' });

  // ── 2. Quota enforcement ─────────────────────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authHeader  = event.headers?.authorization || event.headers?.Authorization || '';
  const jwt         = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  let userId = null;
  let quotaEnforced = false;

  if (!supabaseUrl || !serviceKey) {
    console.warn('claude.js: Supabase env vars missing — quota enforcement skipped (local dev?)');
  } else if (!jwt) {
    return json(401, { error: 'unauthenticated', message: 'Sign in to use the Oracle.' });
  } else {
    // Decode sub claim from JWT payload (no signature verification needed —
    // the Supabase RPC will reject an invalid user_id with a profile-not-found).
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      userId = payload.sub;
    } catch {
      return json(401, { error: 'invalid_token', message: 'Could not read auth token.' });
    }
    if (!userId) return json(401, { error: 'invalid_token', message: 'Auth token missing user ID.' });

    // READ quota first — does not consume a slot yet.
    const quota = await supabaseRpc(supabaseUrl, serviceKey, 'get_oracle_quota', { p_user_id: userId });

    if (quota && quota.status !== 'error') {
      quotaEnforced = true;
      if (!quota.unlimited && quota.calls_remaining <= 0) {
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
    // If quota lookup failed (supabaseRpc returned null), we fail open and proceed.
  }

  // ── 3. Anthropic call ────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not set' });

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
        system: systemPrompt ||
          'You are a literary book recommendation expert with deep knowledge of horror, gothic, literary fiction, and Latin American literature.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    upstreamStatus = upstream.status;
    responseText   = await upstream.text();
  } catch (e) {
    return json(502, { error: 'Upstream request failed', detail: String(e) });
  }

  // ── 4. Consume quota ONLY on Anthropic success ───────────────────────────────
  // This ensures a failed Anthropic call never costs the user a slot.
  if (quotaEnforced && userId && upstreamStatus >= 200 && upstreamStatus < 300) {
    // Fire-and-forget — don't delay the response waiting for this.
    supabaseRpc(supabaseUrl, serviceKey, 'consume_oracle_call', { p_user_id: userId })
      .catch((e) => console.error('consume_oracle_call (post-success) failed:', e));
  }

  return {
    statusCode: upstreamStatus,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: responseText,
  };
}
