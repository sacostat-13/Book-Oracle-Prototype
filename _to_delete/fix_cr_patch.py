p = 'src/lib/DataContext.jsx'
s = open(p, encoding='utf-8').read()

def rep(old, new, n=1):
    global s
    assert s.count(old) == n, f'{s.count(old)} for {old[:80]!r}'
    s = s.replace(old, new)

# ── 1. A column-tolerant select ──────────────────────────────────────────────
rep("""// ---------- Supabase loaders ----------
async function loadFromSupabase(userId) {""",
"""// ---------- Supabase loaders ----------

/**
 * Run a query that names a column added by a migration, and fall back to a
 * query that does not if the column is not there yet.
 *
 * v0.65.1, written the day after this exact failure shipped. Adding
 * `progress_minutes` to the currently_reading select made the whole query fail
 * on any database where 20260820120000 had not been applied — PostgREST
 * answers `column ... does not exist` — and because that result is consumed as
 * `(res.data || [])`, four books rendered as an empty shelf. Not an error, not
 * a spinner: an empty state, which reads as "you are not reading anything"
 * rather than "the app could not ask".
 *
 * The lesson had already been learnt one commit earlier, in
 * originalLanguageBackfill.mjs, where detectStampColumn() exists for the same
 * reason and says so at length. It was applied to the batch script and not to
 * the app, which is the half a reader can see.
 *
 * A schema mismatch between a deployed bundle and a database is not an edge
 * case here — it is the NORMAL state for the minutes between a deploy and a
 * migration, and for a developer who pulls before applying. Degrading to the
 * old shape and saying so is the behaviour that fits.
 */
async function selectTolerant(run, runWithout, column) {
  const res = await run();
  if (!res?.error) return res;
  if (!new RegExp(column).test(res.error.message || '')) return res;
  console.warn(
    `[schema] ${column} is missing — falling back to the previous query shape. ` +
    'Apply the pending migration; until then this column reads as null.',
    res.error.message
  );
  return runWithout();
}

// currently_reading, with and without the audiobook column.
const CR_TAIL = 'book:books(*, position_in_series, series:series(*))';
const CR_COLS = `started_at, pages_read, user_page_count, progress_minutes, ${CR_TAIL}`;
const CR_COLS_PRE_AUDIO = `started_at, pages_read, user_page_count, ${CR_TAIL}`;

// reader_editions, likewise. This one already degraded to {} on error, which
// is correct for a missing TABLE and wrong for a missing column: it would have
// thrown away every recorded edition — page counts, languages, translators —
// over two columns nobody had migrated yet.
const RE_COLS = 'book_id, language, isbn, edition_title, translator, page_count, format, source, duration_minutes, narrator';
const RE_COLS_PRE_AUDIO = 'book_id, language, isbn, edition_title, translator, page_count, format, source';

async function loadFromSupabase(userId) {""")

rep("""    supabase
      .from('currently_reading')
      .select('started_at, pages_read, user_page_count, progress_minutes, book:books(*, position_in_series, series:series(*))')
      .eq('user_id', userId),""",
"""    selectTolerant(
      () => supabase.from('currently_reading').select(CR_COLS).eq('user_id', userId),
      () => supabase.from('currently_reading').select(CR_COLS_PRE_AUDIO).eq('user_id', userId),
      'progress_minutes'
    ),""")

rep("""    supabase
      .from('reader_editions')
      .select('book_id, language, isbn, edition_title, translator, page_count, format, source')
      .eq('user_id', userId),""",
"""    selectTolerant(
      () => supabase.from('reader_editions').select(RE_COLS).eq('user_id', userId),
      () => supabase.from('reader_editions').select(RE_COLS_PRE_AUDIO).eq('user_id', userId),
      'duration_minutes'
    ),""")

# ── 2. A failed shelf load must not look like an empty shelf ─────────────────
rep("""  const currentlyReading = (currentlyReadingRes.data || [])""",
"""  // An empty shelf and a failed query are different facts, and `(data || [])`
  // renders them identically. This cannot invent the books back, but it can
  // stop the failure being invisible in the console — which is how four books
  // became a blank page with nothing to grep for.
  if (currentlyReadingRes?.error) {
    console.error(
      'currently_reading load FAILED — the shelf will render empty, which is not the same as ' +
      'having no books. Check for a pending migration before assuming the data is gone.',
      currentlyReadingRes.error
    );
  }

  const currentlyReading = (currentlyReadingRes.data || [])""")

open(p, 'w', encoding='utf-8').write(s)
print(p, 'ok')
