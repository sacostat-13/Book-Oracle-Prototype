// Wikipedia client. Calls our Netlify function and returns a book-shaped
// object that fits the merge logic in bookLookup.js — or null when nothing
// useful was found.
//
// What we return when there IS a match:
//   {
//     t: "Crash",                 // Wikipedia's canonical title
//     d: "<long extract>",        // The lede paragraph(s)
//     coverUrl: "...",            // Optional thumbnail
//     wikipediaUrl: "...",        // Useful for the BookModal in v0.11
//     wikipediaLang: "en" | "es",
//     fromWikipedia: true,
//   }
//
// Note: we deliberately do NOT return author/pages/isbn from Wikipedia.
// That data is unreliable in the article infobox and would confuse the
// merge. Wikipedia's value-add is description + cover thumbnail; let the
// other sources own structured fields.
//
// Language is read from the i18n context at call time so we honor the
// user's current preference (es.wikipedia first when the app is in
// Spanish mode). Passing lang explicitly lets us test or override.

import { cleanTitle, cleanAuthor } from './bookHelpers';

const ENDPOINT = '/.netlify/functions/wikipedia';

export async function wikipediaLookup(title, author, lang = 'en') {
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
      // Use Wikipedia's thumbnail only as a last-resort cover — it's
      // usually a low-res page header, not a book cover. Other sources win.
      coverUrl: data.thumbnail || null,
      wikipediaUrl: data.pageUrl,
      wikipediaLang: data.lang,
      // Wikipedia's own one-line description (e.g. "1973 novel by J. G. Ballard")
      // — useful as a fallback for description in cards but not the main `d`.
      descriptionShort: data.descriptionShort || null,
      fromWikipedia: true,
    };
  } catch (e) {
    console.warn('[wikipedia] request failed', e);
    return null;
  }
}
