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
