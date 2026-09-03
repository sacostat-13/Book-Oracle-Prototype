# Framed share cards — integration & build

Genre milestones and the achievement moments render as illustrated framed cards.
Text is fully dynamic; the only static per-slug assets are `frame.png` + `art.png`
(+ generated `art-trim.png`). `moment-book` is frame-only — the reader's cover
fills the slot.

## One frame + one art PER FAMILY (v0.67)

Assets used to be per genre. That ended at 167 genres growing weekly — 93 had no
folder and fell to the generic card, and the gap only widened. There are now
**16 family folders**, one per row of `genre_families`, plus `generic` and the
five `moment-*` folders.

A genre resolves to its family's folder through `GENRE_CARD_META`, which is now
**generated from the database** rather than hand-maintained:

```
node scripts/build-genre-cards.mjs     # DB  -> src/lib/genreCards.js
node scripts/build-share-cards.mjs     # PNGs -> cardGenres.js + cardBoxes.js
```

Run the first after any taxonomy or family-assignment change, the second after
adding or replacing any frame/art. They are separate on purpose: the asset script
is offline and portable, so a designer can re-measure frames without database
credentials.

`slug` is an asset path, not an identity — a dozen genres share one family's
frame by design, and the card still names the specific genre in type.

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
- `src/lib/genreCards.js` — GENERATED. Every genre: name → { slug, sub }, where
  slug is the family folder and sub is the first sentence of the genre's own
  description.
- `src/lib/cardGenres.js` — ready slugs (generated)
- `src/lib/cardBoxes.js` — per-frame opening boxes (generated)
- `src/lib/cardResolve.js` — frameSlugFor() + isFramedMoment() + MOMENT_SLUGS
- `src/components/ShareCard.jsx` — momentCopy() wraps baseCopy() with withFramed();
  framed moments drop the cover for the frame+art (book keeps the cover in the slot).
  DOM renders the framed card using the per-frame box.
- `src/lib/shareCardImage.js` — momentCardUrl() passes `frame`, `box`, and (book) `cover`.
- `netlify/functions/share-card.mjs` — framed path: loads `/cards/<frame>/frame.png`
  + art-trim (or the cover for book), renders at the passed box.
- `src/lib/genreDescriptions.js` — a stale doc line claimed this was orphaned
  while `ShareCard.jsx` still imported it as the second fallback in `genreSub()`.
  It is now genuinely dead: the generated `genreCards.js` covers every genre in
  the catalogue, so `GENRE_DESCRIPTIONS[genre]` is unreachable. Delete the file
  and its import together, after the first generator run — not before.

## Housekeeping in the asset folders

`resolveAsset()` prefers `.png` over `.jpg`/`.jpeg`, so a folder holding both is
not broken — but it is ambiguous to a human, and the loser is dead weight in the
bundle. Currently `comedy/`, `ideas/` and `romance/` carry both, and `gothic/`
has a stray `milestone.png` the build ignores. Worth a tidy.

## Prompts
- `_PROMPTS-all-genres.md` — the per-genre prompts, superseded by the 16 family
  frames but kept for reference
- `_MOMENT-PROMPTS.md` — series / milestone / goal / plan (frame+art) + book (frame only)

## Test
`netlify dev`, then complete a book that crosses a genre milestone / a series /
a year milestone, or just finish a book — each shows its framed card in preview
and share. Toggle language for the English vs. translated sub-line.
