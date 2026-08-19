// authorWorks.js — "More by this author".
//
// One question, asked of two sources in order: what else did this person write?
//
//   1. Our own catalog, via find_books_by_author (migration 20260817120000).
//      Free, fast, indexed, and the results are books the app can already open
//      as full BookPages because they have rows.
//   2. Google Books `inauthor:`, only when the catalog answer is thin.
//
// WHY THE CATALOG COMES FIRST AND THE API IS A TOP-UP
//
// A catalog hit resolves to a real book row, which means a cover we have
// already validated, genres the Oracle has categorised, and a link that lands
// on a working page. An API hit is a name and a maybe-cover. Leading with the
// catalog also means the common case — a popular author several readers on the
// site have shelved — costs one indexed query and no external request.
//
// But leading with the catalog ALONE would make the section a mirror of what
// the site happens to have, which for a mid-list or non-Anglophone author is
// one book, or none. "More by this author: (nothing)" under a book whose
// author has written eleven novels is worse than no section at all, because it
// reads as an answer rather than as a gap. Hence the top-up.
//
// WHY GOOGLE BOOKS AND NOT HARDCOVER
//
// Hardcover is the better source for a single known book — it is first in the
// lookup chain everywhere else in the app for exactly that reason. But its
// author endpoint would need a two-step search-then-fetch dance like
// hardcoverFetchSeriesBooks, and the proxy's brace guard (30, see
// netlify/functions/hardcover.js) leaves little room for the nested selection
// that would require. Google Books answers "everything by this person" in one
// documented query parameter. This section wants breadth, not precision about
// which edition — the reader clicks through to a page that does its own
// enrichment either way.
//
// NOT AN AUTHOR PAGE
//
// On purpose. An author page means a bio, a photo, a canonical bibliography,
// and disambiguating two writers who share a name — a surface Goodreads
// already maintains. The gap here is only the hop from one book to the next by
// the same hand, so that is all this does.

import { supabase } from './supabase';
import { googleBooksByAuthor } from './googleBooksService';
import { collapseWorks } from './workGroups';
import { isForeignTo } from './titleLanguage';
import { bookKey, cleanAuthor, AUTHOR_PLACEHOLDERS, UNKNOWN_AUTHOR } from './bookHelpers';

// Below this, ask Google Books for more. Four is roughly where a cover strip
// stops looking like an accident of what we happen to hold.
//
// Counted AFTER collapsing translations, not before: a catalog holding one
// novel in six languages has six rows and one book, and topping up is exactly
// what it needs. Testing the raw count is how the section would end up padded
// with nothing while looking full.
const CATALOG_MIN = 4;

// How many rows to ask the RPC for, as a multiple of what we intend to show.
// The collapse below removes translations, and a heavily translated author is
// precisely the one whose section would otherwise come back half empty. Three
// is generous for a table of this size and costs one indexed scan either way.
const CANDIDATE_FACTOR = 3;

// Dev-only trace of how a strip was assembled.
//
// This exists because the first two attempts at fixing this section were
// debugged by reading code and guessing, and the actual cause — an unrestricted
// Google Books pass — was invisible from the outside: catalog rows and API hits
// render identically, so a strip full of translations looks the same whether
// the catalog is full of duplicates or the top-up dragged in six languages.
// One line saying which leg produced what would have answered it immediately.
//
// console.debug, so it is filtered out of the default console view, and DEV
// only, so it never ships.
function trace(stage, data) {
  try {
    if (import.meta.env?.DEV) console.debug('[authorWorks]', stage, data);
  } catch {
    // import.meta.env is absent outside Vite; tracing is never worth throwing.
  }
}

