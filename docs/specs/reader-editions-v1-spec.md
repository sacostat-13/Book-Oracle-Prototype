# Reader Editions — v1 spec

*"A lot of our Spanish-speaking readers read the translation, not the original.
For tracking we already allow a custom page count, but translations usually have
their own ISBN — should the site track them?"*

## The question underneath the question

Two different things get called "the same book", and the app currently has a
word for only one of them:

- **The work.** *One Hundred Years of Solitude* by Gabriel García Márquez. One
  thing, regardless of language. This is what a recommendation is about, what a
  rating is about, what a book club reads, what belongs in a list.
- **The edition.** Sudamericana 1967, 351pp, ISBN 9780060883287, Harper 2006,
  Gregory Rabassa's translation, 417pp. This is what the reader is physically
  holding, and it is the only thing that knows how many pages there are.

`books` is a work table wearing an edition's clothes: it carries `isbn` and
`pages`, which are edition facts, on a row whose identity (`normalized_key`) is
title + author, which is a work fact.

That mismatch is invisible in English and immediately visible in Spanish. Today
a reader who reads *Cien años de soledad* either:

1. finds the English row and tracks against 417 pages they are not reading, or
2. adds a second `books` row — different title, different normalized_key, so
   the catalog now holds two rows for one novel, splitting its ratings, its
   genres, its Oracle categorisation, and its "you might also like".

Option 2 is what actually happens, and it is silent. **This is a data-integrity
problem that presents as a page-count problem.**

## Principle

**One work in the catalog. The edition belongs to the reader, not to the
catalog.**

v1 does not give translations their own pages, covers, or search results. It
gives each reader a place to record *which edition they read*, so their page
counts, progress, and stats are true — and so the shared catalog stops
accumulating duplicate rows for the same novel.

If a reader never touches it, the app behaves exactly as it does now.

## What shipped ahead of this spec (v0.64)

The author section landed first and immediately surfaced the duplication, so
two pieces of this spec were pulled forward:

- **`books.language` and `books.original_language`** (migration
  `20260817140000`). `language` is an edition fact, `original_language` a work
  fact — the same distinction this whole document rests on. `language` is
  written by `upsert_book` from lookup metadata; `original_language` only by the
  nightly Oracle pass, never guessed, never backfilled.
- **`src/lib/workGroups.js`** — collapses rows provably the same work (shared
  `hardcover_id`, ISBN, `goodreads_id`, or series+position) so a translated
  novel appears once. Used by "More by this author" and "You might also like".

That is the *display* half of the problem: the catalog still holds the duplicate
rows, they are just no longer shown twice. Everything below — recording which
edition a reader actually read, and tracking pages against it — is still open.

- **`src/lib/titleLanguage.js`** — a last-resort guess at a title's language,
  used ONLY to drop a row from a discovery strip. It exists because
  `books.language` is NULL on the whole existing catalog, so the correct filter
  has nothing to read yet: *The Dragon Keeper* was listing *Aprendiz del
  Asesino* and *La Nef Du Crépuscule* among Robin Hobb's books. It is designed
  to become dead code — callers check `row.language` first, so every row the
  backfill fills is a row this never sees again.

- **`batch-scripts/scheduled/languageBackfill.mjs`** — fills `books.language`
  from OpenLibrary (free, no key, no quota) with Google Books as a fallback.
  Every heuristic above is standing in for that column and retires as it fills.

  It refuses to write on one specific disagreement, and the refusal is the
  interesting part: `books.isbn` is chosen to make a *purchase link* work, and
  `isbnFallback.mjs --target foreign` deliberately replaces a foreign ISBN with
  an English one — so a row titled *Aprendiz del Asesino* can carry the English
  *Assassin's Apprentice* ISBN. Asking that ISBN its language returns `en`, and
  writing it would be worse than the null it replaced, because a populated
  column outranks the title heuristic everywhere. Those rows are counted and
  reported instead. **The conflict list is a direct census of the
  one-work-one-foreign-edition-per-row problem this document exists to fix** —
  it is worth reading before designing the migration below.

