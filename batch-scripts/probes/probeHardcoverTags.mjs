// probeHardcoverTags.mjs — v1
//
// READ-ONLY. Touches no database, writes no books. Answers one question:
// what does Hardcover actually call the genres we are asking it for?
//
// WHY
//
// The catalog crawl asks Hardcover for books tagged with the names in
// GENRE_MAP. Eleven of those tags return zero rows at ANY threshold:
//
//   Southern Gothic, Body Horror, Transgressive Fiction, Cozy Fantasy,
//   Sapphic, Latin American Literature       — 0 rows at minRatings=50
//   Japanese Literature, Korean Literature,
//   Parenting, Motherhood, Witches           — 0 rows at minRatings=150
//   Gothic Fiction                           — 0 rows at minRatings=500
//
// Lowering the bar fixed the tags that exist (Gothic 16→25, Vampires 11→21,
// Folk Horror 0→1). It did nothing for these, and a tag with no books above 50
// readers has no books at all. So the names are wrong, not the thresholds.
//
// Guessing replacement spellings and waiting a week for the logs is the slow
// way to find out. This asks directly.
//
// TWO MODES
//
//   --vocab    Sample popular books and report the Genre tags they actually
//              carry, by frequency. This is the ground truth: whatever comes
//              back is, by definition, a working tag string. Start here.
//
//   --variants Take each configured tag and try mechanical variants (case,
//              hyphens, singular/plural, "Fiction" suffix) plus hand-written
//              alternates, reporting how many books each returns. Use this to
//              confirm a candidate before editing GENRE_MAP.
//
//   --neighbours "Gothic"
//              Pull the books carrying a tag that WORKS and count every other
//              Genre tag they also carry. Best signal for a niche shelf, and
//              the mode to reach for when a genre comes back dead.
//
// WHAT THE FIRST RUN ESTABLISHED
//
// Hardcover's Genre key is a folksonomy, not a controlled vocabulary. The
// sample contained "to-read", "Read Next 2024", "💀 Horror", " English" with a
// leading space, "Claire's Books.Throne of Glass Series - Sarah Maas" and a
// bare unix timestamp. Personal shelf labels leak into it freely.
//
// Two consequences. First, exact-string matching against a folksonomy is
// inherently fragile — "cozy fantasy" exists where "Cozy Fantasy" does not, and
// science fiction is spread across "Science Fiction", "Sci-fi", "Scifi" and
// "science-fiction" as four unrelated strings. GENRE_MAP.tags is already an
// array, so the fix is more spellings per genre, not a better single guess.
// Second, anything read out of cached_tags is dirty by construction, which is
// why metadataBackfill's genre rules are narrow regexes rather than direct use
// of the tag string.
//
// Usage:
//   node batch-scripts/probeHardcoverTags.mjs --vocab
//   node batch-scripts/probeHardcoverTags.mjs --vocab --deep --sample 500
//   node batch-scripts/probeHardcoverTags.mjs --variants
//   node batch-scripts/probeHardcoverTags.mjs --variants --tag "Southern Gothic"
//   node batch-scripts/probeHardcoverTags.mjs --neighbours "Gothic"
//
// Required in .env.local:
//   HARDCOVER_API_TOKEN

import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const MODE_VOCAB = args.includes('--vocab');
const MODE_VARIANTS = args.includes('--variants');
// Sample from deep in the ranking instead of the top. See the note on sampling
// bias in runVocab.
const DEEP = args.includes('--deep');

function argValue(name, fallback) {
  const a = args.find((x) => x.startsWith(name));
  if (!a) return fallback;
  return a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1];
}

const SAMPLE = Number.parseInt(argValue('--sample', ''), 10) || 300;
const ONE_TAG = argValue('--tag', null);
// --neighbours "Gothic" — the highest-signal mode for a niche shelf. See below.
const NEIGHBOURS = argValue('--neighbours', null);

if (!MODE_VOCAB && !MODE_VARIANTS && !NEIGHBOURS) {
  console.error('Pick a mode: --vocab, --variants or --neighbours "Tag" (see header).');
  process.exit(1);
}

const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);

const TOKEN = env['HARDCOVER_API_TOKEN'] || env['VITE_HARDCOVER_TOKEN'] || '';
if (!TOKEN) {
  console.error('Missing HARDCOVER_API_TOKEN in .env.local');
  process.exit(1);
}

