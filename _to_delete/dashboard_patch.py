p = 'src/views/Dashboard.jsx'
s = open(p, encoding='utf-8').read()

def rep(old, new, n=1):
    global s
    assert s.count(old) == n, f'{s.count(old)} for {old[:70]!r}'
    s = s.replace(old, new)

rep("import { effectivePages } from '../lib/editions';",
    "import { effectivePages, effectiveMinutes, isAudioEdition, formatMinutes } from '../lib/editions';")

rep("function ReadingStatsWidget({ library, editions, go, t }) {",
    "function ReadingStatsWidget({ library, editions, currentlyReading, go, t }) {")

rep("""  const pages = library.reduce((sum, b) => sum + (effectivePages(b, editions?.[b.bookId]) || 0), 0);

  const cards = [
    { value: total, label: thisYearCount > 0 ? t('dashboard.statsWidgetThisYear', { count: thisYearCount }) : t('dashboard.statsWidgetBooks', { count: total }) },
    { value: pace ?? '—', label: 'avg per month' },
    { value: pages > 0 ? pages.toLocaleString() : '—', label: 'pages total' },
  ];""",
"""  const pages = library.reduce(
    (sum, b) => (isAudioEdition(editions?.[b.bookId]) ? sum : sum + (effectivePages(b, editions?.[b.bookId]) || 0)),
    0
  );

  // v0.65.1 — hours listened, and the reason it is a SEPARATE number.
  //
  // Until now this widget summed effectivePages over the whole library. An
  // audiobook has no page count, contributed zero, and a reader who finished
  // forty of them was shown a pages total that said they had read nothing.
  // That is the bug; the tile is the fix.
  //
  // It is not fixed by giving audiobooks a page count. There is no honest
  // pages-per-hour rate, and a fabricated one would be indistinguishable here
  // from a counted page — see docs/audiobook-progress-v1-spec.md. Two units,
  // two tiles, and `pages` now explicitly SKIPS audio editions rather than
  // relying on them happening to be null.
  //
  // Finished books count their full duration; a book in progress counts how far
  // the reader has got. The first is an approximation (abandoned at 80% and
  // marked read counts 100%) and is documented as one in the spec.
  const finishedMinutes = library.reduce(
    (sum, b) => sum + (effectiveMinutes(editions?.[b.bookId]) || 0),
    0
  );
  const inProgressMinutes = (currentlyReading || []).reduce(
    (sum, b) => (isAudioEdition(editions?.[b.bookId]) ? sum + (Number(b.progressMinutes) || 0) : sum),
    0
  );
  const listened = finishedMinutes + inProgressMinutes;

  const cards = [
    { value: total, label: thisYearCount > 0 ? t('dashboard.statsWidgetThisYear', { count: thisYearCount }) : t('dashboard.statsWidgetBooks', { count: total }) },
    { value: pace ?? '—', label: 'avg per month' },
    { value: pages > 0 ? pages.toLocaleString() : '—', label: 'pages total' },
    // Rendered only when there is something to show. A reader who listens to
    // nothing should not be told they have listened to nothing — an empty tile
    // is a worse answer than no tile.
    ...(listened > 0 ? [{ value: formatMinutes(listened), label: 'listened' }] : []),
  ];""")

rep("""      case 'reading-stats': return <ReadingStatsWidget key={id} library={state.library || []} editions={state.editionsByBookId} go={go} t={t} />;""",
"""      case 'reading-stats': return <ReadingStatsWidget key={id} library={state.library || []} editions={state.editionsByBookId} currentlyReading={state.currentlyReading || []} go={go} t={t} />;""")

open(p, 'w', encoding='utf-8').write(s)
print(p, 'ok')
