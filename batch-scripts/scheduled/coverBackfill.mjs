// coverBackfill.mjs — v4
// Pipeline per book:
//   1. Open Library search (title+author) with ?default=false to avoid GIF placeholders
//   2. Open Library editions API (harvests ISBNs when search has no cover)
//   3. Penguin Random House CDN by ISBN (images4.penguinrandomhouse.com/smedia/ISBN)
//   4. Open Library by ISBN with ?default=false
//   5. Google Books (thumbnail + ISBN harvest)
//   6. Open Library / PRH by Google ISBNs
//   7. Claude with web_search (if ANTHROPIC_API_KEY present and --no-claude not set)
//
// Usage:
//   node batch-scripts/coverBackfill.mjs
//   node batch-scripts/coverBackfill.mjs --dry-run
//   node batch-scripts/coverBackfill.mjs --limit 50
//   node batch-scripts/coverBackfill.mjs --delay 400
//   node batch-scripts/coverBackfill.mjs --no-claude
//
// Required in .env.local:
//   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY  (optional — only for Claude fallback)

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import {
  readFileSync
} from 'fs';
import {
  dirname,
  join
} from 'path';
import {
  fileURLToPath
} from 'url';

const __dirname = dirname(fileURLToPath(
  import.meta.url));

// -- CLI args -----------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const NO_CLAUDE = args.includes('--no-claude');
const VERBOSE = args.includes('--verbose');

const limitArg = args.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ?
  parseInt(limitArg.includes('=') ? limitArg.split('=')[1] : args[args.indexOf(limitArg) + 1], 10) :
  null;

const delayArg = args.find((a) => a.startsWith('--delay'));
const DELAY_MS = delayArg ?
  parseInt(delayArg.includes('=') ? delayArg.split('=')[1] : args[args.indexOf(delayArg) + 1], 10) :
  400;

// -- Env ----------------------------------------------------------------------
const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
  })
);

const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'] || '';
const ANTHROPIC_KEY = env['ANTHROPIC_API_KEY'] || '';
const HARDCOVER_TOKEN = env['HARDCOVER_API_TOKEN'] || env['VITE_HARDCOVER_TOKEN'] || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);

// -- Helpers ------------------------------------------------------------------
function cleanTitle(t) {
  return t.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').replace(/\s*\/.*$/, '').trim();
}

function cleanAuthor(a) {
  return (a || '').split(/[,&]|\sand\s/i)[0].trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function vlog(msg) {
  if (VERBOSE) process.stdout.write('    ' + msg + '\n');
}

// Verify by doing a HEAD — using ?default=false on OL URLs means 404 = no cover.
// For non-OL URLs fall back to checking content-type.
async function verifyImage(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD'
    });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    // Reject explicitly non-image content-types
    if (ct && ct.indexOf('image/') !== 0) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// -- Source 1: Open Library search --------------------------------------------
async function tryOpenLibrary(title, author) {
  const q = 'title=' + encodeURIComponent(cleanTitle(title)) +
    '&author=' + encodeURIComponent(cleanAuthor(author)) +
    '&fields=key,cover_i,isbn&limit=5';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await sleep(1000 * attempt);
      const res = await fetch('https://openlibrary.org/search.json?' + q);
      if (!res.ok) return {
        coverUrl: null,
        isbns: [],
        workKey: null
      };
      let data;
      try {
        data = await res.json();
      } catch (e) {
        return {
          coverUrl: null,
          isbns: [],
          workKey: null
        };
      }
      const docs = Array.isArray(data && data.docs) ? data.docs : [];
      const isbns = [];
      let workKey = null;

      for (let i = 0; i < Math.min(docs.length, 5); i++) {
        const doc = docs[i];
        if (!workKey && doc.key) workKey = doc.key;

        // Collect ISBNs
        if (Array.isArray(doc.isbn)) {
          for (const isbn of doc.isbn) {
            if (isbns.indexOf(isbn) === -1) isbns.push(isbn);
          }
        }

        // Try cover by ID — append ?default=false so missing = 404, not GIF
        if (doc.cover_i) {
          const url = 'https://covers.openlibrary.org/b/id/' + doc.cover_i + '-L.jpg?default=false';
          vlog('OL cover_i: ' + url);
          if (await verifyImage(url)) return {
            coverUrl: url,
            isbns,
            workKey
          };
        }

        // Try each ISBN from search result
        if (Array.isArray(doc.isbn)) {
          for (const isbn of doc.isbn.slice(0, 3)) {
            const url = 'https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg?default=false';
            vlog('OL isbn (search): ' + url);
            if (await verifyImage(url)) return {
              coverUrl: url,
              isbns,
              workKey
            };
          }
        }
      }

      // If no cover yet but we have a work key, fetch editions to get more ISBNs
      if (workKey && isbns.length === 0) {
        try {
          const edRes = await fetch('https://openlibrary.org' + workKey + '/editions.json?limit=10');
          if (edRes.ok) {
            const edData = await edRes.json();
            const entries = Array.isArray(edData && edData.entries) ? edData.entries : [];
            for (const entry of entries) {
              for (const isbn of (entry.isbn_13 || entry.isbn_10 || [])) {
                if (isbns.indexOf(isbn) === -1) isbns.push(isbn);
              }
            }
          }
        } catch (e) {}
      }

      return {
        coverUrl: null,
        isbns,
        workKey
      };
    } catch (e) {
      /* retry */ }
  }
  return {
    coverUrl: null,
    isbns: [],
    workKey: null
  };
}