One consequence worth naming: `original_language` is NULL on every pre-existing
row and only the nightly pass fills it, and that pass does not revisit books it
has already categorised. Filling it for the existing catalog needs a one-off
script of the same shape as `batch-scripts/manual/authorGenderBackfill.mjs`,
which exists precisely because `author_gender` hit this exact wall in v0.62.

## What exists already

- `currently_reading.user_page_count` — the custom page count, already built,
  already surfaced in `ProgressUpdateModal` behind the "edition pages" link.
  **It is the right idea in the wrong place**: it lives on the
  currently-reading row, so it is deleted the moment the book is finished. The
  reader tells us their edition is 512 pages, finishes it, and we forget.
- `books.isbn` — one ISBN per work, picked by `editionPicker.js` for *purchase
  links*, not for the reader. It answers "where can I buy a copy", not "which
  copy do you have".
- `googleBooksLookupByIsbn` / `hardcoverLookupByIsbn` — an ISBN→metadata path
  that already exists and already returns `lang`. v1 needs no new lookup code.

## Data

One new table. Not columns on `read_books` / `wishlist_items` /
`currently_reading`: the edition is a fact about *this reader and this work*
that must survive the book moving between shelves, and three copies of it would
have to be kept in sync by every shelf transition in `DataContext`.

```sql
create table public.reader_editions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id       uuid not null references public.books(id) on delete cascade,

  language      text,           -- BCP-47 primary subtag: 'es', 'en', 'pt'
  isbn          text,           -- the edition's own ISBN, checksum-validated
  edition_title text,           -- 'Cien años de soledad' when it differs from books.title
  translator    text,
  page_count    integer,        -- supersedes currently_reading.user_page_count
  format        text,           -- 'print' | 'ebook' | 'audio'

  source        text not null default 'manual',  -- manual | isbn_lookup | import
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (user_id, book_id)
);

alter table public.reader_editions enable row level security;

create policy "reader_editions owner all" on public.reader_editions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Notes on the shape:

- **`unique (user_id, book_id)`** — one edition per reader per work. A reader
  who owns the English hardback and the Spanish paperback records the one they
  read. Re-reads in another language are a v2 problem and should not buy
  complexity now.
- **Owner-only RLS, no public read.** This is the first thing to get right:
  `SECURITY_AUDIT_v0.39.md` (C3) is about a table that was made world-readable
  to support one small feature. `reader_editions` has no cross-user use case in
  v1, so it gets none. Note the audit's H2 finding too — this migration must be
  **committed as SQL, not created in the dashboard**, or it joins the list of
  tables whose RLS nobody can verify.
- **`format`** is included because an audiobook has no page count at all, and
  without it the progress bar has to pretend. Three values, no enum table.
- **No publisher / published_year.** They would be filled in from lookups and
  read by nothing. Add them when something needs them.

### Deprecating `user_page_count`

Backfill in the same migration, then leave the column in place for one release
so a stale client does not break:

```sql
insert into public.reader_editions (user_id, book_id, page_count, source)
select user_id, book_id, user_page_count, 'manual'
  from public.currently_reading
 where user_page_count is not null
