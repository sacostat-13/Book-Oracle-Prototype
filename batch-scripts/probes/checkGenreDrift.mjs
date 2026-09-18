// checkGenreDrift.mjs — do the keyword rules still point at real genres?
//
// READ-ONLY. One select on public.genres, no writes, no API spend.
//
// Run it after any migration that renames, merges or deletes a genre, before
// the nightly run finds out for you. Exits 1 and lists the stale rule targets
// if any rule in _shared/genreRules.mjs names a genre that no longer exists.
//
// The nightly metadataBackfill and regenreCatalog runs make the same check and
// fail the run on drift; this is the same check without waiting for the night.
//
// Usage (from project root):
//   node batch-scripts/probes/checkGenreDrift.mjs

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { findGenreDrift, GENRE_RULES } from '../_shared/genreRules.mjs';
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
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || env['VITE_SUPABASE_URL'] || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env['SUPABASE_SECRET_KEY'] || env['SUPABASE_SERVICE_ROLE_KEY'] || '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);

const { data, error } = await supabase.from('genres').select('name');
if (error) {
  // Never report "no drift" on a failed read: an empty genre list is not a clean bill.
  console.error(`[genre-drift] could not read genres: ${error.message}`);
  process.exit(1);
}

const targets = new Set(GENRE_RULES.map(([name]) => name));
const missing = findGenreDrift(new Set((data || []).map((r) => r.name)));
if (missing.length) {
  console.error(`[genre-drift] ${missing.length} of ${targets.size} rule target(s) are not in public.genres:`);
  for (const n of missing) console.error(`  ${n}`);
  console.error('\nFix batch-scripts/_shared/genreRules.mjs: point each rule at the genre it was');
  console.error('merged into or renamed to, or delete it if the genre is gone for good.');
  process.exit(1);
}
console.log(`[genre-drift] OK: all ${targets.size} rule targets exist (${data.length} genres).`);