// -- Source 2: Open Library by ISBN -------------------------------------------
async function tryOlByIsbn(isbn) {
  if (!isbn) return null;
  const url = 'https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg?default=false';
  vlog('OL by isbn: ' + url);
  return (await verifyImage(url)) ? url : null;
}

// -- Source 3: Penguin Random House CDN ---------------------------------------
// PRH stores covers at a predictable URL: images4.penguinrandomhouse.com/smedia/ISBN13
// Works for Dutton, Random House, Crown, Knopf, Viking, Riverhead, Anchor, etc.
// Uses GET + byte size check because PRH serves a "Cover coming soon" placeholder
// as a valid JPEG that would otherwise pass a HEAD content-type check.
async function tryPRH(isbn) {
  if (!isbn || isbn.length !== 13) return null;
  const url = 'https://images4.penguinrandomhouse.com/smedia/' + isbn;
  vlog('PRH: ' + url);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct && ct.indexOf('image/') !== 0) {
      await res.body.cancel();
      return null;
    }
    const buf = await res.arrayBuffer();
    // PRH "Cover coming soon" placeholder is a small image (~5-15KB).
    // Real covers are typically 50KB+. Use 20KB as the threshold.
    if (buf.byteLength < 20000) {
      vlog('PRH too small (' + buf.byteLength + 'b) — placeholder');
      return null;
    }
    return url;
  } catch (e) {
    return null;
  }
}

// -- Source 4: Google Books ---------------------------------------------------
async function tryGoogleBooks(title, author) {
  try {
    const query = encodeURIComponent('intitle:"' + cleanTitle(title) + '" inauthor:"' + cleanAuthor(author) + '"');
    const res = await fetch('https://www.googleapis.com/books/v1/volumes?q=' + query + '&maxResults=5');
    if (!res.ok) return {
      url: null,
      isbns: []
    };
    let data;
    try {
      data = await res.json();
    } catch (e) {
      return {
        url: null,
        isbns: []
      };
    }

    const items = Array.isArray(data && data.items) ? data.items : [];
    const isbns = [];

    for (const item of items) {
      const info = item && item.volumeInfo;
      if (!info) continue;
      for (const id of (info.industryIdentifiers || [])) {
        if (id.type === 'ISBN_13' || id.type === 'ISBN_10') {
          if (isbns.indexOf(id.identifier) === -1) isbns.push(id.identifier);
        }
      }
      const links = info.imageLinks;
      if (links) {
        const img = links.thumbnail || links.smallThumbnail;
        if (img) {
          const upgraded = img.replace(/^http:/, 'https:').replace(/&edge=curl/, '').replace(/&zoom=\d/, '&zoom=1');
          vlog('Google thumbnail: ' + upgraded);
          if (await verifyImage(upgraded)) return {
            url: upgraded,
            isbns
          };
        }
      }
    }
    return {
      url: null,
      isbns
    };
  } catch (e) {
    return {
      url: null,
      isbns: []
    };
  }
}

