// googleBooksByAuthor.probe.mjs — does the author top-up actually stay in one
// language?
//
//   node batch-scripts/probes/googleBooksByAuthor.probe.mjs
//
// No network: global.fetch is stubbed with a canned Google Books corpus that
// honours langRestrict the way the real API does. That makes this a test of OUR
// logic — which passes we run, in what order, and what we do with the results —
// rather than of Google's.
//
// Written because "More by this author" shipped showing *Tak prohraješ časovou
// válku* and *Verlorene der Zeiten* under Amal El-Mohtar on an English book
// page. The cause was not the work-collapse everyone looked at first: it was
// this function running a single UNRESTRICTED pass, which returns every edition
// in every language Google holds. The collapse never had a chance, because two
// translations share no identifier and no characters.

import { googleBooksByAuthor } from '../../src/lib/googleBooksService.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log('  ok  ' + n); }
  else { fail++; console.log('  FAIL ' + n + '  ' + e); }
};

// A corpus shaped like the real thing: two works, many languages, and the
// co-author credited first on some editions.
const CORPUS = [
  { title: 'The River Has Roots', authors: ['Amal El-Mohtar'], language: 'en' },
  { title: 'El río tiene raíces', authors: ['Amal El-Mohtar'], language: 'es' },
  { title: 'This Is How You Lose the Time War', authors: ['Amal El-Mohtar', 'Max Gladstone'], language: 'en' },
  { title: 'This Is How You Lose the Time War', subtitle: 'A Novel', authors: ['Max Gladstone', 'Amal El-Mohtar'], language: 'en' },
  { title: 'Verlorene der Zeiten', authors: ['Amal El-Mohtar', 'Max Gladstone'], language: 'de' },
  { title: 'Tak prohraješ časovou válku', authors: ['Amal El-Mohtar', 'Max Gladstone'], language: 'cs' },
];

const requests = [];

globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  requests.push(body);
  const items = CORPUS
    .filter((v) => !body.langRestrict || v.language === body.langRestrict)
    .slice(0, body.maxResults || 5)
    .map((volumeInfo) => ({ volumeInfo }));
  return {
    ok: true,
    json: async () => ({ items }),
  };
};

const reset = () => { requests.length = 0; };

console.log('--- English reader on an English book page ---');
reset();
let out = await googleBooksByAuthor('Amal El-Mohtar', { lang: 'en', limit: 12 });
let titles = out.map((b) => b.t);

check('first request carries langRestrict=en',
  requests[0]?.langRestrict === 'en', JSON.stringify(requests[0]));
check('no Czech edition', !titles.some((t) => /prohraješ/.test(t)), JSON.stringify(titles));
check('no German edition', !titles.some((t) => /Verlorene/.test(t)), JSON.stringify(titles));
check('no Spanish edition', !titles.some((t) => /río/.test(t)), JSON.stringify(titles));
check('English editions still returned', titles.some((t) => /River Has Roots/.test(t)), JSON.stringify(titles));
check('subtitle variant collapsed by canonicalKey',
  titles.filter((t) => /Time War/.test(t)).length === 1, JSON.stringify(titles));
check('co-authored book keeps the full credit list',
  out.find((b) => /Time War/.test(b.t))?.authors?.length === 2,
  JSON.stringify(out.find((b) => /Time War/.test(b.t))?.authors));
check('unrestricted fallback NOT reached when the language pass worked',
  requests.every((r) => r.langRestrict === 'en'),
  JSON.stringify(requests.map((r) => r.langRestrict)));

console.log('\n--- Spanish reader ---');
reset();
out = await googleBooksByAuthor('Amal El-Mohtar', { lang: 'es', limit: 12 });
titles = out.map((b) => b.t);
check('gets the Spanish edition', titles.some((t) => /río/.test(t)), JSON.stringify(titles));
check('and ONLY Spanish — no English mixed in',
  !titles.some((t) => /River Has Roots|Time War/.test(t)), JSON.stringify(titles));

console.log('\n--- author has nothing in the anchor language ---');
//
// The top-up contributes NOTHING rather than reaching for another language.
// This is a deliberate trade and the opposite of what this probe asserted
// before the language filter moved onto the response: a French reader offered
// German and Czech editions is the bug that was reported, and an empty top-up
// simply leaves the section showing the catalog rows we hold.
reset();
out = await googleBooksByAuthor('Amal El-Mohtar', { lang: 'fr', limit: 12 });
check('the unrestricted fallback is still attempted (search widens)',
  requests.some((r) => !r.langRestrict),
  JSON.stringify(requests.map((r) => r.langRestrict)));
check('but nothing in another language is returned (answer does not widen)',
  out.length === 0, JSON.stringify(out.map((b) => b.t)));

// ── The flip-flop ───────────────────────────────────────────────────────────
//
// The section alternated between English-only and German/Czech/Spanish on
// consecutive reloads of the same page. Both stubs below reproduce a way that
// happens, and neither is hypothetical: langRestrict is a hint Google honours
// inconsistently for `inauthor:` queries.

console.log('\n--- API ignores langRestrict entirely ---');
reset();
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  requests.push(body);
  // Note: no filtering. The request asked; the API shrugged.
  return { ok: true, json: async () => ({ items: CORPUS.slice(0, body.maxResults || 5).map((volumeInfo) => ({ volumeInfo })) }) };
};
out = await googleBooksByAuthor('Amal El-Mohtar', { lang: 'en', limit: 12 });
titles = out.map((b) => b.t);
check('asked for en', requests[0]?.langRestrict === 'en');
check('still no Czech even though the API ignored us',
  !titles.some((t) => /prohraješ/.test(t)), JSON.stringify(titles));
check('still no German', !titles.some((t) => /Verlorene/.test(t)), JSON.stringify(titles));
check('still no Spanish', !titles.some((t) => /río/.test(t)), JSON.stringify(titles));
check('English still comes through', titles.length > 0, JSON.stringify(titles));

console.log('\n--- restricted pass returns nothing, fallback fires ---');
reset();
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  requests.push(body);
  // The restricted pass comes back empty — the other half of the flip-flop.
  if (body.langRestrict) return { ok: true, json: async () => ({ items: [] }) };
  return { ok: true, json: async () => ({ items: CORPUS.slice(0, body.maxResults || 5).map((volumeInfo) => ({ volumeInfo })) }) };
};
out = await googleBooksByAuthor('Amal El-Mohtar', { lang: 'en', limit: 12 });
titles = out.map((b) => b.t);
check('unrestricted fallback did run', requests.some((r) => !r.langRestrict));
check('but the ANSWER is still English only',
  !titles.some((t) => /prohraješ|Verlorene|río/.test(t)), JSON.stringify(titles));

console.log('\n--- a volume with no declared language is kept ---');
reset();
globalThis.fetch = async (url, init) => {
  requests.push(JSON.parse(init.body));
  return { ok: true, json: async () => ({ items: [{ volumeInfo: { title: 'The Honey Month', authors: ['Amal El-Mohtar'] } }] }) };
};
out = await googleBooksByAuthor('Amal El-Mohtar', { lang: 'en', limit: 12 });
check('missing language metadata does not empty the section',
  out.length === 1 && out[0].t === 'The Honey Month', JSON.stringify(out.map((b) => b.t)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
