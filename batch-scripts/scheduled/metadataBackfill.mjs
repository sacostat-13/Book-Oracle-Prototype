// metadataBackfill.mjs — v1
//
// Fills books.description and books.genre from free APIs. Never calls Claude.
//
// WHY THIS EXISTS
//
// 682 books have a cover but no description, so The Stacks flips them over to
// "Description not available". The obvious fix — point curateManualBooks or
// oracleBatch at them — bills Anthropic for text that Hardcover, Open Library
// and Google Books all hand out for nothing. Worse, a model can invent a plot
// summary; those three cannot.
//
// The rule this script encodes: Claude is for judgment, not retrieval. A
// description is a fact somebody has already written down. Recommendations,
// reading plans and memory synthesis are not. Spend the budget there.
//
// Descriptions and genres are backfilled together on purpose. Both are read
// out of the SAME three API responses, so doing them in one pass costs one set
// of requests instead of two. The `--target` flag still lets you run either
// alone.
//
// GENRE INFERENCE
//
// books.genre uses a bespoke 15-genre taxonomy ("Gothic & Haunted Houses"),
// so no API returns it directly — which is what made this look like a job for
// a model. It isn't. All three sources return raw subject/tag lists, and a
// keyword table maps those onto the canonical names deterministically. Books
// matching no rule are left null and written to genre-unmatched.csv rather
// than guessed at. Leaving a genre null costs a book nothing since v0.60 of
// useStacks: it is still fully browsable, just not genre-seeded.
//
// Usage:
//   node batch-scripts/metadataBackfill.mjs
//   node batch-scripts/metadataBackfill.mjs --target description
//   node batch-scripts/metadataBackfill.mjs --target genre
//   node batch-scripts/metadataBackfill.mjs --dry-run --verbose --limit 20
//
// Required in .env.local:
//   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   HARDCOVER_API_TOKEN  (optional — the other two sources still work without)
//   GOOGLE_BOOKS_API_KEY (optional — Google Books allows anonymous use, rate-limited)

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// -- CLI args -----------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

function argValue(name, fallback) {
  const a = args.find((x) => x.startsWith(name));
  if (!a) return fallback;
  return a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1];
}

const TARGET = (argValue('--target', 'both') || 'both').toLowerCase();
if (!['description', 'genre', 'both'].includes(TARGET)) {
  console.error(`Unknown --target "${TARGET}". Use description, genre or both.`);
  process.exit(1);
}
const WANT_DESC = TARGET === 'description' || TARGET === 'both';
const WANT_GENRE = TARGET === 'genre' || TARGET === 'both';

const LIMIT = Number.parseInt(argValue('--limit', ''), 10) || null;
const DELAY_MS = Number.parseInt(argValue('--delay', ''), 10) || 400;

// Below this, a "description" is a stub — a single line of catalog boilerplate
// rather than anything worth flipping a card to read.
const MIN_DESCRIPTION_CHARS = 40;

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
const HARDCOVER_TOKEN = env['HARDCOVER_API_TOKEN'] || env['VITE_HARDCOVER_TOKEN'] || '';
const GOOGLE_KEY = env['GOOGLE_BOOKS_API_KEY'] || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// -- Helpers ------------------------------------------------------------------
function cleanTitle(t) {
  return (t || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s*\/.*$/, '')
    .trim();
}

