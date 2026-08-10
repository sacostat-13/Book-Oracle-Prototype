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
// TINY (v0.60.1) — added after the probe showed several shelves are genuinely
// small on Hardcover rather than mis-named: "southern gothic" has 4 books
// unfiltered, "Korean Literature" has 3. Any floor above single digits empties
// them. A book with 10 readers is still a fine recommendation on a shelf whose
// entire population is 4.
const TINY  = { minRatings: 10,  minRating: 3.4 };
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
//
// ── CANONICAL NAMES MUST EXIST IN public.genres (v0.60.2) ───────────────────
//
// This is not cosmetic. The chain is:
//
//   Onboarding/Profile genre picker  ← reads public.genres (52 rows)
//   profiles.favorite_genres         ← stores the picked NAME as text
//   useStacks baseQuery              → .in('genre', favoriteGenres)
//   books.genre                      ← written from `canonical` below
//
// So a canonical name that isn't in public.genres can never be selected by a
// reader, and its books can never be genre-seeded. Four names were in exactly
// that state, three of them by word order alone:
//
//   'Epic & Dark Fantasy'               → table has 'Dark & Epic Fantasy'
//   'Sapphic & Feminist Gothic'         → table has 'Feminist & Sapphic Gothic'
//   'Korean, Japanese & East Asian Lit' → table has 'East Asian Literary Fiction'
//   'Latin American Horror & Literary'  → no counterpart; now 'Magical Realism'
//
// That was 114 browsable books stranded in genres nobody could pick, and four
// pickable genres that matched no book. If you add a genre here, add the row to
// public.genres first — legacy/stacks_catalog_audit.sql block 4 checks for
// exactly this drift.
// v0.60.1 — tag strings replaced with ones the probe confirmed exist.
// (batch-scripts/probeHardcoverTags.mjs, --variants and --neighbours runs.)
//
// The probe separated two failure modes that looked identical in the logs:
//
//   NAME problem      the tag returns nothing even unfiltered — it isn't a
//                     string Hardcover uses. Casing was the usual culprit:
//                     "southern gothic", "cozy fantasy" and "sapphic" all work
//                     in lowercase and return ZERO in title case.
//   THRESHOLD problem the tag is real and populated, but no book carrying it
//                     clears minRatings. "Parenting" returns 50+ unfiltered and
//                     0 at 150 — Hardcover is fiction-centric, so parenting
//                     titles have few readers there. Fixed with the bar, below.
//
// TWO KINDS OF EXTRA TAG, and the difference is the whole rule:
//
//   SPELLING variants of the same concept — 'witches' / 'Witches',
//   'folk horror' / 'Folk Horror'. Safe to add speculatively. If the spelling
//   is dead it returns nothing and costs one query; if it is alive it can only
//   return books that genuinely belong on the shelf. Worth carrying even
//   unverified.
//
//   DIFFERENT concepts — 'Magic' for Witches, 'LGBTQ' for Sapphic, 'Horror'
//   for Body Horror. Never add without probing, and usually not even then:
//   these are broader than the shelf and quietly fill it with books that do
//   not belong.
//
// Verified dead and NOT carried: 'Witch' (0), 'Witches' (0), 'Gothic Fiction'
// (0), 'Body Horror' (0), 'Cozy Fantasy' (0), 'Sapphic' (0), 'Southern Gothic'
// (0), 'Japanese Literature' (0), 'Latin American Literature' (0). Every one is
// the "obvious" title-cased spelling; that is how this went unnoticed so long.
//
// Deliberately NOT adopted, despite returning 50+ rows each. Every one is
// broader than the shelf it would feed, and a wrong genre is worse than a
// missing one — it puts books in front of exactly the reader who didn't ask:
//   'Horror', 'Horror tales', 'Horreur', '💀 Horror'  → not Body Horror
//   'Dark', 'Psychological'                          → not Transgressive
//   'Cozy'                                           → sweeps in cozy mystery
//   'Queer', 'LGBTQ', 'LGBTQ+', 'Lgbt'               → not specifically sapphic
//   "Boy's Love"                                     → m/m; the opposite shelf
//   'Spanish', 'Spanish fiction'                     → Spain is not Latin America
//   'American literature'                            → not Southern Gothic
//   'Dark Academia'                                  → a real genre, but not ours
//
// Within each `tags` array: PROBE-CONFIRMED spellings first (row count in the
// comment where known), speculative variants last. The quota early-exit in the
// handler stops reading the list once a genre has its 25 books, so a fallback
// spelling costs a request only when the confirmed ones came up short.
const GENRE_MAP = [
  // Probed healthy: 'Epic Fantasy' and 'High Fantasy' each sustain BROAD (50/50
  // rows above 500 readers, top around 7-9k), which confirms BROAD is the right
  // tier here rather than a hopeful one. 'Fantasy - Epic' is smaller (10 rows,
  // 6 above 500) but unambiguous, so it earns a place as a late fallback.
  //
  // Bare 'Epic' is DECLINED despite being the strongest tag probed anywhere
  // (50/50 above 500, top 9875). It is a modifier, not a genre — the vocab
  // sample carries 'Epic Poetry', 'Epic; Historical' and 'Epic; Magical
  // Realism' — so it would pull Homer and historical sagas onto a fantasy
  // shelf. Same reasoning that excluded 'Dark Academia' and 'Horror'. If you
  // decide the volume is worth the noise, this is the one to reconsider first.
  { canonical: 'Dark & Epic Fantasy',              tags: ['Dark Fantasy', 'Epic Fantasy', 'High Fantasy', 'Grimdark', 'Fantasy - Epic', 'DarkFantasy'], ...BROAD },
  // Science fiction is scattered across four unrelated strings in the tag data.
  { canonical: 'Sci-Fi & Speculative',             tags: ['Science Fiction', 'Speculative Fiction', 'Sci-fi', 'science-fiction', 'speculative fiction', 'Scifi'], ...BROAD },
  { canonical: 'Literary Fiction',                 tags: ['Literary Fiction', 'Literary', 'literary fiction'], ...BROAD },
  // 'Gothic Horror' (43) is the strongest gothic tag after 'Gothic' (50).
  { canonical: 'Gothic & Haunted Houses',          tags: ['Gothic', 'Gothic Horror', 'Haunted houses', 'Ghost stories', 'Gothic novels', 'gothic horror'], ...MID },
  // 'Gothic Fiction' was dead; the parenthesised library-catalogue form is the
  // one Hardcover carries.
  { canonical: 'Classic & Older Gothic',           tags: ['Gothic fiction (Literary genre)', 'Classics', 'Victorian', 'Classic'], ...BROAD },
  // Lowercase, and genuinely tiny — 4 rows unfiltered. NICHE is still too high
  // a bar for it, hence TINY.
  { canonical: 'Southern & American Gothic',       tags: ['southern gothic', 'Southern Gothic Literature'], ...TINY },
  // 'Folklore' removed in v0.60.1: fairy tales and myth are a different concept
  // to folk horror, and it was the only DIFFERENT-concept tag that had slipped
  // into this list.
  { canonical: 'Folk Horror',                      tags: ['Folk Horror', 'folk horror', 'Folk horror'],     ...TINY },
  // 'Body horror' — sentence case. Title case and all-lowercase both return 0.
  { canonical: 'Body Horror & Transgressive',      tags: ['Body horror', 'Weird fiction', 'cosmic horror', 'body-horror', 'Weird Fiction'], ...TINY },
  // 'vampires' lowercase probed 0 and is dropped. 'Vampires' errored in the
  // probe (transient fetch failure, not a dead tag) — the crawl logs show it
  // yielding 21 books at ≥150, so it stays first.
  { canonical: 'Vampires',                         tags: ['Vampires', 'Vampire'],                           ...MID },
  // 'Witches' returns 0 and 'witches' returns 50+. Casing, again — this genre
  // sat in GENRE_MAP for months looking dead over a capital letter.
  //
  // 'Witch' was probed and returns 0, so it is NOT here; 'witch' lowercase is
  // untested and carried speculatively, on the pattern that lowercase wins in
  // this dataset. 'Occult' is last on purpose — it is broader than the shelf,
  // so it should only ever be reached when the real tags came up short.
  { canonical: 'Witches',                          tags: ['witches', 'Witchcraft', 'witch', 'witchcraft', 'Occult'], ...NICHE },
  { canonical: 'Cozy Fantasy',                     tags: ['cozy fantasy', 'low fantasy', 'Low-stakes Fantasy', 'Cozy Fantasy Fiction'], ...NICHE },
  // 'Queer', 'LGBTQ', 'LGBTQ+' and 'Lgbt' all return 50+, and all are declined:
  // the shelf is sapphic and feminist gothic, not queer literature generally.
  // "Boy's Love" also returns 50 and is m/m — it would fill a sapphic shelf
  // with the one thing it is definitionally not.
  //
  // NOTE: `sapphic` reports 50 rows but its top books have single-digit reader
  // counts, so NICHE (≥50 readers) may still starve it. If the logs show this
  // genre yielding nothing, the fix is TINY, not another tag.
  { canonical: 'Feminist & Sapphic Gothic',        tags: ['sapphic', 'Lesbian', 'lesbian', 'sapphic fiction'], ...NICHE },
  // Chinese fiction belongs here — the shelf is East Asian, not Japan-only.
  { canonical: 'East Asian Literary Fiction',       tags: ['Japanese fiction', 'Japanese literature', 'Chinese fiction', 'Korean fiction', 'Korean Literature', 'Korean literature', 'Japanese Fiction'], ...TINY },
  // 'Magical Realism' is the real signal for this shelf; the nationality tags
  // barely exist.
  // 'Latin American Fiction' probed 0 and is dropped. 'Latin Americans' —
  // plural, and the only nationality form that exists at all — returns 2.
  { canonical: 'Magical Realism',                   tags: ['Magical Realism', 'Colombian fiction', 'Latin Americans', 'magical realism'], ...NICHE },
  // Tags were always fine — the bar was wrong. See THRESHOLD note above.
  { canonical: 'Parenting & Motherhood',           tags: ['Parenting', 'Motherhood', 'Mothers', 'motherhood'], ...TINY },
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

// Retries transient failures (v0.60.2).
//
// The probe surfaced this: a run reported `ERR fetch failed` for "Vampires", a
// tag the crawl logs prove is alive and yielding 21 books. Hardcover drops
// connections and rate-limits under sustained querying, and this job now walks
// up to 7 tag spellings per genre — roughly triple the request volume of the
// single-tag version, so it meets those limits far more often.
//
// Without a retry, a dropped connection is indistinguishable from a dead tag:
// the genre silently contributes nothing, the run still reports success, and
// the next person to read the logs concludes the tag name is wrong. That is
// the same failure that hid the casing bug for months.
//
// 429 and 5xx are retried; 4xx other than 429 is a real error and thrown
// immediately, since retrying a malformed query just wastes the budget.
async function hardcoverRequest(token, variables, attempt = 0) {
  const MAX_ATTEMPTS = 3;
  try {
    const res = await fetch(HARDCOVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      },
      body: JSON.stringify({ query: QUERY, variables }),
    });
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`hardcover ${res.status} (retryable)`);
    }
    if (!res.ok) throw new Error(`hardcover ${res.status}`);
    return res;
  } catch (e) {
    const retryable = /retryable|fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(e.message);
    if (!retryable || attempt >= MAX_ATTEMPTS - 1) throw e;
    // Short backoff — the whole handler runs under a function timeout, so this
    // cannot afford to wait long. 600ms then 1200ms clears most rate-limit
    // blips without threatening the ceiling.
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    return hardcoverRequest(token, variables, attempt + 1);
  }
}

