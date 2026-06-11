// Wikipedia client. Calls our Netlify function and returns a normalized
// shape — or null when nothing useful was found.

import { cleanTitle, cleanAuthor } from './bookHelpers';

const ENDPOINT = '/.netlify/functions/wikipedia';

// Look up a BOOK by title (and optional author). v0.10.
export async function wikipediaLookup(title, author, lang = 'en') {
  return wikipediaCall(title, author, lang, 'book');
}

// Look up a SERIES by name. v0.12.
//
// The returned shape mirrors the book lookup — title, description, page URL,
// language — so consumers can treat them uniformly. The seriesService layers
// this on top of Hardcover/OL series data.
//
// Pass the author when known: series articles on Wikipedia are usually
// titled "X (book series)" / "Y (novel series)" but disambiguation is much
// more reliable when we can match against the author name too.
export async function wikipediaSeriesLookup(seriesName, author, lang = 'en') {
  return wikipediaCall(seriesName, author, lang, 'series');
}

async function wikipediaCall(title, author, lang, kind) {
  if (!title) return null;
  const cleanedTitle = cleanTitle(title);
  const cleanedAuthor = cleanAuthor(author || '');

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: cleanedTitle,
        author: cleanedAuthor || undefined,
        lang,
        kind,
      }),
    });
    if (!resp.ok) {
      console.warn(`[wikipedia] proxy ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    if (!data.found) return null;

    return {
      t: data.title,
      d: data.description,
      coverUrl: data.thumbnail || null,
      wikipediaUrl: data.pageUrl,
      wikipediaLang: data.lang,
      descriptionShort: data.descriptionShort || null,
      fromWikipedia: true,
      // For series-kind results, this lets consumers know what they got
      kind: data.kind || kind,
    };
  } catch (e) {
    console.warn('[wikipedia] request failed', e);
    return null;
  }
}