const HARDCOVER_URL = 'https://api.hardcover.app/v1/graphql';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hardcover(query, variables) {
  const res = await fetch(HARDCOVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: TOKEN.startsWith('Bearer ') ? TOKEN : `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`hardcover ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || 'graphql error');
  return json.data;
}

// ── Mode 1: vocabulary ───────────────────────────────────────────────────────
// No filter on tags at all — just the most-read books, and whatever Genre tags
// they carry. Nothing here can be wrong: every string returned is one Hardcover
// itself applied.
const VOCAB_QUERY = `
  query Vocab($limit: Int!, $offset: Int!) {
    books(order_by: { users_read_count: desc }, limit: $limit, offset: $offset) {
      cached_tags
    }
  }
`;

// SAMPLING BIAS — read before trusting a --vocab run.
//
// Ordering by users_read_count desc samples the HEAD of the distribution:
// mainstream SF, fantasy and YA. The first run bore this out — Fiction 274,
// Fantasy 206, Adventure 165, Young Adult 133 — which is precisely the
// bestseller population GENRE_MAP exists to avoid. Niche tags are structurally
// unlikely to appear there no matter how healthy they are, so "absent from
// --vocab" is weak evidence of "does not exist".
//
// --deep starts from a random offset well down the ranking, which surfaces a
// different and much longer tail. --neighbours is better still for any specific
// shelf. Use --vocab to learn the SHAPE of the vocabulary (casing conventions,
// junk, duplicates); use the other two to find actual tag names.
async function runVocab() {
  const base = DEEP ? 2000 + Math.floor(Math.random() * 8000) : 0;
  console.log(
    `[probe] sampling ${SAMPLE} books from offset ${base} ` +
    `(${DEEP ? 'deep — mid-tail' : 'head — most-read, biased toward mainstream'})\n`
  );
  const counts = new Map();
  const PAGE = 100;

  for (let offset = 0; offset < SAMPLE; offset += PAGE) {
    const limit = Math.min(PAGE, SAMPLE - offset);
    const data = await hardcover(VOCAB_QUERY, { limit, offset: base + offset });
    for (const b of data.books || []) {
      for (const t of b.cached_tags?.Genre || []) {
        const tag = t?.tag;
        if (tag) counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    process.stdout.write(`  sampled ${Math.min(offset + PAGE, SAMPLE)}/${SAMPLE}\n`);
    await sleep(500);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n[probe] ${sorted.length} distinct Genre tags found\n`);
  for (const [tag, n] of sorted.slice(0, 80)) {
    console.log(`  ${String(n).padStart(4)}  ${tag}`);
  }

  const csv = ['tag,books_in_sample', ...sorted.map(([t, n]) => `"${t.replace(/"/g, '""')}",${n}`)].join('\n');
  writeFileSync(join(__dirname, '..', 'output', 'hardcover-tag-vocab.csv'), csv);
  console.log(`\n[probe] full list written to batch-scripts/hardcover-tag-vocab.csv`);
  console.log('[probe] cross-reference this against GENRE_MAP in netlify/functions/catalog-crawl.mjs');
}

// ── Mode 2: variants ─────────────────────────────────────────────────────────
// ORDERED BY READERS — this matters more than it looks (v0.60.2).
//
// The first version of this query had no ordering and no reader filter, so
// "50 rows" meant "50 books carry this tag", which is NOT the question the
// crawl asks. The crawl filters `users_read_count >= minRatings` and takes the
// top by readers. A tag can therefore return 50 here and 0 there.
//
// The Sapphic run showed exactly that: `sapphic` reported 50 rows, and its
// example book had 2 readers. At the NICHE bar of 50 that tag may well yield
// nothing at all. Existence and viability are different measurements and the
// old probe only made the first one.
//
// Ordering by readers descending fixes it in a single request: the rows come
// back best-first, so counting how many clear each tier tells us which bar the
// tag can actually sustain.
const COUNT_QUERY = `
  query CountTag($tag: String!) {
    books(
      where: { cached_tags: { _contains: { Genre: [{ tag: $tag }] } } }
      order_by: { users_read_count: desc }
      limit: 50
    ) {
      title
      users_read_count
    }
  }
`;

// Mirrors the tiers in netlify/functions/catalog-crawl.mjs. Kept in sync by
// hand — if those change, change these.
const TIERS = [
  ['TINY', 10],
  ['NICHE', 50],
  ['MID', 150],
  ['BROAD', 500],
];

// Highest tier this tag could sustain, or null if it cannot fill a batch at any
// bar. PER_GENRE in the crawl is 25, so "usable" means at least a few books
// clear the bar — one book above 500 does not make a BROAD tag.
function sustainableTier(readerCounts) {
  let best = null;
  for (const [name, bar] of TIERS) {
    if (readerCounts.filter((n) => n >= bar).length >= 5) best = `${name}(${bar})`;
  }
  return best;
}

// The tags the logs showed as dead, with hand-written alternates worth trying.
// Mechanical variants are generated on top of these.
// Rewritten from the first --vocab run rather than from imagination. Every
// alternate below is a string that run actually observed in the wild, which is
// a much better starting point than a guessed spelling.
//
// The headline lesson from that run: Hardcover's Genre key is a FOLKSONOMY, not
// a controlled vocabulary. Case and punctuation vary freely — "cozy fantasy"
// exists where "Cozy Fantasy" does not, alongside "Sci-fi", "science-fiction",
// "Scifi" and "Science Fiction" as four separate strings. Since the crawl
// matches with `_contains` on an exact string, every one of those is a distinct
// tag and missing the right casing means zero rows.
const SUSPECTS = {
  // "Gothic" itself exists but is rare (2/300); the qualified forms are rarer
  // still and spelled inconsistently.
  'Gothic Fiction':            ['Gothic', 'Gothic Horror', 'Gothic fiction (Literary genre)', 'gothic', 'Dark Academia'],
  'Southern Gothic':           ['southern gothic', 'American Gothic', 'Gothic Americana', 'American literature'],
  // No "Body Horror" anywhere. Horror appears plainly, and with an emoji
  // prefix, and in French — all three are separate tags to `_contains`.
  'Body Horror':               ['Horror', '💀 Horror', 'Horror tales', 'Horreur', 'Splatterpunk', 'Weird fiction'],
  'Transgressive Fiction':     ['Transgressive', 'Weird fiction', 'Dark', 'Psychological'],
  // Lowercase "cozy fantasy" is present where the title-cased form is not.
  'Cozy Fantasy':              ['cozy fantasy', 'Cozy', 'Low-stakes Fantasy', 'low fantasy', 'Cottagecore', 'found family'],
  // "Sapphic" absent; the umbrella queer tags are the ones with volume. Note
  // these are BROADER than the genre — see the warning printed at the end.
  'Sapphic':                   ['Lesbian', 'Queer', 'LGBTQ', 'LGBTQ+', 'Lgbt', 'Boy\'s Love'],
  // "<Nationality> literature" and "<Nationality> fiction" both exist, with
  // inconsistent capitalisation. Magical Realism is the strongest real signal
  // for the Latin American shelf.
  'Latin American Literature': ['Magical Realism', 'Colombian fiction', 'Spanish', 'Spanish fiction', 'Latin American'],
  'Japanese Literature':       ['Japanese', 'Japanese fiction', 'Asian Americans', 'Chinese fiction'],
  'Korean Literature':         ['Korean', 'Korean fiction', 'Boy\'s Love'],
  'Parenting':                 ['Family & Relationships', 'Family', 'Family life', 'Intergenerational relations'],
  'Motherhood':                ['Women', 'Women\'s Fiction', 'Mothers', 'Family life'],
  // "Witches" absent; "Magic" is common but far too broad to stand in for it.
  'Witches':                   ['Witch', 'Witchcraft', 'Magic', 'Paranormal', 'Supernatural'],
  // These three DO exist and are worth confirming depth on — the crawl already
  // gets rows from them, so they are the control group for this probe.
  'Dark Fantasy':              ['Grimdark', 'dark fantasy', 'Urban Fantasy'],
  'Epic Fantasy':              ['High Fantasy', 'Epic', 'Fantasy - Epic'],
  'Vampires':                  ['Paranormal', 'Supernatural'],
};

function mechanicalVariants(tag) {
  // Sentence case — capital on the first word only — was missing from the first
  // version of this list, and it was the single most expensive omission: the
  // working string for body horror turned out to be "Body horror", which both
  // neighbour runs saw in the wild while this probe reported the tag dead.
  const sentenceCase = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();

  const out = new Set([
    tag,
    tag.toLowerCase(),
    sentenceCase,
    tag.replace(/\s+/g, '-'),
    tag.replace(/\s+/g, '-').toLowerCase(),
    tag.replace(/\s+/g, ''),
  ]);
  if (tag.endsWith('s')) out.add(tag.slice(0, -1));
  else out.add(tag + 's');
  if (!/fiction$/i.test(tag)) out.add(tag + ' Fiction');
  return [...out];
}

const VARIANTS_CSV = join(__dirname, '..', 'output', 'hardcover-tag-variants.csv');
const CSV_HEADER = 'original_tag,candidate,rows,max_readers,ge10,ge50,ge150,ge500,sustainable_tier';

function csvRow(r) {
  const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
  return [
    quote(r.original),
    quote(r.candidate),
    r.rows,
    r.maxReaders,
    r.ge10,
    r.ge50,
    r.ge150,
    r.ge500,
    quote(r.tier || ''),
  ].join(',');
}

async function runVariants() {
  const targets = ONE_TAG ? { [ONE_TAG]: SUSPECTS[ONE_TAG] || [] } : SUSPECTS;
  const results = [];

  // Written incrementally, not at the end (v0.60.2).
  //
  // Three separate runs of this script have been lost partway — Hardcover
  // rate-limits or drops the connection, the process dies, and because the CSV
  // was only written after the final loop, every result gathered up to that
  // point went with it. Sapphic, Latin American, Vampires and Epic Fantasy were
  // all missing from the output for this reason, not because they were skipped.
  //
  // Appending after each candidate means an interrupted run is still a useful
  // run, and re-running only needs the tags that are missing.
  writeFileSync(VARIANTS_CSV, CSV_HEADER + '\n');

  for (const [original, alternates] of Object.entries(targets)) {
    console.log(`\n── ${original} ${'─'.repeat(Math.max(0, 50 - original.length))}`);
    const candidates = [...new Set([...mechanicalVariants(original), ...alternates])];

    for (const candidate of candidates) {
      // Retry transient failures before believing a zero.
      //
      // The Vampires run reported `ERR fetch failed` for the tag "Vampires" —
      // which the crawl logs prove is alive and yielding 21 books. A dropped
      // connection read as a dead tag is the most damaging failure this script
      // has: it would have had us delete a working tag from GENRE_MAP.
      let books = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 3 && books === null; attempt++) {
        if (attempt > 0) await sleep(1500 * attempt);
        try {
          const data = await hardcover(COUNT_QUERY, { tag: candidate });
          books = data.books || [];
        } catch (e) {
          lastErr = e;
        }
      }

      if (books === null) {
        // Never recorded as 0 — an unknown is not a zero.
        console.log(`   ERR      ${candidate} — ${lastErr?.message} (3 attempts, NOT recorded as dead)`);
        await sleep(800);
        continue;
      }

      const readers = books.map((b) => b.users_read_count || 0);
      const row = {
        original,
        candidate,
        rows: books.length,
        maxReaders: readers.length ? Math.max(...readers) : 0,
        ge10: readers.filter((n) => n >= 10).length,
        ge50: readers.filter((n) => n >= 50).length,
        ge150: readers.filter((n) => n >= 150).length,
        ge500: readers.filter((n) => n >= 500).length,
      };
      row.tier = sustainableTier(readers);
      results.push(row);
      appendFileSync(VARIANTS_CSV, csvRow(row) + '\n');

      const marker = books.length === 0 ? '     ' : row.tier ? ' HIT ' : ' thin';
      console.log(
        `  ${marker} ${String(row.rows).padStart(3)} rows  ` +
        `top=${String(row.maxReaders).padStart(5)}  ` +
        `≥10:${String(row.ge10).padStart(2)} ≥50:${String(row.ge50).padStart(2)} ` +
        `≥150:${String(row.ge150).padStart(2)} ≥500:${String(row.ge500).padStart(2)}  ` +
        `${candidate}${row.tier ? `  → ${row.tier}` : ''}`
      );
      await sleep(400);
    }
  }

  // "Working" now means usable by the crawl, not merely present. A tag whose
  // books all sit below the lowest tier cannot fill a shelf however many rows
  // it has.
  const usable = results.filter((r) => r.tier);
  const thin = results.filter((r) => r.rows > 0 && !r.tier);

  console.log(`\n[probe] ${usable.length} usable variant(s), ${thin.length} present-but-too-thin`);
  if (usable.length) {
    console.log('\n[probe] candidates for GENRE_MAP (tag → highest bar it can sustain):\n');
    for (const w of usable.sort((a, b) => b.ge50 - a.ge50)) {
      console.log(`  ${w.original.padEnd(26)} → "${w.candidate}"  ${w.tier}`);
    }
  }
  if (thin.length) {
    console.log('\n[probe] present but below every tier — real tags, too obscure to crawl:\n');
    for (const w of thin) {
      console.log(`  ${w.original.padEnd(26)} → "${w.candidate}"  (${w.rows} rows, top ${w.maxReaders} readers)`);
    }
  }

  console.log('\n[probe] written incrementally to batch-scripts/output/hardcover-tag-variants.csv');
  console.log('[probe] `rows` still caps at 50; the reader columns are what decide the tier.');
}

