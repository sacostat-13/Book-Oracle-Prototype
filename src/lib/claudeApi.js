// Calls Anthropic via our Netlify Function proxy. The API key stays server-side.
// In local dev, run `netlify dev` instead of `npm run dev` to make the function
// available at /.netlify/functions/claude.
//
// The function requires a valid Supabase JWT in the Authorization header.
// Quota is enforced server-side — free users get 5 calls/month.
// A 402 response means quota exceeded; the error body has structured data.

import { supabase } from './supabase';

// Thrown (as a plain object) when the server returns 402 quota_exceeded.
// Callers can check: if (err?.code === 'quota_exceeded')
export class QuotaExceededError extends Error {
  constructor(data) {
    super(data.message || 'Oracle quota exceeded');
    this.code       = 'quota_exceeded';
    this.callsUsed  = data.calls_used;
    this.callsLimit = data.calls_limit;
    this.resetAt    = data.reset_at ? new Date(data.reset_at) : null;
  }
}

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? `Bearer ${token}` : null;
}

// Same call, but reports WHY it produced nothing.
//
// callClaude() collapses every non-402 failure to null, so a 429 rate limit is
// indistinguishable from "Claude had no answer". For most callers that's fine — they
// just degrade. For bookLookup it is not: a book that never reached Claude because the
// free-search throttle was saturated is a retryable gap, while a book Claude genuinely
// could not identify is a real dead end. Recording them as the same thing is what makes
// "we tried everything" untrue in the one case where it matters.
//
// Returns { text, unavailable }:
//   unavailable = true  → the call did not complete (429, 5xx, network, quota). RETRY.
//   unavailable = false → the call completed. A null text means Claude had no answer.
//
// Kept separate from callClaude so the dozen existing call sites are untouched — adding
// a new thrown error class there would surface in every one of them.
export async function callClaudeWithStatus(prompt, systemPrompt, options = {}) {
  try {
    const authHeader = await getAuthHeader();
    const headers = { 'Content-Type': 'application/json' };
    if (authHeader) headers['Authorization'] = authHeader;

    const response = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt, systemPrompt, ...options }),
    });

    // 402 quota, 429 rate limit, 5xx server, 503 quota_unavailable — all "didn't run".
    if (response.status === 402 || response.status === 429 || response.status >= 500) {
      return { text: null, unavailable: true };
    }
    if (!response.ok) return { text: null, unavailable: true };

    const data = await response.json();
    if (!data.content) return { text: null, unavailable: false };
    return {
      text: data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
      unavailable: false,
    };
  } catch (e) {
    // Network failure, offline, DNS — the call never landed.
    console.error('Claude API error:', e);
    return { text: null, unavailable: true };
  }
}

export async function callClaude(prompt, systemPrompt, options = {}) {
  try {
    const authHeader = await getAuthHeader();
    const headers = { 'Content-Type': 'application/json' };
    if (authHeader) headers['Authorization'] = authHeader;

    const response = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt, systemPrompt, ...options }),
    });

    // Quota exceeded — throw structured error so callers can show specific UI
    if (response.status === 402) {
      const data = await response.json();
      throw new QuotaExceededError(data);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('Claude proxy error:', response.status, errText);
      return null;
    }

    const data = await response.json();
    if (!data.content) return null;
    return data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  } catch (e) {
    // Re-throw QuotaExceededError so callers handle it explicitly
    if (e instanceof QuotaExceededError) throw e;
    console.error('Claude API error:', e);
    return null;
  }
}

export function parseJSONResponse(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return null;
  }
}
