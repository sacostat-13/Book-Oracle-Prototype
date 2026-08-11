// fixBook.mjs — repair one book from a known-good ISBN. For user-reported errors.
//
// WHY THIS SHAPE
// --------------
// When a reader reports "this is the wrong book", they usually know one thing for certain:
// the ISBN, off the copy in their hand. Everything else — title, author, description,
// cover, page count — is derivable FROM that ISBN, and an ISBN is an exact identifier
// rather than a fuzzy title match. So this script takes the one fact a human is sure of
// and re-derives the rest, instead of asking them to retype five fields.
//
// This is the repair path for the failure mode that produced it: "La mano que cura"
// (Lina Maria Parra Ochoa) had been renamed to "Puppet Master" (Miyuki Miyabe) while its
// ISBN pointed at a third book, "Puppet Master" by Dale Brown. Title, author, ISBN and
// description had drifted apart into three different books.
//
// UNLIKE the batch scripts, this OVERWRITES. Those fill nulls because they act without
// supervision; this one runs because a person established the row is wrong, so leaving a
// stale description in place would defeat the purpose.
//
// The row is then marked status='verified', verified_source='admin'. That is not
// decoration: upsert_book will not overwrite a verified row's curated fields, and
// getBooksNeedingOracle skips verified rows — so a hand-checked fix cannot be undone by
// a later automated pass.
//
// Usage:
//   node batch-scripts/fixBook.mjs --isbn 9788412763201 --title "La mano que cura"
//   node batch-scripts/fixBook.mjs --isbn 9788412763201 --id <uuid>
//   node batch-scripts/fixBook.mjs --isbn 9788412763201 --id <uuid> --write
//   node batch-scripts/fixBook.mjs --isbn 9788412763201 --id <uuid> \
//     --description-file desc.txt --write
//
// Dry run by default — it prints a field-by-field diff and changes nothing until --write.
//
// Required in .env.local: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional:               GOOGLE_BOOKS_API_KEY (better descriptions), HARDCOVER_API_TOKEN

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { cleanIsbn, isValidIsbn, isbn10to13 } from '../../src/lib/isbn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
function argVal(name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : null;
}

const RAW_ISBN = argVal('--isbn');
const BOOK_ID = argVal('--id');
const TITLE = argVal('--title');

// Manual overrides. The escape hatch for a book no aggregator indexes — which is exactly
// the population that ends up needing hand repair in the first place.
const SET_TITLE = argVal('--set-title');
const SET_AUTHOR = argVal('--set-author');
// A publisher blurb is several hundred words with paragraph breaks and accented
// characters — unpleasant to pass as a shell argument, and PowerShell mangles quoting
// differently again. --description-file takes a UTF-8 text file instead.
const DESC_FILE = argVal('--description-file');
const SET_DESC = DESC_FILE
  ? readFileSync(DESC_FILE, 'utf8').trim()
  : argVal('--set-description');

if (!RAW_ISBN || (!BOOK_ID && !TITLE)) {
  console.error('Usage: node batch-scripts/fixBook.mjs --isbn <isbn> (--id <uuid> | --title "<title>") [--write]');
  console.error('  optional: --set-title "..." --set-author "..."');
  console.error('            --set-description "..."   (short text)');
  console.error('            --description-file <path>  (long blurbs — UTF-8, keeps line breaks)');
  process.exit(1);
}

const ISBN = (() => {
  const c = cleanIsbn(RAW_ISBN);
  if (!c) { console.error(`"${RAW_ISBN}" is not a well-formed ISBN.`); process.exit(1); }
  if (!isValidIsbn(c)) { console.error(`ISBN ${c} fails its check digit — re-read it from the book.`); process.exit(1); }
  return c.length === 10 ? isbn10to13(c) : c;
})();

const env = Object.fromEntries(
  readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim().replace(/^export\s+/, ''), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);
const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'] || '';
const GOOGLE_KEY = env['GOOGLE_BOOKS_API_KEY'] || '';
const HARDCOVER_TOKEN = env['HARDCOVER_API_TOKEN'] || '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);

// Mirrors compute_book_key() — see curateManualBooks.mjs for why these must stay in step.
function computeBookKey(title, author) {
  const strip = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${strip(title)}|${strip(author).slice(0, 10)}`;
}

async function getJson(url, headers = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'BooksOracle-fixBook/1.0', ...headers } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// ── Sources, all queried BY ISBN so there is no matching risk ────────────────
async function fromGoogleBooks() {
  if (!GOOGLE_KEY) return null;
  const d = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${ISBN}&key=${GOOGLE_KEY}`);
  const vi = d?.items?.[0]?.volumeInfo;
  if (!vi) return null;
  return {
    source: 'googlebooks',
    title: vi.subtitle ? `${vi.title}: ${vi.subtitle}` : vi.title,
    author: (vi.authors || [])[0] || null,
    description: vi.description || null,
    pages: vi.pageCount || null,
    cover_url: (vi.imageLinks?.thumbnail || vi.imageLinks?.smallThumbnail || '')
      .replace(/^http:/, 'https:').replace(/&edge=curl/, '') || null,
    language: vi.language || null,
  };
}

