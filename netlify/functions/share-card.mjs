// netlify/functions/share-card.mjs — v0.43
//
// Server-rendered share card (PNG) for The Books Oracle.
//
// WHY: the client card (src/components/ShareCard.jsx) is exported to PNG with
// html-to-image, which draws cover images onto a <canvas>. Covers come from
// third-party hosts (OpenLibrary, Wikimedia, …) that don't send CORS headers,
// so the canvas taints and the export throws (the `share card export failed`
// error). Rendering here fetches the cover server-to-server — no CORS — and
// returns a real PNG that can be shared as a file. This is the satori endpoint
// the ShareCard header comment anticipated; keep the two visually in sync.
//
// This function is intentionally i18n-agnostic: the caller resolves all copy
// (eyebrow/headline/sub/ornament/caption) via the client t() system and passes
// the finished strings as query params. The same endpoint therefore serves OG
// images later (v0.42) by passing server-built strings.
//
// Output: 1080×1350 PNG (2× of the 540×675 DOM card), image/png.
//
// NOTE — this file is .mjs on purpose. satori and @resvg/resvg-wasm are
// ESM-only and marked external in netlify.toml (they ship wasm assets esbuild
// can't inline). A .js function gets bundled to CommonJS, turning `import
// satori` into `require('satori')`, which fails on the ESM-only package
// (`Cannot find module satori/dist/index.cjs`). .mjs keeps it native ESM.
//
// Deps (root package.json): satori, @resvg/resvg-wasm, image-size

import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { imageSize } from 'image-size';

// These are bundled into the function by esbuild (Netlify's default). satori's
// Yoga layout engine is embedded inline (base64) in its JS, so there is NO
// external .wasm asset to lose — it bundles cleanly. Do NOT mark satori or
// @resvg/resvg-wasm as external_node_modules: that forces esbuild to emit
// require()/interop for these ESM-only packages, which fails on Lambda
// (`Cannot find module .../index.cjs`, `import_satori.default is not a
// function`). Bundling inline avoids all of that.