function cleanAuthor(a) {
  return (a || '').split(/[,&]|\sand\s/i)[0].trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (msg) => { if (VERBOSE) process.stdout.write('    ' + msg + '\n'); };

// Descriptions arrive as HTML from some sources and as Open Library's
// {type, value} record from others. Normalise to plain text, and reject the
// boilerplate that is worse than showing nothing.
function normaliseDescription(raw) {
  let text = raw;
  if (!text) return null;
  if (typeof text === 'object') text = text.value || '';
  if (typeof text !== 'string') return null;

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Open Library descriptions often end with a source credit line.
    .replace(/\(\s*source:.*?\)\s*$/is, '')
    .replace(/^\s*\[?source:.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length < MIN_DESCRIPTION_CHARS) return null;
  // Publisher filler that says nothing about the book.
  if (/^(no description|description not available|n\/?a)\b/i.test(text)) return null;
  return text;
}

// ── Genre inference ──────────────────────────────────────────────────────────
//
// Ordered most-specific first and evaluated in order, because the general rules
// would otherwise swallow the specific ones: "southern gothic" contains
// "gothic", "dark fantasy" contains "fantasy". First match wins.
//
// Every pattern here is deliberately narrow. A rule that fires on a single
// common word ("horror", "fantasy") would mislabel far more than it fixes, and
// a wrong genre is worse than no genre — it puts a book in front of exactly the
// reader who didn't ask for it. Books matching nothing go to the CSV.
// Weights. A specific genre matching once should beat a broad one matching
// once — "folk horror" is far stronger evidence than "fiction".
const SPECIFIC = 3;   // a named subgenre; almost never a coincidence
const MID = 2;        // a real genre, but with overlap
const BROAD = 1;      // umbrella terms that appear on half the catalog

// Rules now cover the whole of public.genres worth inferring, not just the 15
// the crawl writes (v0.60.3).
//
// The first version only knew the crawl's canonical names, which is why the dry
// run left so much on the floor: "Comics & Graphic Novels" matched nothing
// because there was no Graphic Novel rule, and The Odyssey matched nothing
// because there was no Classics rule — even though both genres exist in
// public.genres with hundreds of books already filed under them.
//
// Order no longer decides the outcome (see inferGenre) — weight does.
const GENRE_RULES = [
  // ── Specific subgenres ───────────────────────────────────────────────────
  ['Southern & American Gothic',  /southern gothic/i,                                                        SPECIFIC],
  ['Folk Horror',                 /folk horror|folklore horror|rural horror/i,                               SPECIFIC],
  ['Body Horror & Transgressive', /body horror|transgressive fiction|splatterpunk/i,                         SPECIFIC],
  ['Feminist & Sapphic Gothic',   /sapphic|lesbian fiction|feminist gothic|queer gothic/i,                   SPECIFIC],
  ['Cozy Fantasy',                /coz[yi]e? fantasy|cosy fantasy|low[- ]stakes fantasy/i,                   SPECIFIC],
  ['Vampires',                    /vampire/i,                                                                SPECIFIC],
  ['Witches',                     /witch(es|craft)?\b/i,                                                     SPECIFIC],
  ['Zombies',                     /zombie|undead/i,                                                          SPECIFIC],
  ['Slasher',                     /slasher|final girl/i,                                                     SPECIFIC],
  ['Cyberpunk',                   /cyberpunk/i,                                                              SPECIFIC],
  ['Arthurian',                   /arthurian|king arthur|camelot|holy grail/i,                               SPECIFIC],
  ['Martial Arts',                /martial arts|wuxia|samurai|kung fu/i,                                     SPECIFIC],
  ['Epic Poetry',                 /epic poetry|epic poem/i,                                                  SPECIFIC],
  ['Fairy Tale Retelling',        /fairy tale|fairy tales|retelling/i,                                       SPECIFIC],
  ['Magical Realism',             /magical realism|latin american|colombian fiction|argentine literature/i,  SPECIFIC],
  ['Superhero Epic',              /superhero/i,                                                              SPECIFIC],
  ['Japanese & East Asian Horror',/japanese horror|j-horror|korean horror/i,                                 SPECIFIC],
  ['East Asian Literary Fiction', /japanese (literature|fiction)|korean (literature|fiction)|chinese (literature|fiction)|east asian literature/i, SPECIFIC],
  ['Parenting & Motherhood',      /parenting|motherhood|mothers and daughters|new mothers/i,                 SPECIFIC],
  ['Mythological Fantasy',        /mythology|greek myth|norse myth|egyptian myth/i,                          SPECIFIC],
  ['Children\'s Picture Book',    /picture book/i,                                                           SPECIFIC],
  ['Smutty Corner',               /erotica|erotic fiction/i,                                                 SPECIFIC],

  // ── Real genres with some overlap ────────────────────────────────────────
  ['Classic & Older Gothic',      /classic gothic|victorian gothic|gothic revival/i,                         MID],
  ['Gothic & Haunted Houses',     /gothic|haunted house|haunted houses|ghost stor(y|ies)/i,                   MID],
  ['Dark & Epic Fantasy',         /dark fantasy|epic fantasy|high fantasy|grimdark|sword and sorcery|fantasy[ ,\/-]+epic/i, MID],
  ['Historical Fantasy',          /historical fantasy/i,                                                     MID],
  ['Fantasy Romance',             /fantasy romance|romantasy|paranormal romance/i,                           MID],
  ['Historical Romance',          /historical romance|regency romance/i,                                     MID],
  ['LGBTQ+ Romance',              /lgbt|queer romance|gay romance|m\/m romance/i,                            MID],
  ['Graphic Novel',               /graphic novel|comic book|comics|manga|sequential art/i,                    MID],
  ['Mystery',                     /mystery|detective|whodunit|amateur sleuth|crime fiction/i,                MID],
  ['Psychological Fiction',       /psychological (fiction|thriller|suspense)|unreliable narrator/i,          MID],
  ['Philosophical Fiction',       /philosophical fiction|existential/i,                                      MID],
  ['Experimental & Avant-Garde',  /experimental fiction|avant-garde|postmodern/i,                            MID],
  ['Coming of Age',               /coming of age|bildungsroman/i,                                            MID],
  ['Historical Fiction',          /historical fiction|historical novel/i,                                    MID],
  ['Biography',                   /biography|autobiography|memoir|personal memoirs/i,                        MID],
  ['Comedy & Wit',                /humor|humour|comedy|satire|comic novel/i,                                 MID],
  ['Social Commentary',           /social commentary|social problem|social science/i,                        MID],
  ['International Fiction',       /translations into english|african literature|russian literature|german literature|french fiction|indian fiction/i, MID],
  ['Intimate Fiction',            /sexuality|desire|sensual/i,                                               MID],

  // ── Umbrellas. Only win when nothing sharper matched. ────────────────────
  // 'translations' removed in v0.60.3: a translated book is not a classic, and
  // Open Library tags translations heavily. It was quietly scoring on every
  // work that had ever been published in another language.
  ['Classics',                    /classics|classic literature|classic fiction|early works to 1800/i,       BROAD],
  ['Horror',                      /horror/i,                                                                 BROAD],
  ['Fantasy',                     /fantasy/i,                                                                BROAD],
  ['Sci-Fi & Speculative',        /science fiction|speculative fiction|dystopia|space opera|time travel/i,   BROAD],
  ['Romance',                     /romance|love stor(y|ies)/i,                                               BROAD],
  ['Literary Fiction',            /literary fiction|literary collections/i,                                  BROAD],
  // Anchored, and deliberately narrow.
  //
  // This rule previously matched bare `history`, `psychology` and `philosophy`
  // anywhere in a subject, which is close to catastrophic on Open Library data
  // — it tags literary criticism with exactly those words. "The Importance of
  // Being Earnest" was assigned Non-Fiction on the strength of "Identity
  // (Psychology)" and "History and criticism", and every classic carrying
  // "History and criticism" would have gone the same way.
  //
  // Rules are tested per-subject, not against a joined blob, so anchoring with
  // ^...$ means "the subject IS Psychology", not "the subject mentions
  // psychology somewhere". That keeps a genuine non-fiction tag working while
  // dropping the criticism metadata.
  ['Non-Fiction',                 /\bnon-?fiction\b|self-help|true crime|popular science|^(psychology|history|philosophy|economics|sociology)$/i, BROAD],
  ['Contemporary Fiction',        /contemporary fiction|contemporary/i,                                      BROAD],
];

// Minimum score before a genre is assigned at all. One BROAD hit deep in a long
// subject list scores 1 and is not enough — that is how "Fiction" alone used to
// drag books into a genre they had no business in.
const MIN_GENRE_SCORE = 3;

// Scored, not first-match-wins (v0.60.3).
//
// The old version joined every subject into one blob and returned the first
// rule that matched anywhere in it. Two things went wrong with that.
//
// Open Library returns long lists — 30+ subjects is normal — so almost any book
// eventually matched something, and what it matched was decided by RULE ORDER
// rather than by fit. A single incidental subject buried at position 24 could
// outrank the six subjects at the top that all said something else.
//
// And because order decided everything, a broad rule sitting above a specific
// one silently stole its books.
//
// Now every subject is tested against every rule and the genre with the highest
// total wins. Two things carry weight: how specific the rule is, and how near
// the top of the list the subject appeared — Open Library orders roughly by
// prominence, so early subjects are better evidence. A genre needs to clear
// MIN_GENRE_SCORE to be assigned at all, so weak single hits still yield null
// and the book goes to genre-unmatched.csv instead of being mislabelled.
// Shared by inferGenre and explainGenre so the explanation can never drift from
// the decision.
//
// Ties are common and were previously broken by Map insertion order, i.e. by
// where the rule happened to sit in the array — Poe scored Horror=12 and
// Mystery=12, Spinning Silver scored Fairy Tale Retelling=9 and Mythological
// Fantasy=9. Now: highest score, then the more specific rule, then whichever
// matched nearer the top of the subject list. Fully determined, and by
// something meaningful rather than by array position.
function rankGenres(subjects) {
  const acc = new Map();
  subjects.forEach((subject, i) => {
    const positionWeight = i < 6 ? 3 : i < 15 ? 2 : 1;
    const low = String(subject).toLowerCase();
    for (const [genre, pattern, specificity] of GENRE_RULES) {
      if (!pattern.test(low)) continue;
      const prev = acc.get(genre) || { score: 0, spec: 0, firstPos: Infinity, hits: [] };
      prev.score += positionWeight * specificity;
      prev.spec = Math.max(prev.spec, specificity);
      prev.firstPos = Math.min(prev.firstPos, i);
      if (prev.hits.length < 3) prev.hits.push(subject);
      acc.set(genre, prev);
    }
  });

  // Tie-break order matters and is not obvious.
  //
  // Position first, specificity second. Ranking by specificity first looked
  // principled and was wrong on real data: Poe scored Horror=12 and Mystery=12,
  // and "more specific rule wins" handed it to Mystery even though the very
  // first subject was "American Horror tales". Open Library orders subjects
  // roughly by prominence, so the genre that appears EARLIEST is the better
  // signal of what the book actually is.
  return [...acc.entries()].sort((a, b) =>
    b[1].score - a[1].score ||
    a[1].firstPos - b[1].firstPos ||
    b[1].spec - a[1].spec ||
    a[0].localeCompare(b[0])
  );
}

function inferGenre(subjects) {
  if (!subjects || subjects.length === 0) return null;
  const ranked = rankGenres(subjects);
  if (ranked.length === 0) return null;
  const [genre, { score }] = ranked[0];
  return score >= MIN_GENRE_SCORE ? genre : null;
}

// Used by --verbose so a surprising assignment can be understood without
// re-deriving it by hand.
function explainGenre(subjects) {
  return rankGenres(subjects)
    .slice(0, 3)
    .map(([g, v]) => `${g}=${v.score} (${v.hits.join('; ')})`);
}

// ── Source 1: Hardcover ──────────────────────────────────────────────────────
// Best source by a distance: it is where the crawl already gets descriptions,
// so its coverage of this catalog is high and its text is already the house
// style. cached_tags carries the Genre list too.
const HARDCOVER_URL = 'https://api.hardcover.app/v1/graphql';

const HC_QUERY = `
  query FindBook($title: String!) {
    books(
      where: { title: { _ilike: $title } }
      order_by: { users_read_count: desc }
      limit: 5
    ) {
      title
      description
      cached_tags
      contributions(limit: 1) { author { name } }
    }
  }
`;

async function tryHardcover(title, author) {
  if (!HARDCOVER_TOKEN) return { description: null, subjects: [] };
  try {
    const res = await fetch(HARDCOVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: HARDCOVER_TOKEN.startsWith('Bearer ')
          ? HARDCOVER_TOKEN
          : `Bearer ${HARDCOVER_TOKEN}`,
      },
      body: JSON.stringify({ query: HC_QUERY, variables: { title: cleanTitle(title) } }),
    });
    if (!res.ok) return { description: null, subjects: [] };
    const json = await res.json();
    const rows = json.data?.books || [];
    if (rows.length === 0) return { description: null, subjects: [] };

    // Match the author when we can. Hardcover title search is fuzzy enough that
    // taking row[0] blindly attaches the wrong book's blurb — the single worst
    // failure mode available to this script, because it looks like success.
    const wanted = cleanAuthor(author).toLowerCase();
    const hit = rows.find((r) => {
      const got = (r.contributions?.[0]?.author?.name || '').toLowerCase();
      return wanted && got && (got.includes(wanted) || wanted.includes(got));
    });
    if (!hit) {
      vlog(`hardcover: ${rows.length} title match(es), none by "${author}" — skipping`);
      return { description: null, subjects: [] };
    }

    const tags = hit.cached_tags?.Genre || [];
    const subjects = tags.map((t) => t?.tag).filter(Boolean);
    return { description: hit.description || null, subjects };
  } catch (e) {
    vlog(`hardcover error: ${e.message}`);
    return { description: null, subjects: [] };
  }
}

