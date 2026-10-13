// genreDisplay.js — one answer to "what genres do I render for this book?"
//
// WHY THIS EXISTS
//
// Three surfaces (BookPage, BookCard, BookModal) each wrote the same four
// lines independently:
//
//   const oracleGenres = state.genresByBookId?.[book.bookId];
//   const genres = oracleGenres?.length ? oracleGenres : (book.g ? [{...}] : []);
//
// which reads as "use the real genres, fall back to the legacy scalar" but
// actually behaves as "use the legacy scalar until the network catches up".
// `state.genresByBookId` initialises to `{}` and is filled by chunked
// `book_genres_view` queries in DataContext, so on first paint EVERY book
// misses the lookup and renders exactly one chip — the legacy `books.genre`
// column. When the chunks land, the full set replaces it and chips appear to
// pop in from nowhere. That is the reported bug, and it is not a race in the
// views: it is an empty object being indistinguishable from "this book
// genuinely has no genre links".
//
// The fix is to make that distinction explicit. `resolveGenres` returns a
// `pending` flag so a caller can hold the row rather than render a value it is
// about to contradict.
//
// THE SECOND, QUIETER BUG
//
// `genresByBookId` is only populated for the ids in wishlist + library (see
// `allBookIds` in DataContext). A Book Page opened for a book on neither shelf
// — from The Stacks, from search, from a shared link — is not merely late, it
// is never coming. Waiting on `loading` would spin forever. So `pending` is
// true only while the context is still loading AND this book is one the
// context is actually going to fetch. Otherwise the legacy scalar is the best
// and final answer, and we render it immediately.

const EMPTY = [];

/**
 * @param {object}  state        DataContext state
 * @param {boolean} loading      DataContext `loading`
 * @param {object}  book         a display book ({ bookId, g })
 * @returns {{ genres: Array<{name: string, description: ?string}>, pending: boolean }}
 */
export function resolveGenres(state, loading, book) {
  if (!book) return { genres: EMPTY, pending: false };

  const linked = book.bookId ? state?.genresByBookId?.[book.bookId] : null;

  // Known links win outright, loading or not.
  if (linked && linked.length > 0) {
    return { genres: linked, pending: false };
  }

  // No links yet. Is one of the chunked queries going to bring some?
  // Only if the book is on a shelf we hydrate, and hydration is still running.
  if (loading && book.bookId && isHydratable(state, book.bookId)) {
    return { genres: EMPTY, pending: true };
  }

  // Settled: this book has no genre links. The legacy scalar is all there is.
  return {
    genres: book.g ? [{ name: book.g, description: null }] : EMPTY,
    pending: false,
  };
}

// Mirrors the `allBookIds` set DataContext builds before querying
// book_genres_view. If this ever diverges, the symptom is a chip that flickers
// (claimed settled, then updated) — not a crash.
function isHydratable(state, bookId) {
  if (!state) return false;
  for (const shelf of [state.wishlist, state.library, state.readNext]) {
    if (!shelf) continue;
    for (const b of shelf) {
      if (b.bookId === bookId) return true;
    }
  }
  return false;
}

/** Convenience for surfaces that only want names. */
export function resolveGenreNames(state, loading, book) {
  const { genres, pending } = resolveGenres(state, loading, book);
  return { names: genres.map((g) => g.name), pending };
}