// The resvg wasm is loaded once at cold start, the same way fonts are.
// Keep this version pinned to the installed @resvg/resvg-wasm version.
const RESVG_WASM_URL = 'https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm';
let _wasmReady = null;
function ensureWasm() {
  if (!_wasmReady) {
    _wasmReady = fetch(RESVG_WASM_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`resvg wasm fetch failed ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => initWasm(buf))
      .catch((e) => { _wasmReady = null; throw e; }); // allow retry on next call
  }
  return _wasmReady;
}

/* ── Brand palette (mirrors _share.scss .share-card — hardcoded on purpose) ── */
const C = {
  bgSolid:   '#141210',
  bgGrad:    'radial-gradient(120% 90% at 50% 0%, #241f19 0%, #141210 60%, #0d0b09 100%)',
  parchment: '#E9DFCA',
  gold:      '#C9A84C',
  goldText:  '#D8B85E',
  frame:     'rgba(201,168,76,0.55)',
  frameFaint:'rgba(201,168,76,0.18)',
  coverBrd:  'rgba(201,168,76,0.40)',
  subDim:    'rgba(233,223,202,0.66)',
  capDim:    'rgba(233,223,202,0.75)',
  urlDim:    'rgba(233,223,202,0.50)',
};

/* ── Fonts (static, satori-compatible: ttf/otf/woff — NOT woff2) ──
 * Cached across warm invocations. Each fetch is independently guarded so a
 * single flaky CDN can't take the whole card down. */
const FONTS = [
  { key: 'serif',  name: 'Instrument Serif', weight: 400, style: 'normal',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/instrument-serif@latest/latin-400-normal.woff' },
  { key: 'serifIt', name: 'Instrument Serif', weight: 400, style: 'italic',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/instrument-serif@latest/latin-400-italic.woff' },
  { key: 'mono',   name: 'IBM Plex Mono',    weight: 400, style: 'normal',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-400-normal.woff' },
  { key: 'monoSb', name: 'IBM Plex Mono',    weight: 600, style: 'normal',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-600-normal.woff' },
  { key: 'sans',   name: 'Inter',            weight: 400, style: 'normal',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.woff' },
  { key: 'sansIt', name: 'Inter',            weight: 400, style: 'italic',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-italic.woff' },
  // Symbol fallback: DejaVu Sans covers every ornament glyph (✦☩❦✺⚜✧❧).
  { key: 'sym',    name: 'Ornament',         weight: 400, style: 'normal',
    url: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf' },
];

let _fontCache = null;
async function loadFonts() {
  if (_fontCache) return _fontCache;
  const loaded = await Promise.all(
    FONTS.map(async (f) => {
      try {
        const r = await fetch(f.url);
        if (!r.ok) throw new Error(`${r.status}`);
        return { name: f.name, weight: f.weight, style: f.style, data: new Uint8Array(await r.arrayBuffer()) };
      } catch (e) {
        console.warn(`share-card: font fetch failed (${f.key}): ${e.message}`);
        return null;
      }
    })
  );
  _fontCache = loaded.filter(Boolean);
  // satori needs at least one font to render text; a single missing typeface
  // just falls back rather than failing the whole card.
  if (_fontCache.length === 0) {
    _fontCache = null; // allow retry on next invocation
    throw new Error('no fonts available');
  }
  return _fontCache;
}

/* ── Cover fetch → { src, w, h } fitted into the CSS box (contain 170×240) ──
 * v0.48: maxW/maxH are parameters now — the OG layout needs a larger fit box
 * (310×460) than the portrait card (170×240). Defaults preserve old behavior. */
const COVER_MAX_W = 170, COVER_MAX_H = 240;
const OG_COVER_MAX_W = 310, OG_COVER_MAX_H = 460;
async function loadCover(url, maxW = COVER_MAX_W, maxH = COVER_MAX_H) {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'BooksOracle/1.0 (share-card)' } });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 6_000_000) return null;
    let w = maxW, h = maxH;
    try {
      const dim = imageSize(buf);
      if (dim.width && dim.height) {
        const s = Math.min(maxW / dim.width, maxH / dim.height);
        w = Math.round(dim.width * s);
        h = Math.round(dim.height * s);
      }
    } catch { /* fall back to max box */ }
    return { src: `data:${type};base64,${buf.toString('base64')}`, w, h };
  } catch {
    return null;
  }
}

/* ── element helpers (satori: display:flex required for multi-child nodes) ── */
const box  = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, ...(children !== undefined ? { children } : {}) } });
const txt  = (style, value)    => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: value } });
const img  = (src, style)      => ({ type: 'img', props: { src, style } });

const clamp = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

/* ── Card layout — mirrors ShareCard.jsx / _share.scss at 540×675 ── */
function card(p, cover) {
  const W = 540, H = 675;

  const children = [];

  // ornament
  if (p.ornament) {
    children.push(txt(
      { fontFamily: 'Ornament', fontSize: 34, color: C.gold, lineHeight: 1, marginBottom: 22, justifyContent: 'center' },
      p.ornament
    ));
  }

  // eyebrow
  if (p.eyebrow) {
    children.push(txt(
      { fontFamily: 'IBM Plex Mono', fontWeight: 600, fontSize: 13, letterSpacing: 2.9, color: C.goldText, marginBottom: 18, justifyContent: 'center', textTransform: 'uppercase' },
      p.eyebrow
    ));
  }

  // headline
  children.push(txt(
    { fontFamily: 'Instrument Serif', fontSize: 44, lineHeight: 1.08, color: C.parchment, justifyContent: 'center', textAlign: 'center', maxWidth: 440 },
    clamp(p.headline, 120)
  ));

  // sub
  if (p.sub) {
    children.push(txt(
      { fontFamily: 'Inter', fontStyle: 'italic', fontSize: 17, color: C.subDim, marginTop: 14, maxWidth: 380, justifyContent: 'center', textAlign: 'center' },
      clamp(p.sub, 160)
    ));
  }

  // cover (flex:1 wrapper keeps footer pinned; centers the cover vertically)
  children.push(box(
    { marginTop: 26, flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', width: '100%' },
    cover
      ? [img(cover.src, { width: cover.w, height: cover.h, objectFit: 'cover', border: `1px solid ${C.coverBrd}`, boxShadow: '0 10px 32px rgba(0,0,0,0.65)' })]
      : []
  ));

  // book caption (only when headline isn't the book title itself)
  if (p.captionTitle) {
    const cap = [txt({ fontStyle: 'italic', color: C.capDim }, p.captionTitle)];
    if (p.captionAuthor) cap.push(txt({ color: C.capDim }, `— ${p.captionAuthor}`));
    children.push(box(
      // gap replaces the inline space satori trims between the two spans
      { marginTop: 14, fontFamily: 'Inter', fontSize: 14, color: C.capDim, justifyContent: 'center', gap: 6 },
      cap
    ));
  }

  // footer
  children.push(box(
    { marginTop: 'auto', paddingTop: 22, width: '100%', justifyContent: 'center', alignItems: 'baseline', gap: 10, fontFamily: 'IBM Plex Mono', fontSize: 12, letterSpacing: 1.7, textTransform: 'uppercase' },
    [
      txt({ fontFamily: 'Ornament', color: C.gold }, '✦'),
      txt({ color: C.goldText }, 'The Books Oracle'),
      txt({ color: C.urlDim }, 'thebooksoracle.com'),
    ]
  ));

  // frame (border) with a faint inset second line (simulates outline-offset)
  const frame = box(
    { position: 'relative', boxSizing: 'border-box', width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '40px 36px 28px', border: `1px solid ${C.frame}` },
    [
      box({ position: 'absolute', top: 5, left: 5, right: 5, bottom: 5, border: `1px solid ${C.frameFaint}` }),
      ...children,
    ]
  );

  return box(
    { boxSizing: 'border-box', width: W, height: H, padding: 22, backgroundColor: C.bgSolid, backgroundImage: C.bgGrad, color: C.parchment, fontFamily: 'Inter' },
    [frame]
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * OG CARD — v0.48 Branded Link Previews
 * Landscape 1200×630 (the OG/Twitter standard ratio) for og:image. Same brand
 * language as the portrait card: ink gradient, gold double frame, Instrument
 * Serif headline, Plex Mono footer. Cover (when present) sits left, text
 * right; without a cover the text column centers full-width — plans and any
 * coverless book still get a fully branded preview instead of a bare unfurl.
 * Requested with ?layout=og; called by netlify/edge-functions/og-prerender.js
 * with server-built strings (that function stays i18n-agnostic English).
 * ════════════════════════════════════════════════════════════════════════ */

function ogCard(p, cover) {
  const W = 1200, H = 630;
  const headline = clamp(p.headline, 90);
  const hSize = headline.length > 60 ? 46 : headline.length > 38 ? 56 : 68;
  // With a cover the text column is left-aligned; without one it centers.
  const centered = !cover;
  const alignStyle = centered
    ? { alignItems: 'center', textAlign: 'center', justifyContent: 'center' }
    : { alignItems: 'flex-start', textAlign: 'left' };

  const textChildren = [
    p.ornament ? txt(
      { fontFamily: 'Ornament', fontSize: 30, color: C.gold, lineHeight: 1, marginBottom: 20 },
      p.ornament
    ) : null,
    p.eyebrow ? txt(
      { fontFamily: 'IBM Plex Mono', fontWeight: 600, fontSize: 17, letterSpacing: 3.4, textTransform: 'uppercase', color: C.goldText, marginBottom: 20 },
      p.eyebrow
    ) : null,
    txt(
      { fontFamily: 'Instrument Serif', fontSize: hSize, lineHeight: 1.08, color: C.parchment, maxWidth: centered ? 920 : 660, ...(centered ? { justifyContent: 'center' } : {}) },
      headline
    ),
    p.sub ? txt(
      { fontFamily: 'Inter', fontStyle: 'italic', fontSize: 24, color: C.subDim, marginTop: 18, maxWidth: centered ? 840 : 620, ...(centered ? { justifyContent: 'center' } : {}) },
      clamp(p.sub, 140)
    ) : null,
    box(
      { marginTop: 36, alignItems: 'baseline', gap: 12, fontFamily: 'IBM Plex Mono', fontSize: 15, letterSpacing: 2.2, textTransform: 'uppercase' },
      [
        txt({ fontFamily: 'Ornament', color: C.gold }, '✦'),
        txt({ color: C.goldText }, 'The Books Oracle'),
        txt({ color: C.urlDim }, 'thebooksoracle.com'),
      ]
    ),
  ].filter(Boolean);

  const textCol = box(
    { flexDirection: 'column', flex: 1, justifyContent: 'center', ...alignStyle, ...(cover ? { paddingLeft: 52 } : {}) },
    textChildren
  );

  const row = box(
    { flexDirection: 'row', alignItems: 'center', width: '100%', height: '100%', padding: '40px 56px' },
    [
      ...(cover ? [box(
        { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
        [img(cover.src, { width: cover.w, height: cover.h, objectFit: 'cover', border: `1px solid ${C.coverBrd}`, boxShadow: '0 12px 40px rgba(0,0,0,0.65)' })]
      )] : []),
      textCol,
    ]
  );

  // Same double-frame treatment as the portrait card.
  const frame = box(
    { position: 'relative', boxSizing: 'border-box', width: '100%', height: '100%', border: `1px solid ${C.frame}` },
    [
      box({ position: 'absolute', top: 5, left: 5, right: 5, bottom: 5, border: `1px solid ${C.frameFaint}` }),
      row,
    ]
  );

  return box(
    { boxSizing: 'border-box', width: W, height: H, padding: 20, backgroundColor: C.bgSolid, backgroundImage: C.bgGrad, color: C.parchment, fontFamily: 'Inter' },
    [frame]
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * FRAMED GENRE CARD
 * For genre_count / new_genre moments the client passes ?genre=<name>. We load
 * that genre's illustrated frame + trimmed art from the deployed site
 * (public/cards/<genre>/frame.png + art-trim.png) and compose them with the
 * live eyebrow/headline/sub. Text stays a render-time param — one asset pair
 * serves every milestone (first book, 5, 10, 25, 50) with no baked-in copy.
 * Authored natively at 1080×1350 (not the 540×675 → 2× path of the base card).
 * ════════════════════════════════════════════════════════════════════════ */

// Content-safe opening inside the frame's inner oval, measured from the shared
// frame template (all genre frames use the same border, so one box fits all).
// If a future frame changes its opening, re-measure and switch to a per-genre map.
const FRAME_BOX = { x: 291, y: 256, w: 485, h: 782 };

const CF = { ink: '#141210', gold: '#C9A84C', goldText: '#D8B85E',
             parchment: '#E9DFCA', sub: 'rgba(233,223,202,0.72)',
             url: 'rgba(201,168,76,0.72)' };

// Moment marker (an open book), rasterised once to a PNG data-URI at cold start.
const BOOK_ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 100 100">` +
  `<g fill="none" stroke="${CF.goldText}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M50,30 C40,22 24,22 14,28 L14,72 C24,66 40,66 50,74 C60,66 76,66 86,72 L86,28 C76,22 60,22 50,30 Z"/>` +
  `<path d="M50,30 L50,74" stroke-width="2.6"/>` +
  `<path d="M22,40 C30,37 38,37 44,40 M22,52 C30,49 38,49 44,52" stroke="${CF.gold}" stroke-width="2"/>` +
  `<path d="M56,40 C62,37 70,37 78,40 M56,52 C62,49 70,49 78,52" stroke="${CF.gold}" stroke-width="2"/>` +
  `</g></svg>`;
let _iconUri = null;
function bookIconUri() { // requires wasm ready (ensureWasm) before first call
  if (!_iconUri) {
    const png = new Resvg(BOOK_ICON_SVG, { fitTo: { mode: 'width', value: 108 } }).render().asPng();
    _iconUri = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  }
  return _iconUri;
}

// Fetch a card asset (frame / art) -> PNG data-URI, or null if unavailable.
async function loadCardAsset(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'BooksOracle/1.0 (share-card)' } });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || 'image/png';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 8_000_000) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

