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
//   - the thread: the last THREAD_MAX books with a read date, in order;
//   - lit: the GLIMPSE_LIT most recent reads — all a Free reader sees named.
//
// Depth: families sit on a ring in x/y (so the front view stays legible) but
// at clearly different depths, and each family is a ball of stars rather than
// a flat disc, so turning the sky shows real parallax instead of a card
// tilting in space.
import { bookKey, hashStr } from '../../lib/bookHelpers';

export const THREAD_MAX = 24;
export const GLIMPSE_LIT = 7;
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
    const spread = 0.46;
    const idx = families.length;
    const members = [];
    // Stable order: by key hash, so a newly read book slots in without
    // reshuffling its neighbours.
    const ordered = [...fam.books].sort((a, b) => hashStr(bookKey(a)) - hashStr(bookKey(b)));
    ordered.forEach((book, j) => {
      const h = hashStr(bookKey(book));
      const r = spread * Math.sqrt(j + 0.6);
      const th = j * GOLDEN + (h % 628) / 100;
      // Polar angle from a second slice of the hash: a uniform direction on
      // the sphere, so the family is a ball with its own depth.
      const cosPhi = 1 - 2 * (((h >> 12) % 1000) / 1000);
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      const read = book.dateRead ? Date.parse(book.dateRead) : NaN;
      const age = Number.isFinite(read) ? Math.max(0, now - read) : 3 * YEAR;
      members.push(stars.length);
      stars.push({
        book,
        key: bookKey(book),
        family: idx,
        x: cx + Math.cos(th) * sinPhi * r * 1.15,
        y: cy + Math.sin(th) * sinPhi * r,
        z: cz + cosPhi * r * 0.95,
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
      // centre + radius, for flying the camera to a family
      cx,
      cy,
      cz,
      radius: spread * Math.sqrt(n + 0.6) * 1.15 + 0.4,
      members,
    });
  };

  charted.forEach((fam, k) => {
    const a = (k / Math.max(charted.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const ring = charted.length <= 2 ? RING * 0.55 : RING;
    // Depth alternates front/back round the ring, so neighbours separate as
    // the sky turns.
    const depth = charted.length <= 2 ? 1.2 : 2.8;
    place(fam, Math.cos(a) * ring * 1.5, Math.sin(a) * ring, Math.sin(k * 2.3 + 0.6) * depth, k % 8);
  });
  if (uncharted) place(uncharted, 0, -0.4, 0, 8);

  const dated = stars
    .map((s, i) => ({ i, t: s.readAt }))
    .filter((s) => s.t != null)
    .sort((a, b) => a.t - b.t)
    .slice(-THREAD_MAX)
    .map((s) => s.i);

  // The Free glimpse: the most recent reads are lit, undated books last.
  const lit = stars
    .map((s, i) => ({ i, t: s.readAt ?? -1e15 }))
    .sort((a, b) => b.t - a.t)
    .slice(0, GLIMPSE_LIT)
    .map((s) => s.i);

  return { stars, families, thread: dated, lit };
}