on conflict (user_id, book_id) do nothing;
```

`updateReadingProgress` writes to `reader_editions` from the day this ships and
stops writing `user_page_count`. Reads fall back to it until the column is
dropped.

## Resolution: the page count a book is tracked against

One helper, one rule, used everywhere a page number is shown or divided by:

```js
// src/lib/editions.js
export function effectivePages(book, edition) {
  return edition?.page_count || book?.pp || null;
}
```

Call sites to convert (this is the whole surface area of the feature):

| Where | Today | After |
| --- | --- | --- |
| `ProgressUpdateModal` | `catalogPages` / `overridePages` | `effectivePages` |
| Progress % on `BookPage` / `CurrentlyReading` | `book.pp` | `effectivePages` |
| `Dashboard` pages-read stats | `book.pp` | `effectivePages` |
| `accomplishments.js` page totals | `book.pp` | `effectivePages` |
| `computeSimilar` length signal | `book.pp` | `book.pp` — **unchanged** |

The last row is the point of the table. Similarity is a fact about the work;
the length of the reader's particular translation is not a better signal for it,
and using edition pages there would make one reader's recommendations differ
from another's for no reason a reader could name.

## UI

Three touchpoints. No new page, no new modal.

**1. `ProgressUpdateModal` — absorb the existing override.**
The "edition pages" link already there becomes "Which edition are you reading?",
expanding to: language select (UI languages first, then a short list), a page
count, and an optional ISBN field. Entering an ISBN runs the existing lookup and
prefills language / page count / translated title — the reader types thirteen
digits and the rest fills itself. This is a rename and an expansion of a control
that already exists, not a new one.

**2. `BookPage` — a quiet line under the title, for the owner only.**

> *Reading the Spanish edition · Cien años de soledad · 496 pp* ✎

Renders only when an edition is recorded. The heading stays the canonical title:
the page is about the work, and swapping the heading per reader would break the
one thing shared links depend on being stable.

**3. `BulkImport` / Goodreads import — read, don't ask.**
Goodreads exports carry an ISBN column, and for a Spanish-shelf import many of
them are Spanish ISBNs. Where an imported ISBN's language differs from the
matched work's, write a `reader_editions` row with `source = 'import'`. Silent,
no extra step in the import flow. This is where most of these rows will come
from.

## What v1 deliberately does not do

- **No translation search.** Typing "Cien años de soledad" into search does not
  find the English work. This is the one real gap, and it needs a shared
  `book_title_aliases` table (work → known titles, per language) which is a
  catalog-side change with its own dedupe questions. It is the obvious v1.1.
- **No per-translation covers or pages.** A Spanish edition does not get its own
  URL. It has no `books` row and should not have one.
- **No sharing of edition data.** Nothing cross-user, per the RLS note above.
- **No translator credit on the shared book page.** `reader_editions.translator`
  is recorded because it is free to capture at ISBN-lookup time and expensive to
  ask for later. Displaying it well is a catalog-side feature.

## Why this is the right first step, not a detour

The full model is `works` → `editions` → reader shelf rows, and it is
genuinely correct. It is also a change to the identity of every book in the app:
`normalized_key`, `client_book_key_lookup`, `books_share_key`, `og-prerender`,
`sitemap.js`, the dedupe scripts, and the Oracle's catalog all assume a book row
*is* a work. Doing it now means a risky migration to serve a feature nobody has
used yet.

`reader_editions` is the same change viewed from the reader's side, and it makes
the big one *easier* rather than competing with it: after a few months of use,
the distinct `(isbn, language, edition_title, page_count)` tuples across all
readers **are an observed edition table**, populated from real books real people
actually hold, rather than one seeded from a bulk metadata import. When the
split happens, this table is its seed data and its test set.

## Verification

1. Owner isolation — as user A, `select * from reader_editions` returns only
   A's rows; as anon, zero. (Run it. Do not assume: audit H2 is a list of
   tables where this was assumed.)
2. A reader records a 496-page Spanish edition of a 417-page work, finishes it,
   and reopens the book page: the edition line still reads 496. This is the
   exact case `user_page_count` fails today.
3. An audiobook edition (`format = 'audio'`, no page count) shows no progress
   bar rather than a bar stuck at 0%.
4. Two readers with different editions of the same book see the same
   recommendations from it — `computeSimilar` must not have picked up
   `effectivePages`.
5. `select count(*) from books b join books b2 on ...` — the duplicate-row count
   for known translated works should stop growing after this ships. That is the
   actual success metric; the page count is just what the reader notices.