// ── Mode 3: neighbours ───────────────────────────────────────────────────────
//
// The best of the three for a specific shelf, and the one to reach for when a
// genre comes back dead.
//
// Take a tag that DOES work — "Gothic", "Horror", "Magical Realism" — pull the
// books carrying it, and count every OTHER Genre tag those books also carry.
// The result is the working vocabulary of that neighbourhood: if Hardcover has
// a live tag for southern gothic under some spelling, the books tagged "Gothic"
// are where it will show up. This sidesteps both the guessing problem and the
// head-of-distribution bias, because the population is already the one we care
// about rather than the most popular books overall.
const NEIGHBOUR_QUERY = `
  query Neighbours($tag: String!, $limit: Int!, $offset: Int!) {
    books(
      where: { cached_tags: { _contains: { Genre: [{ tag: $tag }] } } }
      order_by: { users_read_count: desc }
      limit: $limit
      offset: $offset
    ) {
      cached_tags
    }
  }
`;

async function runNeighbours() {
  console.log(`[probe] tags co-occurring with "${NEIGHBOURS}" across up to ${SAMPLE} books\n`);
  const counts = new Map();
  const PAGE = 100;
  let seen = 0;

  for (let offset = 0; offset < SAMPLE; offset += PAGE) {
    const limit = Math.min(PAGE, SAMPLE - offset);
    const data = await hardcover(NEIGHBOUR_QUERY, { tag: NEIGHBOURS, limit, offset });
    const books = data.books || [];
    if (books.length === 0) break;
    seen += books.length;
    for (const b of books) {
      for (const t of b.cached_tags?.Genre || []) {
        if (t?.tag && t.tag !== NEIGHBOURS) {
          counts.set(t.tag, (counts.get(t.tag) || 0) + 1);
        }
      }
    }
    await sleep(500);
  }

  if (seen === 0) {
    console.log(`[probe] "${NEIGHBOURS}" itself returns no books — pick a tag known to work.`);
    return;
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`[probe] ${seen} books carry "${NEIGHBOURS}"; ${sorted.length} co-occurring tags\n`);
  for (const [tag, n] of sorted.slice(0, 60)) {
    const pct = ((n / seen) * 100).toFixed(1);
    console.log(`  ${String(n).padStart(4)}  ${String(pct).padStart(5)}%  ${tag}`);
  }

  const safe = NEIGHBOURS.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const csv = ['tag,books,pct_of_neighbourhood', ...sorted.map(([t, n]) =>
    `"${t.replace(/"/g, '""')}",${n},${((n / seen) * 100).toFixed(2)}`)].join('\n');
  writeFileSync(join(__dirname, '..', 'output', `hardcover-neighbours-${safe}.csv`), csv);
  console.log(`\n[probe] written to batch-scripts/hardcover-neighbours-${safe}.csv`);
  console.log(
    '[probe] a tag high in this list is BOTH real and relevant — those are the\n' +
    '        ones worth adding to the matching GENRE_MAP entry.'
  );
}

(async () => {
  if (MODE_VOCAB) await runVocab();
  if (MODE_VARIANTS) await runVariants();
  if (NEIGHBOURS) await runNeighbours();
})().catch((e) => {
  console.error('[probe] fatal:', e.message);
  process.exit(1);
});
