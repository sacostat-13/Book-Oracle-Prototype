// src/components/constellation/buildSky.js — pure layout for ReaderConstellation.
//
// Turns a shelf into a sky. No three.js here, so it is cheap to import and
// easy to test:
//   - one constellation per genre FAMILY the reader has read in (the sixteen
//     browsing families from v0.67), arranged round a ring in family order;
//     books with no family yet gather at the centre as "uncharted";
//   - each book a star inside its family, placed on a golden-angle spiral
//     seeded by its key, so the sky is stable between visits and a new book
//     adds a star without moving the others;
//   - brightness from recency, size from the reader's rating;
//   - the thread: the last THREAD_MAX books with a read date, in order.
import { bookKey, hashStr } from '../../lib/bookHelpers';

export const THREAD_MAX = 24;
const GOLDEN = 2.399963;

function familyOf(book, genresByBookId) {
  const rows = (book.bookId && genresByBookId?.[book.bookId]) || [];
  const hit = rows.find((g) => g.familySlug);
  return hit
    ? { slug: hit.familySlug, name: hit.familyName || hit.familySlug, sort: hit.familySort ?? 999 }
    : null;
}

export function buildSky(state, { unchartedLabel = 'Uncharted' } = {}) {
  const books = (state?.library || []).filter((b) => b?.t);
  const byFamily = new Map();
  for (const book of books) {
    const fam = familyOf(book, state?.genresByBookId) || { slug: '_uncharted', name: unchartedLabel, sort: 10000 };
    if (!byFamily.has(fam.slug)) byFamily.set(fam.slug, { ...fam, books: [] });
    byFamily.get(fam.slug).books.push(book);
  }

  const charted = [...byFamily.values()].filter((f) => f.slug !== '_uncharted').sort((a, b) => a.sort - b.sort);
  const uncharted = byFamily.get('_uncharted');
  const now = Date.now();
  const YEAR = 365 * 24 * 3600 * 1000;

  const stars = [];
  const families = [];
  const RING = 5.4;

  const place = (fam, cx, cy, cz, tintIndex) => {
    const n = fam.books.length;
    const spread = 0.42;
    const idx = families.length;
    const members = [];
    // Stable order: by key hash, so a newly read book slots in without
    // reshuffling its neighbours.
    const ordered = [...fam.books].sort((a, b) => hashStr(bookKey(a)) - hashStr(bookKey(b)));
    ordered.forEach((book, j) => {
      const h = hashStr(bookKey(book));
      const r = spread * Math.sqrt(j + 0.6);
      const th = j * GOLDEN + (h % 628) / 100;
      const read = book.dateRead ? Date.parse(book.dateRead) : NaN;
      const age = Number.isFinite(read) ? Math.max(0, now - read) : 3 * YEAR;
      members.push(stars.length);
      stars.push({
        book,
        key: bookKey(book),
        family: idx,
        x: cx + Math.cos(th) * r * 1.15,
        y: cy + Math.sin(th) * r,
        z: cz + (((h >> 8) % 100) / 100 - 0.5) * 1.1,
        size: book.rating ? 0.55 + book.rating * 0.17 : 0.7,
        bright: 0.45 + 0.55 * Math.exp(-age / (1.5 * YEAR)),
        tint: tintIndex,
        readAt: Number.isFinite(read) ? read : null,
      });
    });
    families.push({
      slug: fam.slug,
      name: fam.name,
      count: n,
      x: cx,
      y: cy + spread * Math.sqrt(n + 0.6) + 0.55,
      z: cz,
      members,
    });
  };

  charted.forEach((fam, k) => {
    const a = (k / Math.max(charted.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const ring = charted.length <= 2 ? RING * 0.55 : RING;
    place(fam, Math.cos(a) * ring * 1.5, Math.sin(a) * ring, Math.sin(k * 1.7) * 1.1, k % 8);
  });
  if (uncharted) place(uncharted, 0, -0.4, 0, 8);

  const dated = stars
    .map((s, i) => ({ i, t: s.readAt }))
    .filter((s) => s.t != null)
    .sort((a, b) => a.t - b.t)
    .slice(-THREAD_MAX)
    .map((s) => s.i);

  return { stars, families, thread: dated };
}
