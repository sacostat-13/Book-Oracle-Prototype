# Update Notes — v0.4 → v0.5

This is a small, no-migration iteration that adds two things:

1. **On-demand metadata caching** — when you open a book modal, any missing fields (cover, pages, description, ISBN) get fetched once and persisted to the shared `books` row. Every subsequent open is instant.
2. **Purchase links** — Amazon and Bookshop.org buttons in the book modal, alongside the existing wishlist/library actions.

## Database changes

**None.** This iteration only writes to columns that already exist (`cover_url`, `pages`, `description`, `isbn`, `hardcover_id`) via the existing `upsert_book` RPC. The RPC's coalesce-style merge means it only fills nulls, so verified/curated rows never get clobbered.

## Code changes

- `src/lib/purchaseLinks.js` (new) — builds Amazon + Bookshop URLs from whatever data we have (Amazon URL stored on book → ISBN/ASIN → title+author search fallback)
- `src/components/BookCover.jsx` — accepts an optional `coverUrl` prop and uses it immediately, skipping the OpenLibrary/Google Books network fetch entirely when present
- `src/components/BookCard.jsx` — passes `book.coverUrl` to `BookCover`
- `src/components/BookModal.jsx` — runs on-demand enrichment when opened; displays both purchase buttons in a new "Acquire this book" section above the action bar
- `src/lib/DataContext.jsx` — new `cacheBookFields(book, patch)` function that mirrors enriched fields into local state and calls `upsert_book` to persist
- `src/styles/main.scss` — new styles for the purchase block

## Deploy

Just push and Netlify rebuilds:

```bash
git add .
git commit -m "On-demand metadata caching + purchase links"
git push
```

## Affiliate tags (optional, for later)

Two env vars are wired in but optional. Leave them unset for now and the purchase links work as plain URLs.

When you're ready:

1. Sign up for [Amazon Associates](https://affiliate-program.amazon.com/) — note Costa Rica isn't in the main eligible regions, but you can sign up via amazon.com and route earnings via PayPal or gift cards. Read their TOS.
2. Sign up for [Bookshop.org affiliate program](https://bookshop.org/affiliate-program) — simpler, no regional restrictions.
3. Add to Netlify environment variables:
   ```
   VITE_AMAZON_AFFILIATE_TAG=your-tag-20
   VITE_BOOKSHOP_AFFILIATE_ID=your-bookshop-id
   ```
4. Redeploy. The links automatically include your tags.

Per US FTC rules you should also add an affiliate disclosure somewhere (a small note at the bottom of the modal or in the footer). That's a polish item for when you're ready to go live with real tags.

## Verify it works

1. Open any book modal — should load instantly
2. Watch the Network tab — first open of a book without cached data shows fetches to OpenLibrary/Hardcover, subsequent opens of the same book have **no** book-data fetches
3. Check the Supabase `books` table after opening a few modals — `cover_url`, `pages`, `description` columns should start populating
4. The two purchase buttons appear in every modal — for books with an ISBN they go to product pages, otherwise to search pages
5. Books without enough info (a manually-typed book with no other data) still get search-fallback purchase links

## What didn't change

- View modes (shelves/wall/list) — deferred
- Per-book route pages — deferred
- Background bulk enrichment — replaced with on-demand only
- Schema — no migration
- Existing user data — all preserved

## Behavior to know

- **Modals feel slower on first open per book** — the enrichment runs in parallel with rendering, so the modal opens instantly but pages/description may pop in after a beat. Cached opens are instant.
- **Guest sessions still work**, just without server-side caching. Each modal open re-fetches everything for that session. Once the user signs in, future opens cache normally.
- **Cards on the dashboard/wishlist/library** now show cached covers immediately without the brief placeholder flash, but only for books that have been opened at least once. Cover hits accumulate over time as users browse.
