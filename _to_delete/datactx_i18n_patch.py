import json, io, re

# ── src/lib/DataContext.jsx ──────────────────────────────────────────────────
p = 'src/lib/DataContext.jsx'
s = open(p, encoding='utf-8').read()

def rep(old, new, n=1):
    global s
    assert s.count(old) == n, f'DataContext: {s.count(old)} for {old[:70]!r}'
    s = s.replace(old, new)

rep(".select('started_at, pages_read, user_page_count, book:books(*, position_in_series, series:series(*))')",
    ".select('started_at, pages_read, user_page_count, progress_minutes, book:books(*, position_in_series, series:series(*))')")

rep("            userPageCount: r.user_page_count ?? null,",
    "            userPageCount: r.user_page_count ?? null,\n"
    "            // v0.65.1 — the audio counterpart of pagesRead. Null for every\n"
    "            // print row, which is what makes it safe to read unconditionally.\n"
    "            progressMinutes: r.progress_minutes ?? null,")

rep("""        page_count: patch?.page_count ?? null,
        format: patch?.format ?? null,
      };""",
"""        page_count: patch?.page_count ?? null,
        format: patch?.format ?? null,
        // v0.65.1 — audiobooks. duration_minutes is the audio counterpart of
        // page_count and narrator of translator; both are nullable and both are
        // included in the emptiness check below, so an edition consisting of
        // nothing but a narrator still counts as recorded.
        duration_minutes: patch?.duration_minutes ?? null,
        narrator: patch?.narrator ?? null,
      };""")

rep("""  const updateReadingProgress = useCallback(""",
"""  /**
   * How far into an audio edition this reader is, in minutes.
   *
   * A sibling of updateReadingProgress rather than a parameter on it, and the
   * separation is the point: pages and minutes are different units on different
   * columns, and a reader who switches format mid-book must not have one
   * reinterpreted as the other. See docs/audiobook-progress-v1-spec.md.
   *
   * `null` clears the position — a reader who empties the field is saying they
   * do not know where they are, which is different from saying zero.
   */
  const updateListeningProgress = useCallback(
    async (book, minutes) => {
      if (!book?.bookId) return;
      const value = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;

      // Optimistic, matching updateReadingProgress: the modal closes on the
      // decision, not on the round trip.
      setState((s) => ({
        ...s,
        currentlyReading: s.currentlyReading.map((b) =>
          b.bookId === book.bookId ? { ...b, progressMinutes: value } : b
        ),
      }));

      if (!user) return;

      const { error } = await supabase
        .from('currently_reading')
        .update({ progress_minutes: value })
        .eq('user_id', user.id)
        .eq('book_id', book.bookId);

      if (error) console.error('updateListeningProgress failed', error);
    },
    [user]
  );

  const updateReadingProgress = useCallback(""")

rep("""    updateReadingProgress,
    saveReaderEdition,""",
"""    updateReadingProgress,
    updateListeningProgress,
    saveReaderEdition,""")

open(p, 'w', encoding='utf-8').write(s)
print(p, 'ok')

# ── i18n ─────────────────────────────────────────────────────────────────────
EN = {
    'listenedLabel': 'How far are you?',
    'editionDurationLabel': 'Total length',
    'editionDurationNote': "Leave blank if you don't know — your listening still counts, you just won't get a progress bar.",
    'editionNarratorLabel': 'Narrator',
    'hoursShort': 'h',
    'minutesShort': 'm',
}
ES = {
    'listenedLabel': '¿Por dónde vas?',
    'editionDurationLabel': 'Duración total',
    'editionDurationNote': 'Dejalo en blanco si no lo sabés — lo que escuchaste igual cuenta, solo que no vas a ver la barra de progreso.',
    'editionNarratorLabel': 'Narrador',
    'hoursShort': 'h',
    'minutesShort': 'min',
}

for path, add in (('src/i18n/en.json', EN), ('src/i18n/es.json', ES)):
    d = json.load(open(path, encoding='utf-8'))
    prog = d.get('progress')
    assert isinstance(prog, dict), f'{path}: no progress section'
    for k, v in add.items():
        prog[k] = v
    # Sanity: the audio note the old layout used is now dead — the page field is
    # not rendered for an audiobook at all, so nothing apologises for it.
    prog.pop('editionAudioNote', None)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(path, 'ok', sorted(add))