// -- Source 5: Hardcover search --------------------------------------------
// Uses Hardcover's search() endpoint (same as the app) — returns Typesense
// hits with image URLs on assets.hardcover.app, a stable CDN.
// Requires HARDCOVER_API_TOKEN in .env.local.
async function tryHardcover(title, author) {
  if (!HARDCOVER_TOKEN) {
    vlog('Hardcover: no token');
    return null;
  }
  try {
    const q = cleanTitle(title) + ' ' + cleanAuthor(author);
    const gqlQuery = `query SearchBooks($q: String!) {
      search(query: $q, query_type: "Book", per_page: 5, page: 1) {
        results
      }
    }`;
    const res = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: {
        'Authorization': HARDCOVER_TOKEN.startsWith('Bearer ') ? HARDCOVER_TOKEN : 'Bearer ' + HARDCOVER_TOKEN,
        'Content-Type': 'application/json',
        'User-Agent': 'BookOracleBackfill/1.0',
      },
      body: JSON.stringify({
        query: gqlQuery,
        variables: {
          q
        }
      }),
    });
    vlog('Hardcover HTTP: ' + res.status);
    if (!res.ok) return null;
    let data;
    try {
      data = await res.json();
    } catch (e) {
      return null;
    }
    const results = data && data.data && data.data.search && data.data.search.results;
    if (!results) return null;
    const hits = results.hits || results.results || [];
    vlog('Hardcover hits: ' + hits.length);
    for (const hit of hits.slice(0, 5)) {
      const doc = hit.document || hit;
      // Typesense document has image as { url } or image_url directly
      const imgUrl = (doc.image && doc.image.url) || doc.image_url || doc.cover_image || null;
      if (imgUrl) {
        vlog('Hardcover image: ' + imgUrl);
        if (await verifyImage(imgUrl)) return imgUrl;
      }
    }
  } catch (e) {
    vlog('Hardcover error: ' + e.message);
  }
  return null;
}

// -- Source 6: Claude ---------------------------------------------------------
async function tryClaude(title, author) {
  if (!ANTHROPIC_KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: 'You find book cover image URLs. Use web_search to find the book, then return ONLY the direct image URL (https://...). Reply null if not found.',
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search'
        }],
        messages: [{
          role: 'user',
          content: 'Find cover image URL for "' + title + '" by ' + (author || 'unknown')
        }],
      }),
    });

    vlog('Claude status: ' + res.status);
    if (!res.ok) {
      vlog('Claude error: ' + (await res.text()).slice(0, 200));
      return null;
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      return null;
    }

    const blocks = Array.isArray(data && data.content) ? data.content : [];
    vlog('Claude blocks: ' + blocks.map((b) => b.type).join(', '));
    let raw = '';
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].type === 'text' && (blocks[i].text || '').trim()) {
        raw = blocks[i].text.trim();
        break;
      }
    }
    vlog('Claude raw: ' + raw.slice(0, 200));
    if (!raw || raw.toLowerCase() === 'null' || raw.indexOf('http') === -1) return null;
    const match = raw.match(/https?:\/\/[^\s"'<>)]+/);
    if (!match) return null;
    vlog('Claude URL: ' + match[0]);
    return (await verifyImage(match[0])) ? match[0] : null;
  } catch (e) {
    vlog('Claude exception: ' + e.message);
    return null;
  }
}

