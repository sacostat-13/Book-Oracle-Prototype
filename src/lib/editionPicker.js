// Picks which edition of a book a reader should actually be sent to buy.
//
// Extracted from hardcoverService.js so the browser lookup path and the offline
// backfill script (batch-scripts/isbnBackfill.mjs) share one implementation. If these
// ever diverge, the catalog ends up with two populations of ISBNs chosen by different
// rules — which is a subtler version of the bug this file exists to fix.
//
// Pure functions, no imports, no fetch. Safe in both browser and node.
//
// THE BUG THIS FIXES
// ------------------
// Until v0.56, hardcoverService took `editions(limit: 3)` and returned the first entry
// carrying any ISBN — no ordering, no filtering. For Fourth Wing that landed on the
// Empyrean #1-2 boxed set (ISBN 9781637991022, Entangled Ltd, 1168pp), which amazon.com
// and bookshop.org don't stock, so both purchase links 404'd. A boxed set, an audiobook,
// a Spanish printing and a library binding were all equally "the first edition with an
// ISBN" as far as that code was concerned.
//
// Note this is a *different* problem from the compilation filtering in hardcoverSearch().
// That one picks the right BOOK; this picks the right EDITION of a book already
// correctly identified.

import { isValidIsbn } from './isbn.js';

// The first checksum-valid ISBN on an edition row, preferring ISBN-13 (Bookshop deep
// links require one). Returns null if neither field holds a real ISBN.
function editionIsbn(e) {
  if (isValidIsbn(e.isbn_13)) return e.isbn_13;
  if (isValidIsbn(e.isbn_10)) return e.isbn_10;
  return null;
}

const COMPILATION_FORMAT_RX =
  /\b(box(ed)?\s*set|omnibus|collection|collected|bundle|set\s+of\s+\d+|\d+\s*[-–—]\s*book)\b/i;

// reading_format_id is NOT trustworthy on its own. Observed in real Hardcover data:
//
//   9781916366930  reading_format_id=1  edition_format="Audible Audio"   users=611
//   9781782839132  reading_format_id=1  edition_format="Kindle Edition"  users=1
//
// Both claim to be physical. Taking the id at face value made the picker choose an
// Audible edition for A Dowry of Blood over the actual hardcover, and a Kindle edition
// for A Good House for Children. Neither ISBN is something Amazon or Bookshop will sell
// as a book. So when edition_format contradicts the id, the string wins — it's
// free-text entered by librarians, and it describes what the thing actually is.
const AUDIO_FORMAT_RX = /\b(audi(o|ble)|audio\s*cd|spoken|narrat)/i;
const EBOOK_FORMAT_RX = /\b(kindle|ebook|e-book|epub|digital)\b/i;

// Reading format IDs per Hardcover's schema: 1=Physical, 2=Audio, 3=Both, 4=Ebook.
// Physical wins because ISBN-10 → Amazon ASIN only holds for print, and Bookshop is a
// print-first retailer. An audiobook ISBN routes to a product neither store sells.
const FORMAT_SCORE = { 1: 100, 3: 80, 4: 20, 2: -50 };

// Resolve the real format, letting edition_format override a contradicting id.
function effectiveFormat(e) {
  const f = e.edition_format || '';
  if (AUDIO_FORMAT_RX.test(f)) return 2;
  if (EBOOK_FORMAT_RX.test(f)) return 4;
  return e.reading_format_id;
}

// The editions selection both callers use. Kept here so the query and the scoring that
// consumes it can't drift apart — every field referenced in scoreEdition is requested here.
//
// Careful when editing: the Netlify proxy's abuse guard counts total braces, and
// `where`/`order_by` inflate that count as much as real nesting does. See the comment
// in netlify/functions/hardcover.js.
export const EDITION_FIELDS = `
  editions(
    where: { compilation: { _eq: false } }
    order_by: { users_count: desc }
    limit: 10
  ) { isbn_13 isbn_10 asin reading_format_id compilation edition_format language_id users_count }
`;

