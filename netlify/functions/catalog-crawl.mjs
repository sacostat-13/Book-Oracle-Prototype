// catalog-crawl — scheduled top-up of the shared `books` catalog.
//
// The Stacks reads `books` directly. Two things fill that table:
//
//   1. Reader imports (passive, free, already live). Every Goodreads import
//      upserts unseen titles, so the catalog compounds as people join. This is
//      the main engine and needs no code here.
//   2. This crawl (active, deliberate). Imports reflect what our readers
//      already own, which skews toward whatever the early cohort happens to
//      like. This pulls in well-known books nobody has imported yet, so a
//      reader browsing a genre we're thin on doesn't hit a wall.
//
// Schedule is declared in the exported `config` at the bottom of this file
// (no netlify.toml entry needed). Deliberately small per run: ~50 books
// an hour is ~1,200/day, which grows a 2,500-book catalog meaningfully within a
// week without hammering Hardcover or ballooning the table with junk.
//
// Requires: HARDCOVER_API_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// v0.59

// NOTE — deliberately no `@supabase/supabase-js` here.
//
// createClient() constructs a RealtimeClient in its constructor, which needs a
// WebSocket. Netlify runs Node 20, which has no native WebSocket, so the client
// threw before this job ever reached Hardcover:
//
//   "Node.js 20 detected without native WebSocket support"
//
// Passing `ws` as a realtime transport would work, but pulling a websocket
// stack into a function that only makes one RPC call is the wrong shape. We
// call PostgREST over plain fetch instead: no client, no realtime, no bundle.
//
// (The browser build still uses supabase-js — browsers have WebSocket.)

const HARDCOVER_URL = 'https://api.hardcover.app/v1/graphql';
const PER_GENRE = 25;
const MIN_RATINGS = 500;   // filters out obscure/duplicate editions
const MIN_RATING = 3.6;    // keeps the wall worth browsing

// Per-genre floor on `users_read_count` (v0.60).
//
// A single global MIN_RATINGS of 500 is the reason the crawl stopped adding
// anything. It was tuned for genres like Literary Fiction, where thousands of
// books clear 500 readers. It is far above the entire population of a niche
// tag: "Folk Horror" run at 500 returns nothing at all, at any offset — which
// is exactly what `Folk Horror@0:0` in the logs means. Zero rows at offset 0
// is not a paging problem, and no amount of offset walking fixes it.
//
// So the bar moves with the genre. Broad genres keep the high floor that keeps
// the wall respectable; narrow ones drop low enough that their real catalog is
// reachable. A niche book with 60 readers is still a good recommendation to
// someone browsing a Folk Horror shelf — it is only "obscure" relative to
// bestsellers it was never competing with.
const NICHE = { minRatings: 50,  minRating: 3.5 };
const MID   = { minRatings: 150, minRating: 3.5 };
const BROAD = { minRatings: MIN_RATINGS, minRating: MIN_RATING };

// The 15 canonical genres (schema_v7 seeds) mapped onto the tags Hardcover
// actually carries.
//
// This mapping is the whole point of the job. The Books Oracle's taxonomy is
// deliberately specific — "Folk Horror", "Sapphic & Feminist Gothic",
// "Southern & American Gothic" — while Hardcover's tags are broad. Crawling
// Hardcover's generic genres directly would fill the catalog with mainstream
// bestsellers that map to none of our genres, can never be genre-seeded, and
// don't belong on a dark-academia shelf.
//
// `canonical` is written to books.genre so The Stacks can seed on it.
// `tags` are what we ask Hardcover for.
const GENRE_MAP = [
  { canonical: 'Epic & Dark Fantasy',              tags: ['Dark Fantasy', 'Epic Fantasy'],                 ...BROAD },
  { canonical: 'Sci-Fi & Speculative',             tags: ['Science Fiction', 'Speculative Fiction'],        ...BROAD },
  { canonical: 'Literary Fiction',                 tags: ['Literary Fiction'],                              ...BROAD },
  { canonical: 'Gothic & Haunted Houses',          tags: ['Gothic', 'Haunted House'],                       ...MID },
  { canonical: 'Classic & Older Gothic',           tags: ['Gothic Fiction', 'Classics'],                    ...BROAD },
  { canonical: 'Southern & American Gothic',       tags: ['Southern Gothic'],                               ...NICHE },
  { canonical: 'Folk Horror',                      tags: ['Folk Horror'],                                   ...NICHE },
  { canonical: 'Body Horror & Transgressive',      tags: ['Body Horror', 'Transgressive Fiction'],          ...NICHE },
  { canonical: 'Vampires',                         tags: ['Vampires'],                                      ...MID },
  { canonical: 'Witches',                          tags: ['Witches', 'Witchcraft'],                         ...MID },
  { canonical: 'Cozy Fantasy',                     tags: ['Cozy Fantasy'],                                  ...NICHE },
  { canonical: 'Sapphic & Feminist Gothic',        tags: ['Sapphic', 'Feminist'],                           ...NICHE },
  { canonical: 'Korean, Japanese & East Asian Lit', tags: ['Japanese Literature', 'Korean Literature'],     ...MID },
  { canonical: 'Latin American Horror & Literary', tags: ['Latin American Literature'],                     ...NICHE },
  { canonical: 'Parenting & Motherhood',           tags: ['Parenting', 'Motherhood'],                       ...MID },
];

