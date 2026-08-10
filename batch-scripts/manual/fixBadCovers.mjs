// fixBadCovers.mjs
// Nulls out known bad cover URLs (publisher logos, wrong-book images from
// publisher scrapers) so coverBackfill.mjs can re-process them cleanly.
//
// Usage:
//   node batch-scripts/fixBadCovers.mjs            # fix
//   node batch-scripts/fixBadCovers.mjs --dry-run  # preview only

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');

const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);

const supabase = createClient(env['VITE_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

// Exact bad URLs
const BAD_URLS = [
  'https://www.penguinrandomhouse.com/wp-content/themes/penguinrandomhouse/images/prh-social.jpg',
];

// Any cover_url containing these fragments is considered bad.
// wp-content/uploads from publisher domains = likely wrong book image from
// a search results page, not a reliably matched book cover.
const BAD_FRAGMENTS = [
  '/wp-content/themes/',       // publisher logo/theme assets
  'hachettebookgroup.com/wp-content/uploads/20',  // Hachette search-page mismatches
  'simonandschuster.com/wp-content/',
  'macmillan.com/wp-content/',
  'harpercollins.com/wp-content/',
  '/images/prh-social',
  '/images/logo',
  '/images/og-default',
  '/images/og-fallback',
  '/images/placeholder',
  '/images/default',
  '/assets/images/logo',
  '/static/images/logo',
];

async function main() {
  console.log('\nFix Bad Covers' + (DRY_RUN ? ' (DRY RUN)' : '') + '\n');

  const { data: books, error } = await supabase
    .from('books')
    .select('id, title, author, cover_url')
    .not('cover_url', 'is', null);

  if (error) { console.error('Fetch failed: ' + error.message); process.exit(1); }

  const bad = books.filter((b) => {
    if (BAD_URLS.indexOf(b.cover_url) !== -1) return true;
    for (let i = 0; i < BAD_FRAGMENTS.length; i++) {
      if (b.cover_url.indexOf(BAD_FRAGMENTS[i]) !== -1) return true;
    }
    return false;
  });

  console.log('Found ' + bad.length + ' book(s) with bad cover URLs.\n');

  for (let i = 0; i < bad.length; i++) {
    const b = bad[i];
    console.log('  ' + b.title + ' — ' + b.cover_url);
    if (!DRY_RUN) {
      const { error: updateErr } = await supabase
        .from('books').update({ cover_url: null }).eq('id', b.id);
      if (updateErr) console.log('    write failed: ' + updateErr.message);
    }
  }

  if (!DRY_RUN && bad.length > 0) {
    console.log('\nCleared ' + bad.length + ' bad cover(s). Run coverBackfill.mjs to re-process.');
  } else if (DRY_RUN) {
    console.log('\nDry run — no changes made.');
  } else if (bad.length === 0) {
    console.log('Nothing to fix.');
  }
}

main();
