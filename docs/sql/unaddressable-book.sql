-- Which book cannot resolve through its own share key? Read-only.
--
-- find_book_by_client_key returns nothing in exactly one situation: the title
-- half of the key is empty, which the function rejects with `where w.t <> ''`.
--
-- client_title_key strips everything outside [a-z0-9], so it returns '' for any
-- title with no ASCII alphanumerics at all — a title written entirely in
-- Korean, Japanese, Chinese, Cyrillic, Greek, Arabic, or one made only of
-- punctuation. The refusal is deliberate: an empty title half would otherwise
-- match every other title-less book in the catalogue, and answering the wrong
-- book is worse than answering none.
--
-- The consequence is real though: such a book has no shareable URL. Its key is
-- "|author", which is not addressable and never was — this is not a regression
-- from the migration, it is the migration making a pre-existing hole visible.

select
  b.id,
  b.title,
  b.author,
  b.status,
  b.source,
  public.client_title_key(b.title)                      as title_key,   -- expect ''
  public.client_author_key(b.author)                    as author_key,
  public.client_title_key(b.title) || '|' ||
    substr(public.client_author_key(b.author), 1, 10)   as would_be_url_key,
  length(coalesce(b.title, ''))                         as title_len,
  b.normalized_key
from public.books b
where not exists (
  select 1 from public.find_book_by_client_key(
    public.client_title_key(b.title) || '|' ||
    substr(public.client_author_key(b.author), 1, 10)
  )
);

-- If title_key is '' the diagnosis is confirmed. Three ways forward, in order
-- of how much you care about that one book:
--
--   1. Leave it. It is unreachable by URL and always has been. Nothing that
--      exists today links to it, because nothing can generate a link to it.
--
--   2. Give it a romanised or bilingual title, the way the catalogue already
--      holds "Soy un gato" rather than "吾輩は猫である". One UPDATE, and it
--      becomes addressable with no code change:
--        update public.books set title = '...' where id = '...';
--
--   3. Widen the key to accept non-ASCII. This is the "correct" fix and the
--      expensive one: client_title_key, bookKey() in bookHelpers.js and every
--      URL already in the wild would all have to change together, and every
--      existing shared link would break. Not worth it for one row — revisit
--      only if the catalogue takes on non-Latin titles in quantity.
