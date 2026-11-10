// src/lib/api/bookTeaser.js — client for netlify/functions/book-teaser.js.
//
// The signed-out book page's one Oracle reading. Never throws: anything other
// than picks comes back as { status: 'empty' } or { status: 'busy' } so the
// component can say so and move on.

const FN = '/.netlify/functions/book-teaser';

/**
 * @param {string} key   the book's share key ("titlekey|authorkey")
 * @param {'en'|'es'} lang
 * @returns {Promise<{ status: 'ok', cached: boolean, picks: Array<{ title, author, coverUrl, shareKey, why }> } | { status: 'empty' } | { status: 'busy' }>}
 */
export async function fetchBookTeaser(key, lang) {
  if (!key) return { status: 'empty' };
  try {
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: String(key).toLowerCase(), lang: lang === 'es' ? 'es' : 'en' }),
    });
    const data = await res.json().catch(() => null);
    if (data?.status === 'ok' && Array.isArray(data.picks) && data.picks.length) return data;
    if (data?.status === 'empty' || res.status === 404) return { status: 'empty' };
    return { status: 'busy' };
  } catch {
    return { status: 'busy' };
  }
}
