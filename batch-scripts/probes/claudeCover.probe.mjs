// claudeCover.probe.mjs — instruments the Claude branch of coverBackfill.
// Answers one question: when Claude "finds nothing", which of these happened?
//   api-error | max-tokens | no-url-in-text | url-rejected-by-verify | ok
//
// Usage:
//   node batch-scripts/probes/claudeCover.probe.mjs "Vervain Hollow" "Catriona Silvey"
//   node batch-scripts/probes/claudeCover.probe.mjs --file batch-scripts/output/no-cover.txt
//
// Writes nothing. Costs one Claude call per title.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
  })
);
const KEY = env['ANTHROPIC_API_KEY'] || '';
if (!KEY) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1); }

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

// Four ways of asking "is this an image?", so we can see which the host allows.
async function verifyVariants(url) {
  const out = {};
  const tries = [
    ['HEAD-bare', { method: 'HEAD' }],
    ['HEAD-UA',   { method: 'HEAD', headers: { 'User-Agent': UA, Accept: 'image/*' } }],
    ['GET-UA',    { method: 'GET',  headers: { 'User-Agent': UA, Accept: 'image/*' } }],
  ];
  for (const [label, opts] of tries) {
    try {
      const res = await fetch(url, { ...opts, redirect: 'follow' });
      const ct = res.headers.get('content-type') || '';
      const len = res.headers.get('content-length') || '?';
      out[label] = `${res.status} ${ct.slice(0, 24)} len=${len}`;
    } catch (e) { out[label] = 'THREW ' + e.message.slice(0, 40); }
  }
  return out;
}

async function probe(title, author) {
  const line = `\n=== ${title} — ${author || '(no author)'} ===`;
  console.log(line);

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: 'You find book cover image URLs. Use web_search to find the book, then return ONLY the direct image URL (https://...). Reply null if not found.',
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: 'Find cover image URL for "' + title + '" by ' + (author || 'unknown') }],
      }),
    });
  } catch (e) {
    console.log('  OUTCOME: api-error (transport) — ' + e.message);
    return;
  }

  if (!res.ok) {
    console.log(`  OUTCOME: api-error ${res.status} — ${(await res.text()).slice(0, 300)}`);
    return;
  }

  const data = await res.json();
  const blocks = Array.isArray(data.content) ? data.content : [];

  // THE FIELDS coverBackfill NEVER LOOKS AT:
  console.log('  stop_reason : ' + data.stop_reason);
  console.log('  usage       : in=' + data.usage?.input_tokens + ' out=' + data.usage?.output_tokens +
              ' searches=' + (data.usage?.server_tool_use?.web_search_requests ?? 0));
  console.log('  blocks      : ' + blocks.map((b) => b.type).join(', '));

  const queries = blocks.filter((b) => b.type === 'server_tool_use').map((b) => JSON.stringify(b.input?.query));
  if (queries.length) console.log('  queries     : ' + queries.join(' | '));

  const texts = blocks.filter((b) => b.type === 'text' && (b.text || '').trim()).map((b) => b.text.trim());
  texts.forEach((t, i) => console.log(`  text[${i}]     : ${t.slice(0, 220).replace(/\n/g, ' ')}`));

  if (data.stop_reason === 'max_tokens') {
    console.log('  OUTCOME: max-tokens — output ceiling hit before a final answer');
    return;
  }

  const raw = texts.length ? texts[texts.length - 1] : '';
  const match = raw.match(/https?:\/\/[^\s"'<>)]+/);
  if (!match) { console.log('  OUTCOME: no-url-in-text'); return; }

  const url = match[0];
  console.log('  url         : ' + url);
  const v = await verifyVariants(url);
  for (const k of Object.keys(v)) console.log(`    ${k.padEnd(10)} ${v[k]}`);

  const bareOk = /^2\d\d image\//.test(v['HEAD-bare']);
  console.log('  OUTCOME: ' + (bareOk ? 'ok' : 'url-rejected-by-verify  <-- Claude DID find one'));
}

const argv = process.argv.slice(2);
let jobs = [];
if (argv[0] === '--file') {
  jobs = readFileSync(argv[1], 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => l.split(/\s+—\s+|\s+--\s+/)).map(([t, a]) => [t.trim(), (a || '').trim()]);
} else if (argv[0]) {
  jobs = [[argv[0], argv[1] || '']];
} else {
  console.error('Usage: node claudeCover.probe.mjs "Title" "Author"  |  --file list.txt');
  process.exit(1);
}

const tally = {};
for (const [t, a] of jobs) { await probe(t, a); await new Promise((r) => setTimeout(r, 1200)); }
