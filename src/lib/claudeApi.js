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