async function hardcover(token, variables) {
  const res = await hardcoverRequest(token, variables);
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

// Warn if a canonical name no longer exists in public.genres.
//
// The taxonomy is NOT static. Oracle categorisation creates genres on demand —
// it prefers an existing name but invents one when the catalog has a genuine
// gap — so public.genres grows and shifts underneath this file. A canonical
// here that isn't there is invisible: the crawl keeps writing books.genre
// happily, but no reader can select the name in the picker, so those books can
// never be genre-seeded. That is precisely how four genres sat broken for
// months.
//
// One HEAD-ish read per run, failures ignored. This must never be able to stop
// a crawl — a warning that blocks the job would be worse than the drift it
// reports.
async function warnOnGenreDrift(url, key) {
  try {
    const res = await fetch(`${url}/rest/v1/genres?select=name`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return;
    const rows = await res.json();
    const known = new Set((rows || []).map((r) => r.name));
    const missing = GENRE_MAP.map((g) => g.canonical).filter((n) => !known.has(n));
    if (missing.length) {
      console.warn(
        `[catalog-crawl] GENRE DRIFT — ${missing.length} canonical name(s) absent from ` +
        `public.genres: ${missing.join(', ')}. Books written under these are unreachable ` +
        `by genre seeding because the picker offers only names from that table. ` +
        `Fix GENRE_MAP or add the rows.`
      );
    }
  } catch {
    // Never fatal. The crawl's job is books, not schema policing.
  }
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

  await warnOnGenreDrift(url, key);

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
      // Stop once this genre's quota is filled (v0.60.1).
      //
      // Tag lists got much longer when we started carrying casing variants of
      // the same concept — 'witches' and 'Witches', 'Gothic' and 'Gothic
      // Horror'. Without this, every extra spelling is an unconditional extra
      // round-trip (plus fetchTag's offset walk, up to 4 more), and runs were
      // already reaching 13s against a hard function ceiling.
      //
      // Ordering matters because of this: put the spelling that works FIRST in
      // each tags array, and the speculative variants after it. The later ones
      // are then only paid for when the earlier ones came up short — which is
      // exactly when a fallback spelling is worth trying.
      if (byId.size >= PER_GENRE) {
        tagDepths.push(`${tag}:skipped(quota)`);
        continue;
      }
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
