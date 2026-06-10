// Wikipedia lookup proxy.
//
// The client POSTs { title, author?, lang? } to /.netlify/functions/wikipedia
// and we return a normalized summary (description, thumbnail, page URL,
// language we actually used) or null if no good match could be found.
//
// Strategy:
//   1. Build a disambiguation query. We always append "book" (or the
//      author's name when supplied) so generic titles like "The Stand"
//      don't land on the wrong page.
//   2. Hit the opensearch endpoint to get up to 5 candidates ranked by
//      Wikipedia's own relevance score.
//   3. Score candidates ourselves with a small heuristic — boost results
//      whose extract mentions the author's name, or whose title contains
//      "novel", "book", or the input title verbatim. Reject results that
//      look like disambiguation pages (description starts with
//      "may refer to" or contains "(disambiguation)").
//   4. Fetch the page/summary endpoint for the winning candidate and
//      return a normalized shape.
//
// Language handling:
//   - lang='es' → try es.wikipedia.org first, fall back to en
//   - lang='en' or absent → en only
// This matches the user's i18n preference: Spanish-speaking users see
// Spanish descriptions when available without losing English fallback.
//
// No auth, no API key, no env vars. Wikipedia's REST API is free and
// supports CORS, but we proxy anyway so the disambiguation lives in one
// place and the client doesn't have to know about the two endpoints.

const USER_AGENT = 'BookOracle/0.10 (https://github.com/sacostat-13/Book-Oracle-Prototype; contact via repo)';

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
  if (!title) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Missing title' }),
    };
  }

  // Languages to try, in order. Spanish-first when requested, English always
  // as a fallback. Could expand to more languages later.
  const langs = requestedLang === 'es' ? ['es', 'en'] : ['en'];

  for (const lang of langs) {
    try {
      const result = await lookupOne(lang, title, author);
      if (result) {
        return {
          statusCode: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...result, lang }),
        };
      }
    } catch (e) {
      console.warn(`[wikipedia] ${lang} lookup failed`, e.message);
      // Try next language
    }
  }

  // No hits in any language — return null cleanly so the client can treat
  // this as "Wikipedia had nothing" rather than an error.
  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ found: false }),
  };
}

async function lookupOne(lang, title, author) {
  // Step 1: opensearch for candidates. We append a disambiguation hint to
  // the query so we don't land on people, places, or unrelated topics.
  // "Crash J.G. Ballard" is much better than just "Crash".
  const hint = author ? ` ${author}` : ' novel';
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
  // opensearch returns: [query, [titles], [snippets], [urls]]
  const titles = searchData[1] || [];
  const snippets = searchData[2] || [];
  if (titles.length === 0) return null;

  // Step 2: score candidates. Reject disambiguation pages outright.
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < titles.length; i++) {
    const candidateTitle = titles[i] || '';
    const snippet = (snippets[i] || '').toLowerCase();

    // Disambiguation rejection
    if (candidateTitle.toLowerCase().includes('(disambiguation)')) continue;
    if (snippet.startsWith('may refer to')) continue;

    let score = 0;
    const lowerCand = candidateTitle.toLowerCase();
    const lowerTitle = title.toLowerCase();
    const lowerAuthor = author.toLowerCase();

    // Strong signals
    if (lowerCand === lowerTitle) score += 10;
    if (lowerCand.startsWith(lowerTitle)) score += 5;
    if (lowerAuthor && snippet.includes(lowerAuthor)) score += 8;
    if (lowerAuthor && lowerCand.includes(lowerAuthor)) score += 4;

    // Genre/format hints in the candidate title — Wikipedia disambiguates
    // by parenthesizing the topic, e.g. "Crash (J. G. Ballard novel)"
    if (lowerCand.includes('(novel)') || lowerCand.includes('novel)')) score += 6;
    if (lowerCand.includes('(book')) score += 5;
    if (lowerCand.includes('(film')) score -= 8;       // probably not what we want
    if (lowerCand.includes('(album')) score -= 8;
    if (lowerCand.includes('(song')) score -= 8;
    if (lowerCand.includes('(tv ')) score -= 8;
    if (lowerCand.includes('(video game')) score -= 8;
    if (snippet.includes('novel') || snippet.includes('book')) score += 3;

    // Mild preference for earlier results (Wikipedia ranks by relevance)
    score += (5 - i) * 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = candidateTitle;
    }
  }

  // If our scoring rejected everything (e.g. all candidates were
  // disambiguation pages), bail.
  if (!best || bestScore < 0) return null;

  // Step 3: fetch the summary for the winning candidate.
  // The page/summary endpoint returns a clean JSON object with extract,
  // thumbnail, and canonical URL — ideal for our use case.
  const summaryUrl =
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/` +
    encodeURIComponent(best);
  const summaryResp = await fetch(summaryUrl, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!summaryResp.ok) return null;
  const summary = await summaryResp.json();

  // The summary endpoint sometimes still returns disambiguation pages —
  // check the `type` field as a final safety net.
  if (summary.type === 'disambiguation') return null;
  // Defensive: extract must be substantive, not just a one-line stub.
  if (!summary.extract || summary.extract.length < 50) return null;

  return {
    found: true,
    title: summary.title || best,
    description: summary.extract,
    descriptionShort: summary.description || null,  // Wikipedia's own one-liner
    pageUrl: summary.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(best)}`,
    thumbnail: summary.thumbnail?.source || null,
    score: bestScore,
  };
}
