# Frame + Art prompts — shared moment cards

These are the **non-genre** milestone cards — Series Completed, Books-of-the-Year, Reading Goal, Reading Plan. Give each **one reusable frame + art** (not one per series or per number): the series name, count, or goal all vary through the card's text, so every share is still unique while the artwork stays consistent and the asset count stays small.

Same rules as the genre prompts: the style block is written into every prompt — **copy a whole block verbatim**. Hero fills the card; Frame is the ornate border with an empty center. Save to the folder shown under each moment.

| Moment | `moment.type` | Folder | Headline is |
|---|---|---|---|
| Series Completed | `series_completed` | `public/cards/moment-series/` | the series name (e.g. "The Locked Tomb") |
| Books-of-the-Year Milestone | `nth_book` | `public/cards/moment-milestone/` | the count read this year (e.g. "10 books read") |
| Reading Goal Reached | `goal_completed` | `public/cards/moment-goal/` | the goal (e.g. "50 books, 2026") |
| Reading Plan Completed | `plan_completed` | `public/cards/moment-plan/` | the plan title |

> Wiring note: today only genre milestones use frame+art. To turn these on, `momentCopy()` marks these moment types `framed` and points `frameUrl`/`artUrl` at the folders below — the same mechanism as genres. Happy to do that wiring once the art exists.

---

## Series Completed
Folder: `public/cards/moment-series/`  ·  fires on `series_completed`  ·  headline = the series name (e.g. "The Locked Tomb")

**Hero image** → `art.png`

```
Monochromatic gold engraving on dark ink. Single-color intaglio / fine-line etching, like an antique book plate. Gold palette only: highlights #D8B85E, mid #C9A84C, on a near-black ink background (#141210 core, #0d0b09 edges). No other hues. Restrained dark-academia elegance, symmetrical, high detail in the linework, low overall brightness. No text, no lettering, no signature, no border or frame. Flat, no photographic depth of field. Subject: a row of matching bound volumes standing together on a shelf, the final one just slotted into place, a trailing ribbon bookmark and a small laurel resting atop the completed set. Centered, symmetrical composition with generous dark negative space at the top and bottom third for overlaid type. Aspect ratio 4:5 (portrait), 1080x1350.
```

**Illustrated frame** → `frame.png`

```
Monochromatic gold engraving on dark ink. Single-color intaglio / fine-line etching, like an antique book plate. Gold palette only: highlights #D8B85E, mid #C9A84C, on a near-black ink background (#141210 core, #0d0b09 edges). No other hues. Restrained dark-academia elegance, symmetrical, high detail in the linework, low overall brightness. No text, no lettering, no signature, no border or frame. Flat, no photographic depth of field. An ornate Art Nouveau border frame only. The decoration lives in the outer margin band — roughly the outer 12% on every side — and the entire center is EMPTY flat dark ink (#141210), a clean rectangular text area with nothing in it. Motif woven into the border: interwoven ribbons and stacked book spines, with a laurel wreath at top center and a wax seal at bottom center. Symmetrical, fine gold linework, a crisp thin gold keyline on the inner edge. 1080x1350 portrait. No text.
```

---

## Books-of-the-Year Milestone
Folder: `public/cards/moment-milestone/`  ·  fires on `nth_book`  ·  headline = the count read this year (e.g. "10 books read")

**Hero image** → `art.png`

```
Monochromatic gold engraving on dark ink. Single-color intaglio / fine-line etching, like an antique book plate. Gold palette only: highlights #D8B85E, mid #C9A84C, on a near-black ink background (#141210 core, #0d0b09 edges). No other hues. Restrained dark-academia elegance, symmetrical, high detail in the linework, low overall brightness. No text, no lettering, no signature, no border or frame. Flat, no photographic depth of field. Subject: a tall stack of books rising like a tower toward a crescent moon and scattered stars, a small figure seated reading at its foot. Centered, symmetrical composition with generous dark negative space at the top and bottom third for overlaid type. Aspect ratio 4:5 (portrait), 1080x1350.
```

**Illustrated frame** → `frame.png`

```
Monochromatic gold engraving on dark ink. Single-color intaglio / fine-line etching, like an antique book plate. Gold palette only: highlights #D8B85E, mid #C9A84C, on a near-black ink background (#141210 core, #0d0b09 edges). No other hues. Restrained dark-academia elegance, symmetrical, high detail in the linework, low overall brightness. No text, no lettering, no signature, no border or frame. Flat, no photographic depth of field. An ornate Art Nouveau border frame only. The decoration lives in the outer margin band — roughly the outer 12% on every side — and the entire center is EMPTY flat dark ink (#141210), a clean rectangular text area with nothing in it. Motif woven into the border: climbing ivy and scattered stars, with a radiant star at top center and a laurel wreath at bottom center. Symmetrical, fine gold linework, a crisp thin gold keyline on the inner edge. 1080x1350 portrait. No text.
```

---

