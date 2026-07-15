# Framed genre share cards — integration notes

Genre milestone moments (`genre_count`, `new_genre`) render as the illustrated
framed card. Text stays fully dynamic; the only static per-genre assets are
`frame.png` + `art.png` (+ generated `art-trim.png`).

## What changed
- **`netlify/functions/share-card.mjs`** — new framed path. When the request has
  `?genre=<name>` and both `/cards/<genre>/frame.png` and `/cards/<genre>/art-trim.png`
  exist, it composes them with the live eyebrow/headline/sub at 1080×1350.
  If either asset is missing it falls back to the standard cover card, so it can
  never 500 on a not-yet-ready genre. Added Instrument Serif *italic* for the sub.
- **`src/components/ShareCard.jsx`** — `momentCopy(moment, t, lang)`:
  per-genre sub-line (English only) with i18n fallback; for genres with assets it
  marks the moment `framed` and drops the book cover.
- **`src/lib/shareCardImage.js`** — `momentCardUrl` passes `genre`; adds
  `isFramedMoment()`.
- **`src/components/ShareMomentModal.jsx`** — previews the real server PNG for
  framed moments (preview == share); DOM card for everything else.
- **`src/lib/genreDescriptions.js`** — 83 tone-matched sub-lines.
- **`src/lib/cardGenres.js`** — auto-generated list of genres that have assets.

## Genre milestones showcase the ART (not the book cover)
For `genre_count` / `new_genre` on a genre that has assets, `momentCopy()` drops
the completing book's cover and marks the moment `framed`, so the card shows the
genre frame + art. The modal previews the actual server-rendered PNG for these
moments (`isFramedMoment`), so preview matches the shared image. Genres without
assets keep the normal cover card.

`cardGenres.js` is the gate that decides framed vs cover. Re-run prep after adding
assets so new genres light up.

## Per-genre assets (build step)
Each genre needs a trimmed art file next to the frame. The prep script measures
the frame opening, writes `art-trim.png` into each `public/cards/<genre>/`, and
regenerates `src/lib/cardGenres.js`. Commit `frame.png`, `art.png`, `art-trim.png`.

The content-safe opening box is a shared constant in the function
(`FRAME_BOX = { x:291, y:256, w:485, h:782 }`) since all frames use the same
border. If a frame's opening differs, re-measure and switch to a per-genre map.

## Test locally (requires the function → use `netlify dev`, not plain vite)
```
netlify dev
# genre_count (10 books), English:
/.netlify/functions/share-card?genre=Classic%20%26%20Older%20Gothic&eyebrow=A%20devoted%20reader&headline=10%20Classic%20%26%20Older%20Gothic%20books&sub=The%20house%20remembers%20every%20reader%20who%20dares%20its%20halls.
# Spanish: eyebrow=Devoci%C3%B3n%20lectora&headline=10%20libros%20de%20Classic%20%26%20Older%20Gothic&sub=Hay%20estantes%20que%20exigen%20devoci%C3%B3n.
```
In the app, finish a book that crosses a genre milestone in Classic & Older
Gothic — the modal preview and the shared PNG both show the framed art card.

## Caveat — i18n
`GENRE_DESCRIPTIONS` is English only; Spanish falls back to the generic translated
sub. Add an `es` map + switch the gate by `lang` for bespoke Spanish lines.

## Commit guidance
The working tree shows many unrelated files as modified — a pre-existing CRLF/LF
line-ending artifact in this checkout, not this change. Commit only:
- `netlify/functions/share-card.mjs`
- `src/components/ShareCard.jsx`
- `src/components/ShareMomentModal.jsx`
- `src/lib/shareCardImage.js`
- `src/lib/genreDescriptions.js`
- `src/lib/cardGenres.js`
- `public/cards/**` (frame.png / art.png / art-trim.png per ready genre)
