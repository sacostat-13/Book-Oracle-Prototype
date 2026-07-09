// netlify/functions/_shared/auth.js
// Shared security helpers for Netlify functions.
//
// verifySupabaseJwt(jwt)
//   Verifies the token's signature/expiry by asking Supabase Auth itself
//   (GET /auth/v1/user). This is algorithm-agnostic (works with HS256 and
//   the newer asymmetric keys) and needs no extra npm dependencies.
//   Returns { userId, email } on success, or null on any failure.
//   NEVER trust a bare-decoded `sub` claim — anyone can forge one.
//
// corsHeaders(event)
//   Returns CORS headers restricted to an allowlist of origins instead of '*'.
//   Same-origin requests (the normal app flow) don't need CORS at all, so the
//   allowlist only matters for local dev and any future subdomains.
//
// Files in _shared/ are bundled into importing functions by esbuild but are
// not deployed as endpoints themselves.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

const DEFAULT_ORIGINS = [
  'https://readingoracle.com',
  'https://www.readingoracle.com',
  'https://thebooksoracle.com',
  'https://www.thebooksoracle.com',
  'http://localhost:8888', // netlify dev
  'http://localhost:5173', // vite dev
];

// Optional override / extension via env: comma-separated list.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .concat(DEFAULT_ORIGINS);

export function corsHeaders(event) {
  const origin = event?.headers?.origin || event?.headers?.Origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

export function bearerToken(event) {
  const h = event?.headers?.authorization || event?.headers?.Authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

export async function verifySupabaseJwt(jwt) {
  if (!jwt || !SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${jwt}`,
      },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user?.id) return null;
    return { userId: user.id, email: user.email || null };
  } catch (e) {
    console.error('verifySupabaseJwt failed:', String(e));
    return null;
  }
}