## Reading Goal Reached
Folder: `public/cards/moment-goal/`  ·  fires on `goal_completed`  ·  headline = the goal (e.g. "50 books, 2026")

**Hero image** → `art.png`

```
Monochromatic gold engraving on dark ink. Single-color intaglio / fine-line etching, like an antique book plate. Gold palette only: highlights #D8B85E, mid #C9A84C, on a near-black ink background (#141210 core, #0d0b09 edges). No other hues. Restrained dark-academia elegance, symmetrical, high detail in the linework, low overall brightness. No text, no lettering, no signature, no border or frame. Flat, no photographic depth of field. Subject: a lone figure reaching a mountain summit at dawn and planting a banner, an open book and a bright star crowning the peak. Centered, symmetrical composition with generous dark negative space at the top and bottom third for overlaid type. Aspect ratio 4:5 (portrait), 1080x1350.
```

**Illustrated frame** → `frame.png`

```
Monochromatic gold engraving on dark ink. Single-color intaglio / fine-line etching, like an antique book plate. Gold palette only: highlights #D8B85E, mid #C9A84C, on a near-black ink background (#141210 core, #0d0b09 edges). No other hues. Restrained dark-academia elegance, symmetrical, high detail in the linework, low overall brightness. No text, no lettering, no signature, no border or frame. Flat, no photographic depth of field. An ornate Art Nouveau border frame only. The decoration lives in the outer margin band — roughly the outer 12% on every side — and the entire center is EMPTY flat dark ink (#141210), a clean rectangular text area with nothing in it. Motif woven into the border: laurel branches and rays of fine engraved light, with a single radiant star at top center and an open book at bottom center. Symmetrical, fine gold linework, a crisp thin gold keyline on the inner edge. 1080x1350 portrait. No text.
```

---

## Reading Plan Completed
Folder: `public/cards/moment-plan/`  ·  fires on `plan_completed`  ·  headline = the plan title

**Hero image** → `art.png`

```
Monochromatic gold engraving on dark ink. Single-color intaglio / fine-line etching, like an antique book plate. Gold palette only: highlights #D8B85E, mid #C9A84C, on a near-black ink background (#141210 core, #0d0b09 edges). No other hues. Restrained dark-academia elegance, symmetrical, high detail in the linework, low overall brightness. No text, no lettering, no signature, no border or frame. Flat, no photographic depth of field. Subject: an unrolled parchment map with a winding route marked by small stars, its final point reached, a quill and a wax seal resting beside it. Centered, symmetrical composition with generous dark negative space at the top and bottom third for overlaid type. Aspect ratio 4:5 (portrait), 1080x1350.
```

**Illustrated frame** → `frame.png`

```
Monochromatic gold engraving on dark ink. Single-color intaglio / fine-line etching, like an antique book plate. Gold palette only: highlights #D8B85E, mid #C9A84C, on a near-black ink background (#141210 core, #0d0b09 edges). No other hues. Restrained dark-academia elegance, symmetrical, high detail in the linework, low overall brightness. No text, no lettering, no signature, no border or frame. Flat, no photographic depth of field. An ornate Art Nouveau border frame only. The decoration lives in the outer margin band — roughly the outer 12% on every side — and the entire center is EMPTY flat dark ink (#141210), a clean rectangular text area with nothing in it. Motif woven into the border: a winding dotted route and small scattered stars, with a compass rose at top center and a wax seal at bottom center. Symmetrical, fine gold linework, a crisp thin gold keyline on the inner edge. 1080x1350 portrait. No text.
```

---

## Book Completed  ·  frame only (no art)
Folder: `public/cards/moment-book/`  ·  fires on `book_completed`  ·  headline = the book title

This is the **only** card whose slot holds the reader's actual **book cover** — so generate the **frame only**. Do NOT make an `art.png`; the cover (any aspect ratio) drops into the opening via `object-fit: contain`, matted in the same thin gold border. Keep the opening generous and portrait-friendly so a 2:3 cover sits cleanly.

**Illustrated frame** → `frame.png` (no `art.png`)

```
Monochromatic gold engraving on dark ink. Single-color intaglio / fine-line etching, like an antique book plate. Gold palette only: highlights #D8B85E, mid #C9A84C, on a near-black ink background (#141210 core, #0d0b09 edges). No other hues. Restrained dark-academia elegance, symmetrical, high detail in the linework, low overall brightness. No text, no lettering, no signature, no border or frame. Flat, no photographic depth of field. An ornate Art Nouveau border frame only. The decoration lives in the outer margin band — roughly the outer 12% on every side — and the entire center is EMPTY flat dark ink (#141210), a clean rectangular text area with nothing in it. Motif woven into the border: ivy, laurel branches, and a trailing ribbon bookmark, with a laurel wreath at top center and a quill and inkwell at bottom center. Symmetrical, fine gold linework, a crisp thin gold keyline on the inner edge. 1080x1350 portrait. No text.
```

---

