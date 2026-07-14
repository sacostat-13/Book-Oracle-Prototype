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

/* ── Cover fetch → { src, w, h } fitted into the CSS box (contain 170×240) ── */
const COVER_MAX_W = 170, COVER_MAX_H = 240;
async function loadCover(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'BooksOracle/1.0 (share-card)' } });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 6_000_000) return null;
    let w = COVER_MAX_W, h = COVER_MAX_H;
    try {
      const dim = imageSize(buf);
      if (dim.width && dim.height) {
        const s = Math.min(COVER_MAX_W / dim.width, COVER_MAX_H / dim.height);
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

/* ── handler ── */
export const handler = async (event) => {
  const t0 = Date.now();
  const ms = () => `${Date.now() - t0}ms`;
  console.log('[share-card] invoked', (event.queryStringParameters || {}).type || '(book)');
  try {
    const q = event.queryStringParameters || {};
    const p = {
      ornament:      q.ornament || '',
      eyebrow:       q.eyebrow || '',
      headline:      q.headline || '',
      sub:           q.sub || '',
      captionTitle:  q.captionTitle || '',
      captionAuthor: q.captionAuthor || '',
    };

    const [fonts, cover] = await Promise.all([loadFonts(), loadCover(q.cover), ensureWasm()]);
    console.log(`[share-card] deps ready ${ms()} — fonts=${fonts.length} cover=${!!cover}`);

    const svg = await satori(card(p, cover), { width: 540, height: 675, fonts });
    console.log(`[share-card] satori done ${ms()}`);
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } }).render().asPng();
    console.log(`[share-card] png done ${ms()} — ${png.length} bytes`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/png',
        // Share cards are essentially content-addressed by their params, so a
        // long-ish cache is safe; pass &v=<hash> for immutable caching.
        'Cache-Control': q.v ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
      },
      body: png.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('share-card render failed', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: `share-card error: ${err.message}` };
  }
};
