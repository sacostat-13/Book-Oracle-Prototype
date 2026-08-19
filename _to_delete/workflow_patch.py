# v0.64: adds a counters line to languageBackfill, and applies the
# 2026-08-17 postmortem's workflow fixes plus the two language passes.

# ── 1. languageBackfill.mjs: a machine-readable counters line ────────────────
p = 'batch-scripts/scheduled/languageBackfill.mjs'
s = open(p, encoding='utf-8').read()

anchor = "console.log(ALL\n  ? '\\nRan over the whole catalog (--all)."
assert s.count(anchor) == 1, 'languageBackfill tail anchor not found'

counters = """// A counters line, present only if the script reached the end. The workflow
// summary reads THIS rather than counting rows in a CSV: a CSV that was never
// written counts as zero, and zero renders as "nothing to do" when what it
// means is "did not finish". That mistake produced a report of six false zeros
// in the 2026-08-17 run.
console.log(
  `\\n[languageBackfill] examined=${stats.examined} written=${stats.written} ` +
  `noIsbn=${stats.noIsbn} noAnswer=${stats.noAnswer} conflict=${stats.conflict} ` +
  `confirmed=${stats.confirmed} disagreed=${stats.disagreed} failed=${stats.failed} ` +
  `googleOff=${googleOff ? 1 : 0} dryrun=${DRY_RUN ? 1 : 0} complete=1`
);

"""
s = s.replace(anchor, counters + anchor)
open(p, 'w', encoding='utf-8').write(s)
print('languageBackfill.mjs counters line ok')

# ── 2. catalog-maintenance.yml ───────────────────────────────────────────────
p = '.github/workflows/catalog-maintenance.yml'
s = open(p, encoding='utf-8').read()

def rep(old, new, n=1):
    global s
    assert s.count(old) == n, f'expected {n} of: {old[:70]!r}, found {s.count(old)}'
    s = s.replace(old, new)

# Header: what runs, and the new secret.
rep("""#   isbnBackfill.mjs   Hardcover      — free API, rate-limited, no per-call cost
#   isbnFallback.mjs   OpenLibrary    — free, no key
#                      Google Books   — free tier, ~1,000 queries/day
#""",
"""#   isbnBackfill.mjs             Hardcover     — free API, rate-limited, no per-call cost
#   isbnFallback.mjs             OpenLibrary   — free, no key
#                                Google Books  — free tier, ~1,000 queries/day
#                                ISBNdb        — paid subscription, 5,000/day, first when keyed
#   languageBackfill.mjs         OpenLibrary / Google Books / ISBN registration group
#   originalLanguageBackfill.mjs Wikidata / OpenLibrary / the catalog's own work groups
#
# The two language passes (v0.64) are free, terminate, and write nothing they
# cannot corroborate. They run last because their cheapest sources are the ISBNs
# and sibling rows the earlier steps just filled.
#""")

rep("""#   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HARDCOVER_API_TOKEN,
#   ANTHROPIC_API_KEY, GOOGLE_BOOKS_API_KEY""",
"""#   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HARDCOVER_API_TOKEN,
#   ANTHROPIC_API_KEY, GOOGLE_BOOKS_API_KEY, ISBNDB_API_KEY
#
# ISBNDB_API_KEY must be added to the repo secrets AND to the "Compose .env.local
# from secrets" step below. Missing it fails SILENTLY — isbnFallback just skips
# the source and reports a smaller number, which is indistinguishable from the
# source having nothing to say.""")

# Job timeout + why per-step ones now exist.
rep("""    # The scripts self-throttle to stay under Hardcover's 60 req/min, so a full catalog
    # pass is slow by design. Default 360 min is the ceiling; this is well clear of it.
    timeout-minutes: 180""",
"""    # The scripts self-throttle to stay under Hardcover's 60 req/min, so a full catalog
    # pass is slow by design. Default 360 min is the ceiling; this is well clear of it.
    #
    # v0.64 — the job budget is not the control that matters. On 2026-08-17 a
    # single step consumed the entire window and the runner cancelled it
    # mid-loop at [187/971]; the covers, metadata and regenre steps never ran at
    # all, and the summary reported their absence as zeros. Every step now has
    # its own timeout, so one slow pass costs its own budget and not the week's.
    timeout-minutes: 300""")

