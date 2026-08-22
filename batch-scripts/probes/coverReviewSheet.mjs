// coverReviewSheet.mjs — look at the covers before writing them.
//
// Every check in this pipeline so far proves an image EXISTS at a URL. None of them
// prove it is the cover of THIS book. Amazon returns a valid image for any ISBN-10 in
// its catalog, so the Amazon-by-ISBN source is exactly as trustworthy as books.isbn —
// no more. This renders the proposed covers next to title/author/ISBN so a human can
// say yes or no in about two minutes.
//
// Usage:
//   node batch-scripts/probes/coverReviewSheet.mjs --limit 60
//   node batch-scripts/probes/coverReviewSheet.mjs --limit 60 --out review.html
//
// Writes an HTML file. Writes NOTHING to the database.
// Open it in a browser — the images load from Amazon's CDN directly.

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function argVal(flag, dflt) {
  const a = args.find((x) => x.startsWith(flag));
  if (!a) return dflt;
  return a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1];
}
const LIMIT = parseInt(argVal('--limit', '60'), 10);
const OUT = argVal('--out', join(__dirname, '..', 'output', 'cover-review.html'));
const MIN_BYTES = parseInt(argVal('--min-bytes', '5000'), 10);

function isbn13to10(isbn13) {
  const d = String(isbn13).replace(/[^0-9Xx]/g, '');
  if (d.length === 10) return d.toUpperCase();
  if (d.length !== 13 || d.slice(0, 3) !== '978') return null;
  const core = d.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}
const amazonUrl = (i10) => `https://images-na.ssl-images-amazon.com/images/P/${i10}.01.LZZZZZZZ.jpg`;

const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
  })
);
const supabase = createServiceClient(env['VITE_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

const { data: books, error } = await supabase
  .from('books').select('id, title, author, isbn, language')
  .is('cover_url', null).not('isbn', 'is', null)
  .order('created_at', { ascending: true }).limit(LIMIT);
if (error) { console.error('Fetch failed: ' + error.message); process.exit(1); }

console.log(`\nProbing ${books.length} row(s)…\n`);
const accepted = [];
let tiny = 0, noI10 = 0;

for (const b of books) {
  const i10 = isbn13to10(b.isbn);
  if (!i10) { noI10++; continue; }
  const url = amazonUrl(i10);
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    const len = Number(res.headers.get('content-length') || 0);
    if (!res.ok || ct.indexOf('image/') !== 0 || len < MIN_BYTES) { tiny++; continue; }
    accepted.push({ ...b, i10, url, len });
  } catch { tiny++; }
  await new Promise((r) => setTimeout(r, 200));
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const cards = accepted.map((b) => `
  <figure class="card">
    <img src="${esc(b.url)}" alt="" loading="lazy">
    <figcaption>
      <strong>${esc(b.title)}</strong>
      <span>${esc(b.author || '(no author)')}</span>
      <code>${esc(b.isbn)} → ${esc(b.i10)}${b.language ? ' · ' + esc(b.language) : ''} · ${b.len}b</code>
      <label><input type="checkbox" class="rej" data-id="${esc(b.id)}"> wrong cover</label>
    </figcaption>
  </figure>`).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Cover review — Amazon by ISBN</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; background: Canvas; color: CanvasText; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; opacity: .7; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 20px; }
  .card { margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .card img { width: 100%; aspect-ratio: 2/3; object-fit: contain; background: #8883; border-radius: 4px; }
  figcaption { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
  figcaption strong { font-size: 13px; }
  figcaption span { opacity: .75; }
  code { font-size: 10px; opacity: .55; word-break: break-all; }
  label { font-size: 11px; opacity: .8; margin-top: 2px; }
  #out { position: sticky; bottom: 0; margin-top: 24px; padding: 12px; background: Canvas;
         border-top: 1px solid #8886; font-family: ui-monospace, monospace; font-size: 11px; white-space: pre-wrap; }
</style></head><body>
<h1>Cover review — Amazon by ISBN</h1>
<p class="sub">${accepted.length} proposed · ${tiny} below the ${MIN_BYTES}b floor (placeholder) · ${noI10} with no ISBN-10 · nothing written to the database</p>
<div class="grid">${cards}</div>
<div id="out">Tick anything that is the wrong book. The id list appears here.</div>
<script>
  const out = document.getElementById('out');
  document.addEventListener('change', () => {
    const ids = [...document.querySelectorAll('.rej:checked')].map((c) => c.dataset.id);
    out.textContent = ids.length
      ? 'Rejected ' + ids.length + ':\\n' + ids.join('\\n')
      : 'Tick anything that is the wrong book. The id list appears here.';
  });
</script>
</body></html>`;

writeFileSync(OUT, html);
console.log(`accepted=${accepted.length}  placeholder=${tiny}  noIsbn10=${noI10}`);
console.log(`\nWrote ${OUT}\nOpen it in a browser and look.\n`);