// CONTRIBUTOR FILTERING — what counts as "by this author".
//
// Google Books `inauthor:` matches the CREDIT LIST, not authorship, and for a
// short-fiction writer the credit list is mostly anthologies. Searching Amal
// El-Mohtar returns *The Mythic Dream*, *Nevertheless She Persisted*, *The
// Djinn Falls in Love and Other Stories*, *Uncanny Magazine Issue One* — books
// containing one story of hers, filed under twenty other names too. A reader
// who just finished her novel and wants another one is not helped by a
// magazine she guest-edited.
//
// Two rules, and neither is about the book's quality:
//
//   1. At most CREDIT_MAX names on the cover. A novel has one author, or two if
//      co-written. Twenty means an anthology.
//   2. This author within the first CREDIT_LEAD names. Credit order is roughly
//      billing order, so a writer listed eighth contributed a chapter.
//
// Both are heuristics over metadata we do not control, and they will
// occasionally drop a legitimate collaboration — a four-hand serial like
// *Bookburners* is exactly the borderline case. That is the right way to be
// wrong here: this is a discovery strip, and one missing entry costs a reader
// far less than six anthologies burying the two novels they came for.
//
// Deliberately NOT filtering on "and Other Stories" in the title. It reads like
// an anthology marker and is just as often a single author's own collection
// (*Bloodchild and Other Stories* is all Octavia Butler), so the credit count
// carries this and the title rule stays narrow — periodicals only, which are
// never "another book by" anyone.
const CREDIT_MAX = 3;
const CREDIT_LEAD = 2;
const PERIODICAL_RX = /\b(magazine|issue\s+(#\s*)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b|quarterly|\bannual\b)/i;

// The section is a horizontal strip; past a dozen nobody scrolls, and an
// author with sixty titles should not push the rest of the page down.
export const AUTHOR_WORKS_LIMIT = 12;

// Same collapse as public.client_author_key in SQL, so the client can decide
// whether two author strings are the same person WITHOUT a round trip — used
// below to drop Google Books hits for a different writer with a similar name.
// Kept in sync with that function by construction: both strip everything that
// is not [a-z0-9] and neither unaccents.
export function authorKey(a) {
  return (a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Map a `books` row to the shape the rest of the app uses.
//
// Same deliberate duplication as shareKey.js's rowToBook: DataContext's
// bookRowToClient also unpacks series joins and per-user fields (rating, notes,
// dateRead) that this query neither selects nor could populate for a book the
// reader does not own. Borrowing its name without its inputs would invite a
// caller to assume those fields are there.
function rowToBook(r) {
  if (!r) return null;
  return {
    bookId: r.id,
    t: r.title,
    a: r.author || '',
    d: r.description || undefined,
    pp: r.pages || undefined,
    g: r.genre || undefined,
    c: r.complexity || undefined,
    p: r.depth || undefined,
    coverUrl: r.cover_url || undefined,
    isbn: r.isbn || undefined,
    status: r.status || 'unreviewed',
    source: r.source,
    // Carried for collapseWorks, which needs them to tell a translation from a
    // different book. `setof books` has no series join, so these stay flat
    // rather than nesting under `s` — populating `s` without a series NAME
    // would make BookPage render a series block for a book that has none.
    hardcoverId: r.hardcover_id ?? undefined,
    goodreadsId: r.goodreads_id ?? undefined,
    seriesId: r.series_id || undefined,
    seriesPosition: r.position_in_series ?? undefined,
    language: r.language || undefined,
    originalLanguage: r.original_language || undefined,
  };
}

// An author string we can actually search on. The catalog carries a documented
// set of placeholder authors ("Unknown author", "Various", …) — running the
// section for those would group thousands of unrelated books under one name,
// which is the single worst thing this feature could do.
function usableAuthor(a) {
  const cleaned = cleanAuthor(a || '');
  if (!cleaned) return null;
  if (cleaned === UNKNOWN_AUTHOR) return null;
  if (AUTHOR_PLACEHOLDERS.has(cleaned.toLowerCase())) return null;
  // A single word is usually a mononym ("Homer") but is also what a truncated
  // or malformed record looks like. Allowed, because Homer is real, but it is
  // the case to look at first if this section ever surfaces nonsense.
  return cleaned;
}

/**
 * Other books by `author`, catalog first, topped up from Google Books.
 *
 * Never throws and never rejects: an empty array renders no section, which is
 * the correct outcome for every failure mode here. A book page must not break
 * because an author lookup did.
 *
 * @param {string}  author       the author to look up
 * @param {object}  opts
 * @param {object}  opts.currentBook   the book being viewed; it AND every
 *                  translation of it are removed from the result
 * @param {string}  opts.excludeTitle  title of the book being viewed
 * @param {number}  opts.limit
 * @param {string}  opts.lang    anchor language for the Google Books top-up
 * @returns {Promise<Array>} book-shaped objects, catalog rows first
 */
export async function fetchAuthorWorks(author, opts = {}) {
  const {
    currentBook = null,
    excludeTitle = null,
    limit = AUTHOR_WORKS_LIMIT,
    lang = 'en',
  } = opts;

  const name = usableAuthor(author);
  if (!name) return [];

  const wantedKey = authorKey(name);

  // The book being viewed goes in FIRST, as a sentinel.
  //
  // `_exclude_title` on the RPC removes rows with the same title, and that is
  // not the same thing as removing the same book: viewing *The River Has Roots*
  // still returned *El río tiene raíces*, its own Spanish translation, as
  // "more by this author". The titles differ, so no title test can catch it.
  //
  // Seeding the candidate list with the current book means the collapse below
  // groups its translations with it using the same signals as everything else,
  // and dropping that one group removes all of them. collapseWorks emits each
  // group at the position of its earliest member and the sentinel is index 0,
  // so the current book's group is always the first entry out — which is what
  // makes the slice(1) below exact rather than hopeful.
  const sentinel = currentBook?.t
    ? { ...currentBook, __current: true }
    : (excludeTitle ? { t: excludeTitle, a: name, __current: true } : null);

  const candidates = sentinel ? [sentinel] : [];

  // ── 1. the catalog ────────────────────────────────────────────────────────
  try {
    const { data, error } = await supabase.rpc('find_books_by_author', {
      _author: name,
      _exclude_title: excludeTitle || null,
      _limit: limit * CANDIDATE_FACTOR,
    });
    if (error) {
      console.warn('[authorWorks] catalog lookup failed', error.message);
    } else {
      for (const row of data || []) {
        const b = rowToBook(row);
        if (!b) continue;
        // The catalog leg needs its own language filter, and this is the only
        // place it can happen.
        //
        // find_books_by_author returns every row for the author regardless of
        // language, and for a widely-translated writer that is most of them:
        // *The Dragon Keeper* showed *Aprendiz del Asesino*, *La Nef Du
        // Crépuscule* and *Die Tochter des Wolfs* next to the English novels.
        // The collapse cannot help — those are separate rows sharing no
        // identifier with their English originals — and books.language is NULL
        // on everything predating v0.64, so isForeignTo falls back to reading
        // the title. See titleLanguage.js for why that is safe HERE and
        // nowhere else.
        if (isForeignTo(b, lang)) {
          trace('skip:language', { t: b.t, declared: b.language || null });
          continue;
        }
        candidates.push(b);
      }
    }
  } catch (e) {
    console.warn('[authorWorks] catalog lookup threw', e?.message || e);
  }

  // Collapse before deciding whether the catalog answer was thin.
  //
  // This is the step the section is really about. A translated author's rows
  // are one novel per language — twelve rows, four books — and without this the
  // strip shows the same six covers under six different titles, which is what
  // it looked like the first time it ran against a real catalog.
  const collapse = (list) => {
    const grouped = collapseWorks(list, { uiLang: lang });
    // Drop the sentinel's group (always first out — see above). Guarded rather
    // than assumed: if the sentinel ever stops being index 0, this filters by
    // the flag instead of silently eating a real book.
    return sentinel
      ? grouped.filter((b, i) => !(i === 0 || b.__current))
      : grouped;
  };

  let works = collapse(candidates);
  trace('catalog', {
    author: name,
    anchorLang: lang,
    rows: candidates.length - (sentinel ? 1 : 0),
    afterCollapse: works.length,
    topUpNeeded: works.length < CATALOG_MIN,
  });

  if (works.length >= CATALOG_MIN) return works.slice(0, limit);

  // ── 2. the top-up ─────────────────────────────────────────────────────────
  try {
    const hits = await googleBooksByAuthor(name, { lang, limit: limit * 2 });
    for (const h of hits) {
      // Google Books matches `inauthor:` loosely enough to return a different
      // writer entirely — an anthology contributor, or a similarly-named
      // person — so a hit still has to name the author we asked about.
      //
      // But it must be checked against the WHOLE credit list, not just the
      // first name. *This Is How You Lose the Time War* is co-written, and
      // Google returns Max Gladstone first on some editions and Amal El-Mohtar
      // first on others. Testing authors[0] dropped the book on half its
      // editions and, on the other half, produced a record whose author string
      // disagreed with our catalog row for the same novel — so the two never
      // grouped, and the section showed the book twice.
      const credits = (h.authors?.length ? h.authors : [h.a]).filter(Boolean);
      const billing = credits.findIndex((c) => authorKey(c) === wantedKey);
      if (billing === -1) continue;

      // See CREDIT_MAX / CREDIT_LEAD above: an anthology this author has one
      // story in is not "more by this author".
      if (credits.length > CREDIT_MAX || billing >= CREDIT_LEAD) {
        trace('skip:contributor', { t: h.t, credits: credits.length, billing });
        continue;
      }
      if (PERIODICAL_RX.test(h.t || '')) {
        trace('skip:periodical', { t: h.t });
        continue;
      }

      // googleBooksByAuthor already drops volumes that DECLARE another
      // language. This catches the ones that declare none, where only the title
      // is left to go on.
      if (isForeignTo({ t: h.t, language: h.lang }, lang)) {
        trace('skip:language', { t: h.t, declared: h.lang || null });
        continue;
      }

      candidates.push({
        ...h,
        // Canonicalise to the author whose page this is. The book genuinely is
        // by them, and matching our catalog row's author string is what lets
        // the collapse recognise the two records as one book.
        a: name,
        language: h.lang || undefined,
        fromLookup: true,
      });
    }
  } catch (e) {
    console.warn('[authorWorks] top-up threw', e?.message || e);
  }

  // Collapse the COMBINED list, not the top-up alone. A Google Books hit
  // carrying an ISBN we already hold is the same book arriving from a second
  // source, and scoring decides which entry survives — which is why the catalog
  // row, with its bookId and validated cover, generally wins.
  works = collapse(candidates);
  trace('result', works.slice(0, limit).map((b) => ({
    t: b.t,
    lang: b.language || '?',
    from: b.fromLookup ? 'googlebooks' : 'catalog',
  })));
  return works.slice(0, limit);
}