# Per-step timeouts + !cancelled().
#
# A step that FAILS must not skip the ones after it — they are independent
# passes over different columns. A real cancellation still stops everything,
# which is what !cancelled() buys over always().
rep("""      - name: Backfill ISBNs from Hardcover
        run: node batch-scripts/scheduled/isbnBackfill.mjs ${{ steps.args.outputs.limit }} | tee backfill.log""",
"""      - name: Backfill ISBNs from Hardcover
        timeout-minutes: 40
        run: node batch-scripts/scheduled/isbnBackfill.mjs ${{ steps.args.outputs.limit }} | tee backfill.log""")

rep("""      - name: Fallback to OpenLibrary / Google Books
        run:""",
"""      # `!cancelled()` rather than `always()`: a step that FAILED must not skip
      # the passes after it — they are independent and write different columns —
      # but a run somebody cancelled should stop.
      - name: Fallback to OpenLibrary / Google Books
        if: ${{ !cancelled() }}
        timeout-minutes: 55
        run:""")

rep("""      - name: Backfill missing covers
        run:""",
"""      - name: Backfill missing covers
        if: ${{ !cancelled() }}
        timeout-minutes: 30
        run:""")

rep("""      - name: Backfill descriptions and genres
        run:""",
"""      - name: Backfill descriptions and genres
        if: ${{ !cancelled() }}
        timeout-minutes: 35
        run:""")

rep("""      - name: Re-apply genre rules to stored subjects (free, offline)
        run: node batch-scripts/manual/regenreCatalog.mjs --apply | tee regenre.log""",
"""      - name: Re-apply genre rules to stored subjects (free, offline)
        if: ${{ !cancelled() }}
        timeout-minutes: 10
        run: node batch-scripts/manual/regenreCatalog.mjs --apply | tee regenre.log

      # 4c. books.language — v0.64. Free: OpenLibrary, Google Books, and the
      #     ISBN registration group, which is offline and answers for the recent
      #     non-Anglophone printings the APIs have never indexed.
      #
      #     After both ISBN passes, because every one of its sources is
      #     ISBN-keyed — an ISBN resolved above becomes a language in the same
      #     run. It writes NOTHING when the ISBN's language and the title
      #     disagree: books.isbn is chosen for a purchase link and is not
      #     necessarily this row's edition, and a wrongly-populated language
      #     column outranks the title heuristic everywhere it is consulted.
      - name: Backfill book languages (free)
        if: ${{ !cancelled() }}
        timeout-minutes: 45
        run: node batch-scripts/scheduled/languageBackfill.mjs ${{ steps.args.outputs.limit }} | tee language.log

      # 4d. books.original_language — v0.64. Wikidata P364, OpenLibrary
      #     translated_from, then propagation across the catalog's own work
      #     groups. Free, no keys, and it terminates.
      #
      #     Last, because its cheapest source is other rows: every answer found
      #     above spreads to every sibling row of the same work at no cost.
      #     Refuses to answer from a title match that the author does not
      #     corroborate, and never writes a guess — an unresolved row stays NULL
      #     and stays eligible for the nightly Oracle pass.
      - name: Backfill original languages (free)
        if: ${{ !cancelled() }}
        timeout-minutes: 60
        run: node batch-scripts/scheduled/originalLanguageBackfill.mjs ${{ steps.args.outputs.limit }} | tee origlanguage.log""")

# ISBNDB_API_KEY into the composed .env.local.
rep("""          GOOGLE_BOOKS_API_KEY: ${{ secrets.GOOGLE_BOOKS_API_KEY }}
        run: |""",
"""          GOOGLE_BOOKS_API_KEY: ${{ secrets.GOOGLE_BOOKS_API_KEY }}
          ISBNDB_API_KEY: ${{ secrets.ISBNDB_API_KEY }}
        run: |""")

rep("""            echo "GOOGLE_BOOKS_API_KEY=$GOOGLE_BOOKS_API_KEY"
          } > .env.local""",
"""            echo "GOOGLE_BOOKS_API_KEY=$GOOGLE_BOOKS_API_KEY"
            echo "ISBNDB_API_KEY=$ISBNDB_API_KEY"
          } > .env.local
          # Not in the required-secrets loop above: isbnFallback works without
          # it. But it works QUIETLY without it, so say so once, here.
          if [ -z "${ISBNDB_API_KEY:-}" ]; then
            echo "::warning::ISBNDB_API_KEY is not set — isbnFallback will skip the ISBNdb source."
          fi""")