// -- Pipeline -----------------------------------------------------------------
async function fetchCover(title, author, existingIsbn, log) {
  let url;

  // 1. Open Library search — also collects ISBNs + work key
  log('Open Library search');
  const ol = await tryOpenLibrary(title, author);
  if (ol.coverUrl) return {
    url: ol.coverUrl,
    source: 'openlibrary'
  };

  // Merge ISBNs from DB + OL search
  const isbns = existingIsbn ? [existingIsbn] : [];
  for (const isbn of ol.isbns) {
    if (isbns.indexOf(isbn) === -1) isbns.push(isbn);
  }

  // 2. Try each ISBN against OL (?default=false) and PRH CDN
  if (isbns.length > 0) {
    log('OL/PRH by ISBN (' + isbns.length + ')');
    for (const isbn of isbns) {
      url = await tryOlByIsbn(isbn);
      if (url) return {
        url,
        source: 'openlibrary-isbn'
      };
      url = await tryPRH(isbn);
      if (url) return {
        url,
        source: 'prh'
      };
    }
  }

  // 3. Google Books — thumbnail + collect more ISBNs
  log('Google Books');
  const google = await tryGoogleBooks(title, author);
  if (google.url) return {
    url: google.url,
    source: 'google'
  };

  if (google.isbns.length > 0) {
    log('OL/PRH by Google ISBNs (' + google.isbns.length + ')');
    for (const isbn of google.isbns) {
      if (isbns.indexOf(isbn) === -1) { // skip already tried
        url = await tryOlByIsbn(isbn);
        if (url) return {
          url,
          source: 'openlibrary-isbn'
        };
        url = await tryPRH(isbn);
        if (url) return {
          url,
          source: 'prh'
        };
      }
    }
  }

  // 4. Bookcover API — Goodreads covers via free proxy, good for recent/niche titles
  log('Hardcover');
  url = await tryHardcover(title, author);
  if (url) return {
    url,
    source: 'hardcover'
  };

  // 5. Claude last resort
  if (!NO_CLAUDE) {
    log('Claude');
    url = await tryClaude(title, author);
    if (url) return {
      url,
      source: 'claude'
    };
  }

  return null;
}

// -- Main ---------------------------------------------------------------------
async function main() {
  console.log('\nCover Backfill' + (DRY_RUN ? ' (DRY RUN)' : ''));
  console.log('Sources: Open Library → OL/PRH by ISBN → Google Books → OL/PRH by Google ISBN → Hardcover' + (NO_CLAUDE ? '' : ' → Claude'));
  console.log('Delay: ' + DELAY_MS + 'ms | Verbose: ' + VERBOSE);
  if (LIMIT) console.log('Limit: ' + LIMIT);
  console.log('');

  let query = supabase.from('books').select('id, title, author, isbn').is('cover_url', null).order('created_at', {
    ascending: true
  });
  if (LIMIT) query = query.limit(LIMIT);

  const {
    data: books,
    error
  } = await query;
  if (error) {
    console.error('Fetch failed: ' + error.message);
    process.exit(1);
  }

  const total = books.length;
  console.log('Found ' + total + ' book(s) with no cover.\n');
  if (total === 0 || DRY_RUN) {
    if (DRY_RUN && total > 0) console.log('Dry run — no writes.');
    return;
  }

  let found = 0,
    notFound = 0,
    errors = 0;
  const sources = {
    'openlibrary': 0,
    'openlibrary-isbn': 0,
    'prh': 0,
    'google': 0,
    'hardcover': 0,
    'claude': 0
  };
  const pad = String(total).length;

  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    const label = '[' + String(i + 1).padStart(pad, ' ') + '/' + total + ']';
    console.log(label + ' ' + b.title + ' — ' + (b.author || '(no author)'));

    const log = (step) => process.stdout.write('  → ' + step + '\n');

    try {
      const result = await fetchCover(b.title, b.author || '', b.isbn || null, log);
      if (result) {
        const {
          error: updateErr
        } = await supabase.from('books').update({
          cover_url: result.url
        }).eq('id', b.id);
        if (updateErr) {
          console.log('  ✗ write failed: ' + updateErr.message);
          errors++;
        } else {
          console.log('  ✓ ok (' + result.source + ')');
          found++;
          if (sources[result.source] !== undefined) sources[result.source]++;
        }
      } else {
        console.log('  — not found');
        notFound++;
      }
    } catch (e) {
      console.log('  ✗ error: ' + e.message);
      errors++;
    }

    if (i < books.length - 1) await sleep(DELAY_MS);
  }

  console.log('\n--------------------------------');
  console.log('  Total     : ' + total);
  console.log('  Found     : ' + found);
  console.log('    OL      : ' + sources['openlibrary']);
  console.log('    OL/ISBN : ' + sources['openlibrary-isbn']);
  console.log('    PRH     : ' + sources['prh']);
  console.log('    Google  : ' + sources['google']);
  console.log('    Bookcover: ' + sources['hardcover']);
  console.log('    Claude  : ' + sources['claude']);
  console.log('  Not found : ' + notFound);
  console.log('  Errors    : ' + errors);
  console.log('--------------------------------');
}

main();