const framedTitleSize = (s) => (s.length > 44 ? 48 : s.length > 32 ? 58 : s.length > 22 ? 68 : 78);

function framedCard(p, { frameSrc, artSrc, iconUri, box: bx }) {
  const B = bx || FRAME_BOX;
  const head = clamp(p.headline, 80);
  const size = framedTitleSize(head);
  // Reserve room for a (possibly 2-line) headline so the art never overlaps it.
  const lines = Math.max(1, Math.ceil((head.length * 0.40 * size) / B.w));
  const artMaxH = Math.max(180, Math.min(470, B.h - (196 + lines * size * 1.05)));
  const header = box(
    { flexDirection: 'column', alignItems: 'center', width: '100%' },
    [
      img(iconUri, { width: 68, height: 68, marginBottom: 18 }),
      p.eyebrow ? txt(
        { fontFamily: 'IBM Plex Mono', fontWeight: 600, fontSize: 26, letterSpacing: 7,
          textTransform: 'uppercase', color: CF.goldText, marginBottom: 22,
          justifyContent: 'center', textAlign: 'center', maxWidth: B.w }, p.eyebrow) : null,
      txt(
        { fontFamily: 'Instrument Serif', fontSize: size,
          lineHeight: 1.05, color: CF.parchment, justifyContent: 'center', textAlign: 'center',
          maxWidth: B.w }, head),
    ].filter(Boolean)
  );

  const artBox = box(
    { alignItems: 'center', justifyContent: 'center', width: '100%' },
    [ box(
        { padding: 6, backgroundColor: CF.ink, border: `2px solid ${CF.gold}`, borderRadius: 6,
          boxShadow: '0 18px 46px rgba(0,0,0,0.6)' },
        [ img(artSrc, { maxWidth: B.w - 24, maxHeight: artMaxH, objectFit: 'contain', borderRadius: 2 }) ]) ]
  );

  const link = txt(
    { fontFamily: 'IBM Plex Mono', fontWeight: 600, fontSize: 18, letterSpacing: 2.5,
      textTransform: 'uppercase', color: CF.url, justifyContent: 'center', textAlign: 'center' },
    'The Books Oracle · thebooksoracle.com');

  const stack = box(
    { flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', width: B.w, height: B.h },
    [header, artBox, link]);

  return box(
    { width: 1080, height: 1350, position: 'relative', backgroundColor: CF.ink },
    [
      img(frameSrc, { position: 'absolute', top: 0, left: 0, width: 1080, height: 1350 }),
      box({ position: 'absolute', left: B.x, top: B.y, width: B.w, height: B.h }, [stack]),
    ]);
}

/* -- handler (Netlify Functions v2) --
 * Returns a standard web Response. Binary bodies are native in v2, so we hand
 * back the raw PNG bytes directly. */
export default async (req) => {
  const url = new URL(req.url);
  const q = Object.fromEntries(url.searchParams);
  try {
    const p = {
      ornament:      q.ornament || '',
      eyebrow:       q.eyebrow || '',
      headline:      q.headline || '',
      sub:           q.sub || '',
      captionTitle:  q.captionTitle || '',
      captionAuthor: q.captionAuthor || '',
    };

    await ensureWasm();
    const fonts = await loadFonts();

    let png;
    // Framed genre card: pull the genre's illustrated frame + trimmed art from
    // the deployed site. Render the 1080x1350 framed layout when both assets
    // exist; fall through to the standard cover card if either is missing.
    let framed = false;
    // v0.48: ?layout=og → landscape 1200×630 branded link preview. Takes
    // priority over the framed path (og-prerender never sends ?frame, but a
    // hand-built URL with both shouldn't render a portrait framed card where
    // an OG image is expected).
    if (q.layout === 'og') {
      const cover = await loadCover(q.cover, OG_COVER_MAX_W, OG_COVER_MAX_H);
      const svg = await satori(ogCard(p, cover), { width: 1200, height: 630, fonts });
      png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
      framed = true; // skip the default portrait path below
    } else if (q.frame) {
      const seg = encodeURIComponent(q.frame);
      const frameSrc = await loadCardAsset(`${url.origin}/cards/${seg}/frame.png`);
      // Slot image: the reader's cover for book_completed, else the genre/moment art.
      const artSrc = q.cover
        ? await loadCardAsset(q.cover)
        : await loadCardAsset(`${url.origin}/cards/${seg}/art-trim.png`);
      const bx = q.box ? q.box.split(',').map(Number) : null;
      const box = (bx && bx.length === 4 && bx.every(Number.isFinite))
        ? { x: bx[0], y: bx[1], w: bx[2], h: bx[3] } : FRAME_BOX;
      if (frameSrc && artSrc) {
        const svg = await satori(
          framedCard(p, { frameSrc, artSrc, iconUri: bookIconUri(), box }),
          { width: 1080, height: 1350, fonts });
        png = new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } }).render().asPng();
        framed = true;
      }
    }

    if (!framed) {
      const cover = await loadCover(q.cover);
      const svg = await satori(card(p, cover), { width: 540, height: 675, fonts });
      png = new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } }).render().asPng();
    }

    return new Response(Buffer.from(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': q.v ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('share-card render failed', err);
    return new Response(`share-card error: ${err.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
};