// ── Source 2: Open Library ───────────────────────────────────────────────────
// Two calls: search gives the work key and subjects, the work record gives the
// description. Subjects here are the richest of the three — Open Library tags
// heavily, which is exactly what the genre rules want.
async function tryOpenLibrary(title, author) {
  try {
    const q = 'title=' + encodeURIComponent(cleanTitle(title)) +
      '&author=' + encodeURIComponent(cleanAuthor(author)) +
      '&fields=key,subject&limit=1';
    const res = await fetch('https://openlibrary.org/search.json?' + q);
    if (!res.ok) return { description: null, subjects: [] };
    const data = await res.json();
    const doc = data.docs?.[0];
    if (!doc) return { description: null, subjects: [] };

    const subjects = doc.subject || [];
    let description = null;

    if (doc.key) {
      await sleep(250);
      const wres = await fetch(`https://openlibrary.org${doc.key}.json`);
      if (wres.ok) {
        const work = await wres.json();
        description = work.description || null;
      }
    }
    return { description, subjects };
  } catch (e) {
    vlog(`openlibrary error: ${e.message}`);
    return { description: null, subjects: [] };
  }
}

// ── Source 3: Google Books ───────────────────────────────────────────────────
// Last because its categories are coarse ("Fiction", "Juvenile Fiction") and
// rarely trip a rule, but its descriptions are good and it covers books the
// other two miss.
async function tryGoogleBooks(title, author) {
  try {
    const q = `intitle:${cleanTitle(title)}+inauthor:${cleanAuthor(author)}`;
    const url = 'https://www.googleapis.com/books/v1/volumes?q=' +
      encodeURIComponent(q) + '&maxResults=1' +
      (GOOGLE_KEY ? `&key=${GOOGLE_KEY}` : '');
    const res = await fetch(url);
    if (!res.ok) return { description: null, subjects: [] };
    const data = await res.json();
    const info = data.items?.[0]?.volumeInfo;
    if (!info) return { description: null, subjects: [] };
    return { description: info.description || null, subjects: info.categories || [] };
  } catch (e) {
    vlog(`googlebooks error: ${e.message}`);
    return { description: null, subjects: [] };
  }
}

