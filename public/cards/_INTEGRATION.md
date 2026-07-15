# Framed share cards — integration & build

Genre milestones and the achievement moments render as illustrated framed cards.
Text is fully dynamic; the only static per-slug assets are `frame.png` + `art.png`
(+ generated `art-trim.png`). `moment-book` is frame-only — the reader's cover
fills the slot.

## Build step (run in the repo, on your machine)
The sandbox that generated the code can't reliably read every asset folder, so the
prep is a portable Node script that runs where the files live:

```
npm i -D pngjs jpeg-js   # one time (handles .png and .jpg/.jpeg)
node scripts/build-share-cards.mjs
```

It scans `public/cards/<slug>/` and regenerates three things:
- `public/cards/<slug>/art-trim.png` — art with the generator's dark margins removed
- `src/lib/cardGenres.js` — slugs whose framed card is ready (the on/off gate)
- `src/lib/cardBoxes.js` — each frame's measured content-safe opening box

Re-run it any time you add or replace a frame/art. Commit the regenerated
`art-trim.png`, `cardGenres.js`, and `cardBoxes.js`.

## How a moment resolves (src/lib/cardResolve.js)
- `genre_count` / `new_genre` → `GENRE_CARD_META[genre].slug`
- `series_completed → moment-series`, `nth_book → moment-milestone`,
  `goal_completed → moment-goal`, `plan_completed → moment-plan`,
  `book_completed → moment-book`
- A moment renders framed only if its slug is in `CARD_GENRES` (assets present).
  `book_completed` additionally needs a cover.

## Files
- `src/lib/genreCards.js` — 49 genres: name → { slug, sub } (sub = English card line)
- `src/lib/cardGenres.js` — ready slugs (generated)
- `src/lib/cardBoxes.js` — per-frame opening boxes (generated)
- `src/lib/cardResolve.js` — frameSlugFor() + isFramedMoment() + MOMENT_SLUGS
- `src/components/ShareCard.jsx` — momentCopy() wraps baseCopy() with withFramed();
  framed moments drop the cover for the frame+art (book keeps the cover in the slot).
  DOM renders the framed card using the per-frame box.
- `src/lib/shareCardImage.js` — momentCardUrl() passes `frame`, `box`, and (book) `cover`.
- `netlify/functions/share-card.mjs` — framed path: loads `/cards/<frame>/frame.png`
  + art-trim (or the cover for book), renders at the passed box.
- `src/lib/genreDescriptions.js` — ORPHANED (superseded by genreCards.js); safe to delete.

## Prompts
- `_PROMPTS-all-genres.md` — 49 genre frame+art prompts (self-contained)
- `_MOMENT-PROMPTS.md` — series / milestone / goal / plan (frame+art) + book (frame only)

## Test
`netlify dev`, then complete a book that crosses a genre milestone / a series /
a year milestone, or just finish a book — each shows its framed card in preview
and share. Toggle language for the English vs. translated sub-line.