# ── Summary: counters, not CSV row counts ────────────────────────────────────
old_summary_head = """          set -uo pipefail
          csv_rows() { [ -f "$1" ] && [ "$(wc -l < "$1")" -gt 1 ] && echo $(( $(wc -l < "$1") - 1 )) || echo 0; }"""
new_summary_head = """          set -uo pipefail
          csv_rows() { [ -f "$1" ] && [ "$(wc -l < "$1")" -gt 1 ] && echo $(( $(wc -l < "$1") - 1 )) || echo 0; }

          # THE 2026-08-17 LESSON, IN ONE FUNCTION.
          #
          # Every script prints a counters line as its last act, so the line
          # exists only if the script REACHED its last act. Reading that instead
          # of counting CSV rows is what makes "did not finish" distinguishable
          # from "nothing to do": a cancelled fallback left no CSV, the table
          # counted its absent rows as 0, and the summary said
          # "Still unresolved after OL/Google: 0" about a step that had died at
          # [187/971].
          #
          # A missing counter renders as an em dash, never as a number.
          counter() {   # counter <logfile> <field>
            [ -f "$1" ] || { echo "—  (did not run)"; return; }
            local v
            v=$(grep -o "$2=[0-9]*" "$1" 2>/dev/null | tail -1 | cut -d= -f2 || true)
            [ -n "$v" ] && echo "$v" || echo "—  (did not finish)"
          }"""
rep(old_summary_head, new_summary_head)

rep("""          UNRESOLVED=$(csv_rows batch-scripts/output/isbn-unresolved.csv)
          STILL=$(csv_rows batch-scripts/output/isbn-still-unresolved.csv)""",
"""          UNRESOLVED=$(counter backfill.log unresolved)
          STILL=$(counter fallback.log stuck)
          # complete=0 means isbnFallback flushed partial output on a signal.
          # The billable-curation issue must not fire on a partial number — that
          # is how a transient Hardcover outage turned into a recommendation to
          # spend ~$39 on books that were never missing.
          FB_COMPLETE=$(grep -o 'complete=[01]' fallback.log 2>/dev/null | tail -1 | cut -d= -f2 || true)
          FB_COMPLETE=${FB_COMPLETE:-0}
          LANG_WRITTEN=$(counter language.log written)
          ORIGLANG_WRITTEN=$(counter origlanguage.log written)
          ORIGLANG_PROP=$(counter origlanguage.log propagated)""")

rep("""          BACKLOG_THRESHOLD=150
          NEEDS=false
          [ "$PROPOSED" -gt 0 ] && NEEDS=true
          [ "$STILL" -ge "$BACKLOG_THRESHOLD" ] && NEEDS=true""",
"""          BACKLOG_THRESHOLD=150
          NEEDS=false
          [ "$PROPOSED" -gt 0 ] && NEEDS=true
          # Numeric comparisons only against a number. STILL is an em dash when
          # the step did not finish, and "did not finish" is never a reason to
          # recommend spending money.
          case "$STILL" in
            ''|*[!0-9]*) : ;;
            *) [ "$FB_COMPLETE" = "1" ] && [ "$STILL" -ge "$BACKLOG_THRESHOLD" ] && NEEDS=true ;;
          esac""")

rep("""          echo "curate_cost=$(awk -v n="$STILL" 'BEGIN{printf "%.2f", n*0.04}')" >> "$GITHUB_OUTPUT\"""",
"""          case "$STILL" in
            ''|*[!0-9]*) echo "curate_cost=0.00" >> "$GITHUB_OUTPUT" ;;
            *) echo "curate_cost=$(awk -v n="$STILL" 'BEGIN{printf "%.2f", n*0.04}')" >> "$GITHUB_OUTPUT" ;;
          esac""")

rep("""            echo "| Looked up, nothing found | $NOTHING |\"""",
"""            echo "| Looked up, nothing found | $NOTHING |"
            echo "| Languages filled | $LANG_WRITTEN |"
            echo "| Original languages filled | $ORIGLANG_WRITTEN |"
            echo "| Original languages propagated to siblings | $ORIGLANG_PROP |\"""")

rep("""            for f in backfill fallback covers metadata regenre curate; do""",
"""            for f in backfill fallback covers metadata regenre language origlanguage curate; do""")

open(p, 'w', encoding='utf-8').write(s)
print('catalog-maintenance.yml ok')