// ── The chain ────────────────────────────────────────────────────────────────
// Walks all three sources rather than stopping at the first description,
// because subjects accumulate: Hardcover may answer the description while Open
// Library is the one carrying "southern gothic". Stops early only when both
// wanted fields are settled, so a description-only run stays cheap.
async function fetchMetadata(book, needDesc, needGenre) {
  const sources = [
    ['hardcover', tryHardcover],
    ['openlibrary', tryOpenLibrary],
    ['googlebooks', tryGoogleBooks],
  ];

  let description = null;
  let descriptionFrom = null;
  const subjects = [];

  for (const [name, fn] of sources) {
    if ((!needDesc || description) && (!needGenre || subjects.length > 0)) break;

    const got = await fn(book.title, book.author);
    if (needDesc && !description) {
      const clean = normaliseDescription(got.description);
      if (clean) {
        description = clean;
        descriptionFrom = name;
        vlog(`description from ${name} (${clean.length} chars)`);
      }
    }
    if (needGenre && got.subjects.length) {
      subjects.push(...got.subjects);
      // Log ALL of them, with the count.
      //
      // This used to print `.slice(0, 6)` with no indication there was more,
      // which made the dry run actively misleading: Open Library routinely
      // returns 30+ subjects, so a genre would be assigned on evidence that
      // never appeared in the output. "Old Man and the Sea → East Asian
      // Literary Fiction" looked inexplicable until you could see subject 24.
      // A diagnostic that hides the deciding input is worse than none.
      vlog(`${name} subjects (${got.subjects.length}): ${got.subjects.join(', ')}`);
    }
    await sleep(DELAY_MS);
  }

  return { description, descriptionFrom, subjects };
}