const QUERY = `
  query TopBooks($tag: String!, $limit: Int!, $offset: Int!, $minRatings: Int!, $minRating: numeric!) {
    books(
      where: {
        cached_tags: { _contains: { Genre: [{ tag: $tag }] } }
        users_read_count: { _gte: $minRatings }
        rating: { _gte: $minRating }
      }
      order_by: { users_read_count: desc }
      limit: $limit
      offset: $offset
    ) {
      id
      title
      pages
      description
      release_year
      rating
      image { url }
      contributions(limit: 1) { author { name } }
    }
  }
`;

async function hardcover(token, variables) {
  const res = await fetch(HARDCOVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
    },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  if (!res.ok) throw new Error(`hardcover ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || 'graphql error');
  return json.data?.books || [];
}

// Calls a Postgres function through PostgREST. Both headers are required —
// `apikey` authenticates the project, `Authorization` carries the role. Missing
// either gives "No API key found in request".
async function callRpc(url, key, fn, args) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      // upsert_book returns a uuid; we don't need it echoed back.
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `${res.status} ${detail.slice(0, 200)}` };
  }
  return { error: null };
}

// Which genres this run handles. Rotating by hour means every genre is visited
// at least once a day without any stored cursor.
function genresForRun() {
  const hour = new Date().getUTCHours();
  const i = hour % GENRE_MAP.length;
  return [GENRE_MAP[i], GENRE_MAP[(i + 1) % GENRE_MAP.length]];
}

// How deep into each genre's ranking to read.
//
// Without an offset the job asked for "top 25 by readers" every single time, so
// it pulled the SAME 25 books on every run forever — upsert_book deduped them
// and the catalog flatlined while the logs still reported success.
//
// Advances every hour rather than every day: two genres per run and one run per
// hour means a genre gets revisited within the same day, and a day-scoped
// offset handed it the identical page both times.
const MAX_DEPTH = 1000;

function offsetForRun() {
  const hoursSinceEpoch = Math.floor(Date.now() / 3600000);
  return (hoursSinceEpoch * PER_GENRE) % MAX_DEPTH;
}

// Fetch one tag, walking the offset back if it lands past the end of the set.
//
// Genres are not the same size. "Literary Fiction" past the ≥500-reader bar has
// thousands of qualifying books; "Folk Horror" or "Cozy Fantasy" may have a
// couple of hundred. A single shared offset therefore overshoots the narrow
// genres and returns nothing — which is exactly the `upserted=0 skipped=0`
// result observed at offset 775 on Gothic.
//
// Halving down to zero costs at most a few extra queries and guarantees the
// deep genres keep advancing while the shallow ones keep returning their head.
async function fetchTag(token, tag, offset, bar) {
  const { minRatings, minRating } = bar;
  let attempt = offset;
  for (let i = 0; i < 4; i++) {
    const rows = await hardcover(token, {
      tag,
      limit: PER_GENRE,
      offset: attempt,
      minRatings,
      minRating,
    });
    if (rows.length > 0) return { rows, usedOffset: attempt, dead: false };
    // Zero rows at offset 0 means the tag itself yields nothing at this bar —
    // either the tag name isn't in Hardcover's vocabulary, or no book carrying
    // it clears minRatings. Either way, walking the offset can't help.
    if (attempt === 0) return { rows: [], usedOffset: 0, dead: true };
    attempt = Math.floor(attempt / 2);
    await new Promise((r) => setTimeout(r, 250));
  }
  const rows = await hardcover(token, {
    tag,
    limit: PER_GENRE,
    offset: 0,
    minRatings,
    minRating,
  });
  return { rows, usedOffset: 0, dead: rows.length === 0 };
}

export default async function handler() {
  const token = process.env.HARDCOVER_API_TOKEN;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!token || !url || !key) {
    return new Response(JSON.stringify({ error: 'missing env' }), { status: 500 });
  }

  const genres = genresForRun();
  const offset = offsetForRun();
  let inserted = 0;
  let skipped = 0;

  for (const entry of genres) {
    const genre = entry.canonical;

    // A canonical genre can draw from more than one Hardcover tag. Results are
    // merged and deduped by Hardcover id before writing.
    const byId = new Map();
    const tagDepths = [];
    for (const tag of entry.tags) {
      try {
        const bar = { minRatings: entry.minRatings, minRating: entry.minRating };
        const { rows, usedOffset, dead } = await fetchTag(token, tag, offset, bar);
        if (dead) {
          // Loud on purpose. A dead tag is a silent catalog leak: the run still
          // reports success while contributing nothing, which is how the crawl
          // flatlined without anyone noticing. If this repeats for the same tag
          // across runs, either the name is wrong or its bar is still too high.
          console.warn(
            `[catalog-crawl] DEAD TAG "${tag}" — 0 rows at offset 0 with ` +
            `minRatings=${bar.minRatings} minRating=${bar.minRating}`
          );
        }
        for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
        // Logged per tag: a tag that consistently reports usedOffset=0 is a
        // shallow one, and a tag that returns 0 rows even at offset 0 almost
        // certainly doesn't exist in Hardcover's vocabulary and should be
        // pruned from GENRE_MAP.
        tagDepths.push(`${tag}@${usedOffset}:${rows.length}≥${bar.minRatings}`);
      } catch (e) {
        console.error(`[catalog-crawl] tag "${tag}" failed:`, e.message);
        tagDepths.push(`${tag}:ERR`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    console.log(`[catalog-crawl] ${genre} → ${tagDepths.join(', ')}`);
    const rows = [...byId.values()].slice(0, PER_GENRE);

    for (const b of rows) {
      // Strip the series parenthetical before writing.
      //
      // upsert_book dedupes on normalized_key, which is built from the title —
      // so "Howl's Moving Castle (Howl's Moving Castle, #1)" and
      // "Howl's Moving Castle" become two rows for one book. That accounts for
      // most of the duplicates in the catalog audit, and Hardcover titles carry
      // these suffixes routinely. Same rule the Goodreads import applies.
      const title = (b.title || '')
        .replace(/\s*\([^()]*#[^()]*\)\s*$/, '')
        .trim();
      // First credited author only, matching dedupe_author_key in schema_v47.
      // Hardcover credits the full team where Goodreads gives one name, and the
      // difference alone was enough to create a second row.
      const author = (b.contributions?.[0]?.author?.name || '')
        .split(/\s+(?:y|and|with|&|\/|;)\s+/i)[0]
        .trim();
      const cover = b.image?.url || null;

      // A book with no author or no cover is useless to The Stacks — the whole
      // surface is a wall of covers. Don't pollute the table with rows that
      // can never be shown.
      if (!title || !author || !cover) { skipped++; continue; }

      // upsert_book is the only write path into `books` (no direct
      // insert/update RLS policies exist), and it dedupes on normalized_key,
      // so re-crawling the same genre is a no-op rather than a duplicate.
      const { error } = await callRpc(url, key, 'upsert_book', {
        _title: title,
        _author: author,
        _hardcover_id: b.id || null,
        _pages: b.pages || null,
        _description: b.description || null,
        _cover_url: cover,
        // Canonical genre, not the Hardcover tag — this is what The Stacks
        // seeds on, and what the Oracle taxonomy expects.
        _genre: genre,
        _source: 'hardcover',
        // Unreviewed is honest: nobody has checked these. The Stacks shows
        // them anyway (it excludes only `flagged`), because the point is
        // giving readers something to browse. Categorisation happens when a
        // book reaches someone's Library or Wishlist.
        _status: 'unreviewed',
        _metadata: { crawledAt: new Date().toISOString(), crawlGenre: genre },
      });

      if (error) {
        // Argument-name drift is the likely failure here — log once per row rather
        // than aborting the whole run.
        // `error` is a string here (status + body), not a supabase error object.
        console.error('[catalog-crawl] upsert_book failed:', error);
        skipped++;
      } else {
        inserted++;
      }
    }

    // Be a good citizen between genres.
    await new Promise((r) => setTimeout(r, 1000));
  }

  const names = genres.map((g) => g.canonical);
  // `upserted` is deliberately not called "inserted": upsert_book dedupes on
  // normalized_key, so a successful call may have updated an existing row
  // rather than added one. Re-running a genre at the same offset will report
  // the same number while adding nothing. To see real growth, compare
  // `select count(*) from books` before and after, not this line.
  console.log(
    `[catalog-crawl] genres=${names.join(', ')} offset=${offset} upserted=${inserted} skipped=${skipped}`
  );
  return new Response(JSON.stringify({ genres: names, offset, upserted: inserted, skipped }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const config = {
  // Hourly. Two genres per run, 25 books each.
  schedule: '@hourly',
};

// ─────────────────────────────────────────────────────────────────────────────
// Crawled books ARE browsable immediately.
//
// They land as `unreviewed`, and The Stacks excludes only `flagged` — so they
// show up on the wall as soon as this job writes them. The quality bar that
// matters here is the crawl filter (≥500 readers, ≥3.6 rating, must have an
// author and a cover), not the review status.
//
// Oracle categorisation is not a gate on browsing; it happens later, once a
// book has actually reached someone's Library or Wishlist and is worth the
// call. `books.genre` carries the canonical genre from GENRE_MAP in the
// meantime, which is enough for The Stacks to seed on.
//
// Tag verification: the narrower tags above ('Folk Horror', 'Sapphic',
// 'Motherhood') may not exist in Hardcover's vocabulary. A missing tag logs
// and is skipped, so the job degrades rather than failing — but check the
// logs after the first few runs and prune any tag that never returns rows.
// ─────────────────────────────────────────────────────────────────────────────
