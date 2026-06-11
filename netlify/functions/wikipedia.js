// Wikipedia lookup proxy.
//
// The client POSTs { title, author?, lang?, kind? } to
// /.netlify/functions/wikipedia and we return a normalized summary
// (description, thumbnail, page URL, language we actually used) or
// null if no good match could be found.
//
// kind:
//   'book' (default)  — disambiguation favors novels/books, rejects films,
//                        songs, albums, games, TV. Hint appended to query
//                        is the author name (or "novel" as fallback).
//   'series' (v0.12)   — disambiguation favors "(book series)", "(novel
//                        series)", "(series)" parentheticals. Hint appended
//                        is "book series" or the author name when supplied.
//
// Strategy is the same in both cases:
//   1. Build a disambiguated opensearch query
//   2. Score up to 5 candidates with kind-specific scoring
//   3. Fetch page/summary for the winner, reject if it's a disambig page
//      or its extract is a stub
//
// Language handling (same as before):
//   - lang='es' → try es.wikipedia.org first, fall back to en
//   - lang='en' or absent → en only
//
// No auth, no API key. Wikipedia REST is free and supports CORS, but we
// proxy anyway so the disambiguation lives in one place.

const USER_AGENT = 'BookOracle/0.12 (https://github.com/sacostat-13/Book-Oracle-Prototype; contact via repo)';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const title = (body.title || '').trim();
  const author = (body.author || '').trim();
  const requestedLang = (body.lang || 'en').toLowerCase();
  const kind = (body.kind || 'book').toLowerCase();
  if (!title) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Missing title' }),
    };
  }
  if (kind !== 'book' && kind !== 'series') {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Invalid kind' }),
    };
  }

  const langs = requestedLang === 'es' ? ['es', 'en'] : ['en'];

  for (const lang of langs) {
    try {
      const result = await lookupOne(lang, title, author, kind);
      if (result) {
        return {
          statusCode: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...result, lang, kind }),
        };
      }
    } catch (e) {
      console.warn(`[wikipedia] ${lang}/${kind} lookup failed`, e.message);
    }
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ found: false }),
  };
}

async function lookupOne(lang, title, author, kind) {
  // Disambiguation hint differs by kind. For series, we prepend the explicit
  // "book series" hint since series articles on Wikipedia are typically
  // titled "X (book series)" or "X (novel series)".
  const hint =
    kind === 'series'
      ? (author ? ` book series ${author}` : ' book series')
      : (author ? ` ${author}` : ' novel');
  const searchQuery = `${title}${hint}`;
  const searchUrl =
    `https://${lang}.wikipedia.org/w/api.php` +
    `?action=opensearch` +
    `&search=${encodeURIComponent(searchQuery)}` +
    `&limit=5` +
    `&namespace=0` +
    `&format=json` +
    `&origin=*`;

  const searchResp = await fetch(searchUrl, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!searchResp.ok) return null;
  const searchData = await searchResp.json();
  const titles = searchData[1] || [];
  const snippets = searchData[2] || [];
  if (titles.length === 0) return null;

  let best = null;
  let bestScore = -1;
  for (let i = 0; i < titles.length; i++) {
    const candidateTitle = titles[i] || '';
    const snippet = (snippets[i] || '').toLowerCase();
    const lowerCand = candidateTitle.toLowerCase();
    const lowerTitle = title.toLowerCase();
    const lowerAuthor = author.toLowerCase();

    // Disambiguation rejection — same for both kinds
    if (lowerCand.includes('(disambiguation)')) continue;
    if (snippet.startsWith('may refer to')) continue;

    let score = 0;

    // Strong signals (shared)
    if (lowerCand === lowerTitle) score += 10;
    if (lowerCand.startsWith(lowerTitle)) score += 5;
    if (lowerAuthor && snippet.includes(lowerAuthor)) score += 8;
    if (lowerAuthor && lowerCand.includes(lowerAuthor)) score += 4;

    if (kind === 'series') {
      // Series-specific scoring: favor articles whose title parenthetical
      // marks them as a book/novel series.
      if (lowerCand.includes('(book series)')) score += 12;
      if (lowerCand.includes('(novel series)')) score += 12;
      if (lowerCand.includes('series)')) score += 6;
      if (lowerCand.includes('(book')) score += 4;
      if (lowerCand.endsWith(' series')) score += 6;
      // Snippet vocabulary that indicates a series article
      if (snippet.includes('book series') || snippet.includes('novel series')) score += 5;
      if (snippet.includes('series of novels') || snippet.includes('series of books')) score += 4;
      // De-rank single-book articles when we asked for a series
      if (lowerCand.includes('(novel)') && !lowerCand.includes('series')) score -= 3;
      // Standard non-book penalties
      if (lowerCand.includes('(film')) score -= 8;
      if (lowerCand.includes('(album')) score -= 8;
      if (lowerCand.includes('(tv ')) score -= 8;
      if (lowerCand.includes('(video game')) score -= 8;
    } else {
      // Book-specific scoring (unchanged from v0.10)
      if (lowerCand.includes('(novel)') || lowerCand.includes('novel)')) score += 6;
      if (lowerCand.includes('(book')) score += 5;
      if (lowerCand.includes('(film')) score -= 8;
      if (lowerCand.includes('(album')) score -= 8;
      if (lowerCand.includes('(song')) score -= 8;
      if (lowerCand.includes('(tv ')) score -= 8;
      if (lowerCand.includes('(video game')) score -= 8;
      if (snippet.includes('novel') || snippet.includes('book')) score += 3;
    }

    // Mild preference for earlier results (Wikipedia's own ranking)
    score += (5 - i) * 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = candidateTitle;
    }
  }

  if (!best || bestScore < 0) return null;

  const summaryUrl =
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/` +
    encodeURIComponent(best);
  const summaryResp = await fetch(summaryUrl, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!summaryResp.ok) return null;
  const summary = await summaryResp.json();

  if (summary.type === 'disambiguation') return null;
  if (!summary.extract || summary.extract.length < 50) return null;

  return {
    found: true,
    title: summary.title || best,
    description: summary.extract,
    descriptionShort: summary.description || null,
    pageUrl: summary.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(best)}`,
    thumbnail: summary.thumbnail?.source || null,
    score: bestScore,
  };
}
