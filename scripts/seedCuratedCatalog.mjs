// Curated catalog seeder. Run this ONCE after applying schema_v2_migration.sql
// to populate the shared `books` table with your hand-picked 280-book catalog
// (the original BOOKS_DATA).
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

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Load BOOKS_DATA. We have to convert the ES module export to something node can read.
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

let inserted = 0;
let updated = 0;
let errors = 0;

for (const b of BOOKS_DATA) {
  const key = normalizeKey(b.t, b.a);
  // Check if exists
  const { data: existing } = await supabase
    .from('books')
    .select('id, verified, source')
    .eq('normalized_key', key)
    .maybeSingle();

  if (existing) {
    // Upgrade an existing user-contributed row to curated/verified
    const { error } = await supabase
      .from('books')
      .update({
        title: b.t,
        author: b.a,
        genre: b.g || null,
        complexity: b.c || null,
        depth: b.p || null,
        description: b.d || null,
        series_name: b.s?.name || null,
        series_position: b.s?.n || null,
        source: 'curated',
        verified: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) {
      console.error(`UPDATE fail [${b.t}]:`, error.message);
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
      series_name: b.s?.name || null,
      series_position: b.s?.n || null,
      source: 'curated',
      verified: true,
    });
    if (error) {
      console.error(`INSERT fail [${b.t}]:`, error.message);
      errors++;
    } else {
      inserted++;
    }
  }

  if ((inserted + updated) % 25 === 0) {
    console.log(`  ${inserted + updated}/${BOOKS_DATA.length}…`);
  }
}

console.log(`\nDone.`);
console.log(`  inserted: ${inserted}`);
console.log(`  updated:  ${updated}`);
console.log(`  errors:   ${errors}`);