// Every genre this script can assign must exist in public.genres.
//
// The taxonomy is not fixed: Oracle categorisation creates genres on demand, so
// public.genres drifts relative to the hardcoded names in GENRE_RULES. If a
// rule target is missing from that table, this script will happily stamp it
// onto books.genre and the result is invisible — the genre picker only offers
// names from public.genres, so no reader can ever select it and none of those
// books can be genre-seeded.
//
// Checked before any writes. Reported, not enforced: a stale rule should not
// stop descriptions being backfilled, which is the larger half of this job.
async function warnOnGenreDrift() {
  const { data, error } = await supabase.from('genres').select('name');
  if (error) {
    console.warn('[metadataBackfill] could not verify genres table:', error.message);
    return;
  }
  const known = new Set((data || []).map((r) => r.name));
  const missing = [...new Set(GENRE_RULES.map(([name]) => name))].filter((n) => !known.has(n));
  if (missing.length) {
    console.warn(
      `\n[metadataBackfill] GENRE DRIFT — ${missing.length} rule target(s) absent from ` +
      `public.genres:\n  ${missing.join('\n  ')}\n` +
      `Books assigned these are unreachable by genre seeding. Fix GENRE_RULES, or add ` +
      `the rows to public.genres.\n`
    );
  }
}

// -- Main ---------------------------------------------------------------------
async function main() {
  console.log(
    `[metadataBackfill] target=${TARGET} dryRun=${DRY_RUN} ` +
    `limit=${LIMIT ?? 'none'} hardcover=${HARDCOVER_TOKEN ? 'yes' : 'NO'}`
  );

  if (WANT_GENRE) await warnOnGenreDrift();

  // Only books that can actually be shown. A book with no cover never reaches
  // The Stacks, so its description is not what is stopping anyone — covers are
  // coverBackfill's job and should run first.
  let query = supabase
    .from('books')
    .select('id, title, author, description, genre')
    .not('cover_url', 'is', null)
    .neq('status', 'flagged')
    .order('created_at', { ascending: true });

  if (LIMIT) query = query.limit(LIMIT * 4); // overshoot: many rows won't need work

  const { data: rows, error } = await query;
  if (error) {
    console.error('[metadataBackfill] query failed:', error.message);
    process.exit(1);
  }

  const needsWork = (rows || []).filter((b) => {
    const missingDesc = !b.description || b.description.trim().length < MIN_DESCRIPTION_CHARS;
    const missingGenre = !b.genre || b.genre === 'Imported' || b.genre === 'Uncategorized';
    return (WANT_DESC && missingDesc) || (WANT_GENRE && missingGenre);
  }).slice(0, LIMIT || undefined);

  console.log(`[metadataBackfill] ${needsWork.length} book(s) to process\n`);

  let descFilled = 0;
  let genreFilled = 0;
  let untouched = 0;
  const unmatched = [];

  for (let i = 0; i < needsWork.length; i++) {
    const book = needsWork[i];
    const needDesc = WANT_DESC &&
      (!book.description || book.description.trim().length < MIN_DESCRIPTION_CHARS);
    const needGenre = WANT_GENRE &&
      (!book.genre || book.genre === 'Imported' || book.genre === 'Uncategorized');

    process.stdout.write(
      `[${i + 1}/${needsWork.length}] ${book.title} — ${book.author || 'unknown'}\n`
    );

    const { description, descriptionFrom, subjects } =
      await fetchMetadata(book, needDesc, needGenre);

    const patch = {};
    if (needDesc && description) patch.description = description;

    let genre = null;
    if (needGenre) {
      genre = inferGenre(subjects);
      if (subjects.length) vlog(`genre scores: ${explainGenre(subjects).join(' | ') || '(no rule matched)'}`);
      if (genre) {
        patch.genre = genre;
      } else if (subjects.length) {
        unmatched.push({ id: book.id, title: book.title, author: book.author, subjects });
      }
    }

    if (Object.keys(patch).length === 0) {
      untouched++;
      process.stdout.write('    nothing found\n');
      continue;
    }

    if (DRY_RUN) {
      process.stdout.write(
        `    WOULD SET ${Object.keys(patch).join(', ')}` +
        `${patch.genre ? ` (genre=${patch.genre})` : ''}` +
        `${descriptionFrom ? ` (desc from ${descriptionFrom})` : ''}\n`
      );
    } else {
      const { error: upErr } = await supabase.from('books').update(patch).eq('id', book.id);
      if (upErr) {
        process.stdout.write(`    update failed: ${upErr.message}\n`);
        continue;
      }
      process.stdout.write(
        `    set ${Object.keys(patch).join(', ')}` +
        `${patch.genre ? ` (genre=${patch.genre})` : ''}\n`
      );
    }

    if (patch.description) descFilled++;
    if (patch.genre) genreFilled++;
  }

  // Books with subjects that matched no rule. This is the file to read before
  // deciding whether any Claude spend is warranted: if a theme recurs here
  // often enough to matter, the cheaper fix is a new line in GENRE_RULES.
  if (unmatched.length) {
    const csv = [
      'id,title,author,subjects',
      ...unmatched.map((u) =>
        [u.id, u.title, u.author || '', u.subjects.slice(0, 12).join('; ')]
          .map((f) => `"${String(f).replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');
    writeFileSync(join(__dirname, '..', 'output', 'genre-unmatched.csv'), csv);
  }

  console.log(
    `\n[metadataBackfill] descriptions=${descFilled} genres=${genreFilled} ` +
    `unmatchedGenre=${unmatched.length} nothingFound=${untouched}` +
    `${DRY_RUN ? ' (DRY RUN — nothing written)' : ''}`
  );
}

main().catch((e) => {
  console.error('[metadataBackfill] fatal:', e);
  process.exit(1);
});