export function scoreEdition(e) {
  if (!e) return -Infinity;

  // Hardcover's edition rows are librarian-entered and the ISBN fields are not validated
  // on the way in. A real example from The Fellowship of the Ring: isbn_13 =
  // "0345253434195" — thirteen digits, no 978/979 prefix, failing checksum. It was the
  // most-owned edition on the record and only lost because it happened to be tagged
  // Kindle. A malformed ISBN is a guaranteed 404 on both storefronts, so disqualify.
  if (!editionIsbn(e)) return -Infinity;

  let score = 0;

  // Hard disqualifiers — a compilation ISBN is the exact failure we're fixing.
  // Checked client-side as well as in the query because Hardcover's `compilation`
  // flag is frequently unset even on obvious boxed sets.
  if (e.compilation === true) score -= 1000;
  if (e.edition_format && COMPILATION_FORMAT_RX.test(e.edition_format)) score -= 1000;

  score += FORMAT_SCORE[effectiveFormat(e)] ?? 0;

  // Bookshop deep links need an ISBN-13; a valid ISBN-10 alone is a weaker record.
  if (isValidIsbn(e.isbn_13)) score += 10;

  // An explicit ASIN is a mild convenience, NOT evidence of a better edition — for
  // 978- ISBNs purchaseLinks derives the ASIN anyway. It was +5 against a popularity
  // term that maxed out at +10, which let an obscure edition outrank a popular one on
  // metadata completeness alone: A Dowry of Blood picked a paperback with 3 owners and
  // an ASIN over the hardcover with 102. Demoted to a pure tiebreak.
  if (e.asin) score += 1;

  // We link to amazon.com / bookshop.org, both US stores, so English (language_id 1)
  // is what we want. A known-foreign edition is actively wrong — a Spanish or Japanese
  // ISBN produces a link to a product the US stores don't carry — so penalise it rather
  // than merely not rewarding it. null means "unknown", which is common on sparse
  // records and shouldn't be punished as if it were known-foreign.
  if (e.language_id === 1) score += 30;
  else if (e.language_id != null) score -= 40;

  // Within a format+language tier, how many people own an edition is the best available
  // proxy for "the one a store actually stocks". Log-scaled: the interesting distinction
  // is 3 owners vs 100, not 6000 vs 6400, and a linear term made popularity so weak that
  // metadata trivia decided the winner.
  //
  // Capped at 30, which is deliberately below both the physical→ebook gap (80) and the
  // English→foreign gap (70), so no amount of popularity can promote an audiobook or a
  // foreign printing over a US print edition.
  score += Math.min(Math.log10(1 + (e.users_count || 0)) * 8, 30);

  return score;
}

// Returns { isbn, asin } for the best available edition, or nulls.
export function pickBestEdition(editions) {
  if (!editions || editions.length === 0) return { isbn: null, asin: null };

  let best = null;
  let bestScore = -Infinity;
  for (const e of editions) {
    if (!e || (!editionIsbn(e) && !e.asin)) continue;
    const s = scoreEdition(e);
    if (s > bestScore) { bestScore = s; best = e; }
  }
  if (!best) return { isbn: null, asin: null };

  // A pick can be "the best available" and still be poor — the only candidate might be
  // a lone Japanese printing, or a bare record nobody owns. Surface why, so a 2.5k-book
  // backfill can be reviewed by scanning for flags rather than reading every line.
  const warnings = [];
  if (best.language_id != null && best.language_id !== 1) warnings.push(`non-English (lang ${best.language_id})`);
  if (effectiveFormat(best) === 2) warnings.push('audio only');
  if (effectiveFormat(best) === 4) warnings.push('ebook only');
  if ((best.users_count || 0) <= 1 && editions.length <= 1) warnings.push('single sparse edition');
  if (!isValidIsbn(best.isbn_13)) warnings.push('no valid ISBN-13 (Bookshop link will fall back to search)');

  return {
    isbn: editionIsbn(best),
    asin: best.asin || null,
    // Set when the caller pooled editions from several candidate records (see the
    // backfill script) — identifies which record supplied the winner, so a learned
    // hardcover_id points at the useful record rather than the first search hit.
    bookId: best._bookId ?? null,
    warnings,
  };
}
