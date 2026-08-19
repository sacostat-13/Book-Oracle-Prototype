// ISBN normalisation + conversion helpers.
//
// Why this exists: our lookup chain (Hardcover → OpenLibrary → PRH → Google Books)
// returns whatever ISBN an edition happens to carry — sometimes ISBN-13, sometimes
// ISBN-10, sometimes hyphenated. The two storefronts we link to want different forms:
//
//   - Bookshop.org deep links take an ISBN-13
//   - Amazon's /dp/ endpoint takes an ASIN, and for print books the ASIN *is* the ISBN-10
//
// So we normalise once here and let purchaseLinks.js ask for whichever form it needs.

// Strip hyphens/spaces, uppercase the X check digit. Returns null if it isn't
// plausibly an ISBN at all.
export function cleanIsbn(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) return s;
  if (s.length === 13 && /^\d{13}$/.test(s)) return s;
  return null;
}

export function isIsbn10(v) {
  const s = cleanIsbn(v);
  return !!s && s.length === 10;
}

export function isIsbn13(v) {
  const s = cleanIsbn(v);
  return !!s && s.length === 13;
}

// Verify the check digit. cleanIsbn() only validates SHAPE — 13 digits is not the same
// as a real ISBN. Aggregator data (Google Books, OpenLibrary) carries transposed and
// truncated ISBNs, and a bad check digit guarantees a 404 on both storefronts, so
// anything written to the catalog from those sources should be checksum-verified first.
export function isValidIsbn(raw) {
  const s = cleanIsbn(raw);
  if (!s) return false;

  if (s.length === 10) {
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += (10 - i) * Number(s[i]);
    sum += s[9] === 'X' ? 10 : Number(s[9]);
    return sum % 11 === 0;
  }

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

// ISBN-13 registration groups: 978-0 and 978-1 are the English-language group, and
// 979-8 is overwhelmingly US self-publishing. Everything else is a national registrant
// (978-4 Japan, 978-84 Spain, 978-3 Germany…) whose editions amazon.com and
// bookshop.org generally don't stock — a direct link to one is worse than a search,
// because it 404s instead of landing the reader somewhere useful.
export function isEnglishRegistrant(raw) {
  const s = cleanIsbn(raw);
  if (!s) return false;
  const t = s.length === 10 ? isbn10to13(s) : s;
  return /^(9780|9781|9798)/.test(t);
}

// ISBN registration group → the language that group overwhelmingly publishes in.
//
// The comment above already names the mechanism — 978-4 Japan, 978-84 Spain,
// 978-3 Germany — and isEnglishRegistrant() is the one-language special case of
// it. This generalises it, because the registration group is a FREE, OFFLINE
// language signal, and for exactly the books our metadata sources are worst at
// (recent non-Anglophone printings) it is often the only signal available.
// OpenLibrary and Google Books both returned nothing for 9788419680877, a
// perfectly real Spanish edition.
//
// WHAT THIS IS AND IS NOT
//
// The group identifies the AGENCY that issued the number — effectively the
// publisher's country — not the language of the text. Those coincide often
// enough to be useful and not always: Spain (84) also publishes Catalan, Basque
// and Galician; Switzerland's German-language publishers sit under 3.
//
// So groups that genuinely cannot be mapped return null rather than a guess.
// India (81, 93) publishes in twenty-two official languages, the former
// Yugoslavia (86) in four, Nigeria (978) in three — a "likely" answer for any
// of those is a coin toss, and callers treat null as "ask something else"
// rather than as an error.
//
// Callers should corroborate before writing this to a shared column; see
// batch-scripts/scheduled/languageBackfill.mjs, which requires the title not to
// disagree.
const REGISTRANT_LANGUAGE = [
  // Longest prefixes first — matching is first-hit, and '9786' must be tested
  // before '978' + group '6…' would otherwise swallow it.
  ['9791', 'fr'], ['9798', 'en'],                       // 979-10 France, 979-8 US
  ['97911', 'ko'], ['97912', 'it'],
  ['978950', 'es'], ['978987', 'es'],                   // Argentina
  ['978956', 'es'], ['978958', 'es'], ['978959', 'es'], // Chile, Colombia, Cuba
  ['978968', 'es'], ['978970', 'es'], ['978607', 'es'], // Mexico
  ['978980', 'es'],                                     // Venezuela
  ['978972', 'pt'], ['978989', 'pt'],                   // Portugal
  ['978951', 'fi'], ['978952', 'fi'],
  ['978953', 'hr'], ['978954', 'bg'], ['978960', 'el'],
  ['978961', 'sl'], ['978963', 'hu'], ['978965', 'he'],
  ['978966', 'uk'], ['978973', 'ro'], ['978977', 'ar'],
  ['978957', 'zh'], ['978986', 'zh'], ['978626', 'zh'], // Taiwan
  ['978962', 'zh'], ['978988', 'zh'],                   // Hong Kong
  ['978964', 'fa'], ['978600', 'fa'],                   // Iran
  ['978974', 'th'], ['978616', 'th'],
  ['978975', 'tr'], ['978605', 'tr'],
  ['978984', 'bn'], ['978979', 'id'],
  ['97880', 'cs'], ['97882', 'no'], ['97883', 'pl'],
  ['97884', 'es'], ['97885', 'pt'],                     // Spain, Brazil
  ['97887', 'da'], ['97888', 'it'], ['97889', 'ko'],
  ['97890', 'nl'], ['97891', 'sv'], ['97894', 'nl'],
  ['9780', 'en'], ['9781', 'en'],
  ['9782', 'fr'], ['9783', 'de'], ['9784', 'ja'],
  ['9785', 'ru'], ['9787', 'zh'],
  // Deliberately absent, and deliberately not guessed:
  //   97881 / 97893  India      — 22 official languages
  //   97886          ex-Yugoslavia
  //   97892          international organisations
  //   978955 978969 978971 978976 978981 978982 978985 978978
];

export function registrantLanguage(raw) {
  const s = cleanIsbn(raw);
  if (!s) return null;
  const t = s.length === 10 ? isbn10to13(s) : s;
  if (!t) return null;
  for (const [prefix, lang] of REGISTRANT_LANGUAGE) {
    if (t.startsWith(prefix)) return lang;
  }
  return null;
}

// ISBN-13 → ISBN-10. Only defined for the 978- prefix range; 979- ISBNs (common on
// newer indie/KDP titles and most Bookshop-exclusive editions) have no ISBN-10 form
// at all, so callers must handle null.
export function isbn13to10(raw) {
  const s = cleanIsbn(raw);
  if (!s) return null;
  if (s.length === 10) return s;
  if (!s.startsWith('978')) return null;

  const core = s.slice(3, 12); // 9 digits, drop the ISBN-13 check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);
  const rem = (11 - (sum % 11)) % 11;
  const check = rem === 10 ? 'X' : String(rem);
  return core + check;
}

// ISBN-10 → ISBN-13. Always defined (every ISBN-10 has a 978- equivalent).
export function isbn10to13(raw) {
  const s = cleanIsbn(raw);
  if (!s) return null;
  if (s.length === 13) return s;

  const core = '978' + s.slice(0, 9); // 12 digits, drop the ISBN-10 check digit
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return core + String(check);
}

// Convenience: pull whatever ISBN a book object is carrying, whichever field it
// landed in. Different services in the lookup chain populate different keys, and
// DataContext uses `_isbn` on some sync paths.
export function isbnFromBook(book) {
  if (!book) return null;
  return (
    cleanIsbn(book.isbn) ||
    cleanIsbn(book._isbn) ||
    cleanIsbn(book.isbn13) ||
    cleanIsbn(book.isbn_13) ||
    cleanIsbn(book.isbn10) ||
    cleanIsbn(book.isbn_10) ||
    null
  );
}
