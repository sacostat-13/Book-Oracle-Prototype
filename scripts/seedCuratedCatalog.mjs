// Curated catalog seeder. Run this ONCE after applying schema_v2 + schema_v3
// migrations to populate the shared `books` and `series` tables with your
// hand-picked catalog (the original BOOKS_DATA) as verified=true.
//
// Usage (from project root):
//   node scripts/seedCuratedCatalog.mjs
//
// Required env (loaded from .env.local):
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY    ← NOT the anon key; service role bypasses RLS
//
// The service role key is in Supabase → Project Settings → API → service_role.
// NEVER commit it or expose it to the browser. This script runs locally with
// Node, so it's fine here.
//
// If you're on Node < 22, install ws first:  npm install --save-dev ws

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read .env.local
const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const url = env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// Optional ws shim for Node < 22
let clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false },
};
try {
  if (parseInt(process.versions.node.split('.')[0], 10) < 22) {
    const wsMod = await import('ws');
    const ws = wsMod.default || wsMod;
    clientOptions.realtime = { transport: ws };
    clientOptions.global = { WebSocket: ws };
  }
} catch {
  // ws not installed; only matters if Supabase client tries to open a realtime channel,
  // which the REST/RPC operations below don't.
}

const supabase = createClient(url, serviceKey, clientOptions);

// Load BOOKS_DATA. We convert the ES module export to something node can read.
const booksDataText = readFileSync(
  join(__dirname, '..', 'src', 'lib', 'booksData.js'),
  'utf8'
);
const cleaned = booksDataText.replace(/^export const BOOKS_DATA =/, 'const BOOKS_DATA =');
const BOOKS_DATA = (await import(
  `data:text/javascript,${encodeURIComponent(cleaned + '\nexport default BOOKS_DATA;')}`
)).default;

console.log(`Seeding ${BOOKS_DATA.length} curated books…`);

function normalizeKey(title, author) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(title) + '|' + norm(author).slice(0, 10);
}

function normalizeSeriesName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

// First pass: collect unique series and upsert them as verified curated rows.
console.log('Step 1/2: seeding series…');
const seriesMap = new Map(); // normalizedName -> { id, name, author }
const distinctSeries = new Map();
for (const b of BOOKS_DATA) {
  if (b.s?.name) {
    const k = normalizeSeriesName(b.s.name);
    if (!distinctSeries.has(k)) {
      distinctSeries.set(k, { name: b.s.name, author: b.a, total: b.s.total || null });
    }
  }
}
console.log(`  ${distinctSeries.size} distinct series`);

let seriesInserted = 0;
let seriesUpdated = 0;
for (const [k, info] of distinctSeries) {
  const { data: existing } = await supabase
    .from('series')
    .select('id, verified')
    .eq('normalized_name', k)
    .maybeSingle();
  if (existing) {
    await supabase
      .from('series')
      .update({
        name: info.name,
        author: info.author,
        total_books: info.total,
        source: 'curated',
        verified: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    seriesMap.set(k, { id: existing.id });
    seriesUpdated++;
  } else {
    const { data, error } = await supabase
      .from('series')
      .insert({
        name: info.name,
        normalized_name: k,
        author: info.author,
        total_books: info.total,
        source: 'curated',
        verified: true,
      })
      .select('id')
      .single();
    if (error) {
      console.error(`  series fail [${info.name}]:`, error.message);
    } else {
      seriesMap.set(k, { id: data.id });
      seriesInserted++;
    }
  }
}
console.log(`  series inserted: ${seriesInserted}, updated: ${seriesUpdated}`);

// Second pass: upsert books with series_id reference.
console.log('Step 2/2: seeding books…');
let inserted = 0;
let updated = 0;
let errors = 0;

for (const b of BOOKS_DATA) {
  const key = normalizeKey(b.t, b.a);
  const seriesId = b.s?.name ? seriesMap.get(normalizeSeriesName(b.s.name))?.id : null;

  const { data: existing } = await supabase
    .from('books')
    .select('id, verified, source')
    .eq('normalized_key', key)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('books')
      .update({
        title: b.t,
        author: b.a,
        genre: b.g || null,
        complexity: b.c || null,
        depth: b.p || null,
        description: b.d || null,
        series_id: seriesId,
        position_in_series: b.s?.n || null,
        source: 'curated',
        verified: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) {
      console.error(`  UPDATE fail [${b.t}]:`, error.message);
      errors++;
    } else {
      updated++;
    }
  } else {
    const { error } = await supabase.from('books').insert({
      title: b.t,
      author: b.a,
      normalized_key: key,
      genre: b.g || null,
      complexity: b.c || null,
      depth: b.p || null,
      description: b.d || null,
      series_id: seriesId,
      position_in_series: b.s?.n || null,
      source: 'curated',
      verified: true,
    });
    if (error) {
      console.error(`  INSERT fail [${b.t}]:`, error.message);
      errors++;
    } else {
      inserted++;
    }
  }

  if ((inserted + updated) % 25 === 0 && (inserted + updated) > 0) {
    console.log(`  ${inserted + updated}/${BOOKS_DATA.length}…`);
  }
}

console.log(`\nDone.`);
console.log(`  series inserted: ${seriesInserted}, updated: ${seriesUpdated}`);
console.log(`  books inserted:  ${inserted}`);
console.log(`  books updated:   ${updated}`);
console.log(`  errors:          ${errors}`);
process.exit(0);
