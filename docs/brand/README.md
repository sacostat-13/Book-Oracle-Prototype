# The Books Oracle: brand assets

**Mark:** an open book whose page lines draw an eye, with a gold back page on the right. Traced 1:1 from the chosen design (1024px source, 97.8% pixel overlap).

**Colors:** Ink `#16213A` · Gold `#C9A15B` (only on the right back page) · Parchment `#F5EFE4`
**Wordmark:** Instrument Serif (the app's display face), converted to outlines in the SVGs.

| File | Use |
|---|---|
| `svg/mark-light.svg` / `mark-dark.svg` | mark for light / dark backgrounds |
| `svg/mark-mono-ink.svg` / `mark-mono-white.svg` | single-color uses |
| `svg/app-icon.svg`, `app-icon-cream.svg`, `app-icon-fullbleed.svg`, `app-icon-maskable.svg` | app icon tiles |
| `svg/favicon-light.svg` | the site favicon: bold trace, light-mode mark on parchment, 16–48px |
| `svg/favicon.svg` | bold trace on the navy tile (alternative) |
| `svg/lockup-*.svg`, `svg/wordmark-*.svg` | mark + name, name only |
| `social/` | avatar 1080, OG 1200×630 (light/dark), banner 1500×500 |

The PNGs the site serves live in `public/` (`logo-*-mode.png`, `favicon.ico`, `icons/`, `brand/`).

**Rebuild:** `pip install fonttools uharfbuzz cairosvg pillow` then `python docs/brand/src/build.py` (writes to `docs/brand/out/`).

Rules: keep clear space of at least ¼ of the mark's width. Don't recolor the gold page.