async function fromOpenLibrary() {
  const ed = await getJson(`https://openlibrary.org/isbn/${ISBN}.json`);
  if (!ed) return null;
  let author = null;
  const key = (ed.authors || [])[0]?.key;
  if (key) author = (await getJson(`https://openlibrary.org${key}.json`))?.name || null;
  let description = typeof ed.description === 'string' ? ed.description : ed.description?.value || null;
  if (!description && ed.works?.[0]?.key) {
    const w = await getJson(`https://openlibrary.org${ed.works[0].key}.json`);
    description = typeof w?.description === 'string' ? w.description : w?.description?.value || null;
  }
  return {
    source: 'openlibrary',
    title: ed.title || null,
    author,
    description,
    pages: ed.number_of_pages || null,
    cover_url: ed.covers?.[0] ? `https://covers.openlibrary.org/b/id/${ed.covers[0]}-L.jpg` : null,
    language: (ed.languages || [])[0]?.key?.split('/').pop() || null,
  };
}

async function fromHardcover() {
  if (!HARDCOVER_TOKEN) return null;
  try {
    const r = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: {
        Authorization: HARDCOVER_TOKEN.startsWith('Bearer ') ? HARDCOVER_TOKEN : `Bearer ${HARDCOVER_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'BooksOracle-fixBook/1.0',
      },
      body: JSON.stringify({
        query: `query E($i: String!) {
          editions(where: { isbn_13: { _eq: $i } }, limit: 1) {
            pages
            book { id title description image { url } contributions { author { name } } }
          } }`,
        variables: { i: ISBN },
      }),
    });
    if (!r.ok) return null;
    const e = (await r.json())?.data?.editions?.[0];
    if (!e?.book) return null;
    return {
      source: 'hardcover',
      hardcover_id: e.book.id || null,
      title: e.book.title || null,
      author: (e.book.contributions || [])[0]?.author?.name || null,
      description: e.book.description || null,
      pages: e.pages || null,
      cover_url: e.book.image?.url || null,
    };
  } catch { return null; }
}

// The supplied ISBN identifies an EDITION; aggregators index editions unevenly. A Spanish
// small-press printing routinely has no record while other editions of the same work do —
// "La mano que cura" exists on Google Books and Amazon.com.mx under different ISBNs
// (9788412652802, 9786287659094) but not under the one printed in the copy you hold.
//
// So when the ISBN finds nothing, fall back to the WORK by title+author. The user's ISBN
// is still what gets written — it is the edition they actually have, and the one their
// purchase link should point at — but the description and cover can legitimately come
// from a sibling edition.
async function fromGoogleBooksByTitle(title, author) {
  if (!GOOGLE_KEY || !title) return null;
  const q = [`intitle:${JSON.stringify(title)}`, author ? `inauthor:${JSON.stringify(author)}` : '']
    .filter(Boolean).join(' ');
  const d = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=3&key=${GOOGLE_KEY}`);
  const vi = d?.items?.[0]?.volumeInfo;
  if (!vi) return null;
  return {
    source: 'googlebooks (by title — different edition)',
    title: vi.subtitle ? `${vi.title}: ${vi.subtitle}` : vi.title,
    author: (vi.authors || [])[0] || null,
    description: vi.description || null,
    pages: vi.pageCount || null,
    cover_url: (vi.imageLinks?.thumbnail || '').replace(/^http:/, 'https:').replace(/&edge=curl/, '') || null,
  };
}

// Prefer whichever source actually has a value, in descending trust for each field.
function pick(field, sources) {
  for (const s of sources) if (s && s[field]) return { value: s[field], from: s.source };
  return { value: null, from: null };
}

async function main() {
  // 1. Locate the row.
  let q = supabase.from('books').select('*');
  q = BOOK_ID ? q.eq('id', BOOK_ID) : q.ilike('title', TITLE);
  const { data: rows, error } = await q;
  if (error) { console.error(error.message); process.exit(1); }
  if (!rows?.length) { console.error(`No book matched ${BOOK_ID ? `id ${BOOK_ID}` : `title "${TITLE}"`}.`); process.exit(1); }
  if (rows.length > 1) {
    console.error(`${rows.length} books matched "${TITLE}". Re-run with --id:`);
    for (const r of rows) console.error(`  ${r.id}  ${r.title} — ${r.author || '?'}  isbn=${r.isbn || '—'}`);
    process.exit(1);
  }
  const book = rows[0];

  // 2. Re-derive everything from the ISBN.
  console.log(`Looking up ${ISBN}…`);
  const [gb, ol, hc] = await Promise.all([fromGoogleBooks(), fromOpenLibrary(), fromHardcover()]);
  // "found" alone is misleading: a source can hold a record for an ISBN and carry
  // almost nothing on it. A Spanish small-press edition routinely has a title and
  // nothing else. List what each record actually contains so an empty diff further
  // down is explicable rather than mysterious.
  const inventory = (r) => {
    if (!r) return null;
    const has = ['title', 'author', 'description', 'pages', 'cover_url'].filter((k) => r[k]);
    return has.length ? `found — carries ${has.join(', ')}` : 'found — but the record is empty';
  };
  console.log(`  google books  ${!GOOGLE_KEY ? 'skipped (no GOOGLE_BOOKS_API_KEY)' : inventory(gb) || 'no record for this ISBN'}`);
  console.log(`  openlibrary   ${inventory(ol) || 'no record for this ISBN'}`);
  console.log(`  hardcover     ${!HARDCOVER_TOKEN ? 'skipped (no HARDCOVER_API_TOKEN)' : inventory(hc) || 'no record for this ISBN'}`);

  let found = [gb, ol, hc].filter(Boolean);

  // Nothing indexed this exact printing. Try the WORK by title+author before giving up —
  // aggregators cover editions unevenly and a sibling edition usually exists.
  let byTitle = null;
  if (!found.length) {
    const t = SET_TITLE || TITLE || book.title;
    const a = SET_AUTHOR || book.author;
    console.log(`\n  No source indexes this printing. Trying the work by title+author…`);
    console.log(`    "${t}"${a ? ` — ${a}` : ''}`);
    byTitle = await fromGoogleBooksByTitle(t, a);
    console.log(`    ${byTitle ? `found: "${byTitle.title}" — ${byTitle.author || '?'}` : 'no match'}`);
    if (byTitle) found = [byTitle];
  }

  const haveManual = SET_TITLE || SET_AUTHOR || SET_DESC;
  if (!found.length && !haveManual) {
    // Still worth writing the ISBN alone: it is the one fact you verified, and it is what
    // the purchase links are built from. Fixing the link is most of the value even with no
    // metadata behind it.
    console.log(`\n  Nothing found anywhere. You can still write just the ISBN — that alone`);
    console.log(`  repairs the Amazon/Bookshop links, which is the visible problem:`);
    console.log(`\n    node batch-scripts/fixBook.mjs --isbn ${ISBN} --id ${book.id} \\`);
    console.log(`      --set-title ${JSON.stringify(book.title)} \\`);
    console.log(`      --set-author ${JSON.stringify(book.author || '')} --write\n`);
    console.log(`  Add --set-description "..." if you want to supply one by hand.`);
    process.exit(1);
  }
  if (found.length) console.log(`\n  using: ${found.map((f) => f.source).join(', ')}\n`);
  else console.log(`\n  using: your --set-* values only\n`);

  // Google Books first for description (richest), OpenLibrary first for title/author
  // (closest to the physical edition, and better on Spanish-language books).
  const title       = pick('title',       [ol, gb, hc, byTitle]);
  const author      = pick('author',      [ol, gb, hc, byTitle]);
  const description = pick('description', [gb, ol, hc, byTitle]);
  const pages       = pick('pages',       [gb, ol, hc, byTitle]);
  const cover       = pick('cover_url',   [gb, ol, hc, byTitle]);
  const hcId        = pick('hardcover_id',[hc]);

  // Explicit --set-* always wins over any source.
  const finalTitle  = SET_TITLE  || title.value  || book.title;
  const finalAuthor = SET_AUTHOR || author.value || book.author;

  // A description belonging to a DIFFERENT book is worse than none: it actively misinforms
  // the reader and poisons Oracle recommendations. When the identity is being corrected and
  // no replacement description is available, null it rather than leave the old one.
  const identityChanged =
    (finalTitle || '').toLowerCase() !== (book.title || '').toLowerCase() ||
    (finalAuthor || '').toLowerCase() !== (book.author || '').toLowerCase();
  const finalDesc =
    SET_DESC ?? description.value ?? (identityChanged ? null : book.description);

  const patch = {
    isbn: ISBN,
    title: finalTitle,
    author: finalAuthor,
    description: finalDesc,
    pages: pages.value ?? (identityChanged ? null : book.pages),
    cover_url: cover.value ?? (identityChanged ? null : book.cover_url),
    hardcover_id: hcId.value ?? null,
    status: 'verified',
    verified_source: 'admin',
    verified_at: new Date().toISOString(),
  };
  patch.normalized_key = computeBookKey(patch.title, patch.author);

  if (identityChanged && finalDesc === null && !SET_DESC) {
    console.log(`  ! description cleared — it described the previous (wrong) book and no`);
    console.log(`    replacement was found. Supply one with --set-description if you have it.\n`);
  }

  // 3. Show the diff.
  const short = (v) => (v == null ? '—' : String(v).length > 90 ? String(v).slice(0, 87) + '…' : String(v));
  console.log('field           current → new');
  console.log('─'.repeat(78));
  let changes = 0;
  for (const [k, from] of [['title', SET_TITLE ? 'you' : title.from], ['author', SET_AUTHOR ? 'you' : author.from],
                           ['isbn', 'you'],
                           ['description', SET_DESC ? 'you' : description.from], ['pages', pages.from],
                           ['cover_url', cover.from], ['hardcover_id', hcId.from],
                           ['status', null], ['normalized_key', null]]) {
    const before = book[k], after = patch[k];
    if (String(before ?? '') === String(after ?? '')) continue;
    changes++;
    console.log(`${k.padEnd(15)} ${short(before)}`);
    console.log(`${''.padEnd(15)} → ${short(after)}${from ? `   [${from}]` : ''}`);
  }

  // ── Duplicate detection, BEFORE the key check ───────────────────────────────
  // normalized_key alone is not enough. It is title|author[0:10], so two rows for the
  // same book differ whenever the author does — and "Unknown author" is a literal
  // fallback string written by hardcoverService when a lookup returns no contributor.
  // "La mano que cura"+"Unknown author" and "La mano que cura"+"Lina Maria Parra Ochoa"
  // hash to different keys, so both survive the unique index and the reader sees the book
  // twice: one copy with the description, the other with the right author.
  //
  // Two rows carrying the SAME ISBN are the same book, whatever their author strings say.
  // That is the check that catches this.
  const { data: sameIsbn } = await supabase
    .from('books').select('id, title, author, status, description').eq('isbn', ISBN).neq('id', book.id);
  if (sameIsbn?.length) {
    console.log(`\n!! ${sameIsbn.length} other row(s) already carry ISBN ${ISBN} — same book, duplicated:`);
    for (const d of sameIsbn) {
      console.log(`     ${d.id}  "${d.title}" — ${d.author || '—'}  [${d.status}]  desc:${d.description ? 'yes' : 'no'}`);
    }
    console.log(`\n   Writing this row would leave the book listed more than once. Merge first —`);
    console.log(`   merge_books moves wishlist/library entries onto the survivor, then re-run`);
    console.log(`   this script on it to fill the fields:`);
    console.log(`\n     select public.merge_books('<duplicate-id>', '${book.id}');`);
    console.log(`     node batch-scripts/fixBook.mjs --isbn ${ISBN} --id ${book.id} --write`);
    console.log(`\n   Keep whichever row your users' lists point at; merge_books repoints the rest.`);
    if (!args.includes('--allow-duplicate')) {
      console.log(`\n   (--allow-duplicate overrides this if you know the editions are genuinely distinct.)`);
      process.exit(1);
    }
  }

  if (!changes) {
    console.log('(no differences — the row already matches what these sources hold)\n');
    const missing = ['description', 'cover_url', 'pages'].filter((k) => !book[k]);
    if (missing.length) {
      console.log(`This row is still missing: ${missing.join(', ')}.`);
      console.log(`No source carries ${missing.length > 1 ? 'them' : 'it'} for this ISBN, so nothing`);
      console.log(`automated will fill ${missing.length > 1 ? 'them' : 'it'} in. Supply by hand:\n`);
      if (missing.includes('description')) {
        console.log(`  node batch-scripts/fixBook.mjs --isbn ${ISBN} --id ${book.id} \\`);
        console.log(`    --description-file desc.txt --write\n`);
        console.log(`  (paste the publisher blurb into desc.txt as UTF-8)`);
      }
    }
    if (!WRITE) return;
  }

  // A corrected title that collides with another row means this is a duplicate, not a
  // rename — merging is a different operation with user data at stake, so stop.
  if (patch.normalized_key !== book.normalized_key) {
    const { data: clash } = await supabase
      .from('books').select('id, title').eq('normalized_key', patch.normalized_key).neq('id', book.id).maybeSingle();
    if (clash) {
      console.log(`\n!! "${clash.title}" (${clash.id}) already holds this key.`);
      console.log(`   These are the same book. Merge instead of renaming:`);
      console.log(`     select public.merge_books('${book.id}', '${clash.id}');`);
      process.exit(1);
    }
  }

  if (!WRITE) {
    console.log('\n(dry run — nothing written. Re-run with --write to apply.)');
    return;
  }
  const { error: upErr } = await supabase.from('books').update(patch).eq('id', book.id);
  if (upErr) { console.error(`\nWRITE FAILED: ${upErr.message}`); process.exit(1); }
  console.log(`\n✓ updated ${book.id} — marked verified, so no automated pass will overwrite it.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
