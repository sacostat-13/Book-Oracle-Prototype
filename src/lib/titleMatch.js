// Shared title/author matching for the catalog batch scripts.
//
// Extracted so isbnBackfill.mjs and isbnFallback.mjs can't drift apart — and because the
// first version of this logic, duplicated in both, had a bug that silently wrote a wrong
// ISBN to the catalog.
//
// THE BUG THIS FIXES
// ------------------
// The original matcher stripped everything after a colon and then allowed any prefix
// match. For "Agatha Christie: An Autobiography" that left the comparison title as
// "Agatha Christie" — which is a prefix of "Agatha Christie's Poirot -- Book One",
// "Agatha Christie's Detectives", and every other collection bearing her name. The
// script confidently resolved the autobiography to a Poirot omnibus.
//
// Two changes prevent it:
//
//   1. Compare VARIANTS, not one canonical form. Each title yields {as-written,
//      series-markers-removed, subtitle-removed}, and a match is accepted if any pair
//      lines up. Stripping is no longer destructive, because the unstripped form is
//      still in play — "Babel" still matches "Babel: An Arcane History" on the stripped
//      variant, while "Agatha Christie: An Autobiography" keeps its full form available.
//
//   2. Bound the prefix rule. A prefix match now requires the leftover to be small
//      relative to what matched (30%, min 4 chars). "A Discovery of Witches" →
//      "…: A Novel" leaves 6 characters against 19 and passes; "Agatha Christie" →
//      "…'s Poirot -- Book One" leaves 14 against 14 and fails.

// Ampersands are spelled out by some catalogues and left as symbols by others, and
// stripping punctuation turns that difference into a hard mismatch rather than a near
// one: "At the Corner of Rock Bottom & Nowhere" normalised to
// "atthecornerofrockbottomnowhere" while ISBNdb's "…Rock Bottom and Nowhere" became
// "atthecornerofrockbottomandnowhere". Not equal, and not a prefix either — the strings
// diverge in the middle — so both the exact and the prefix rule failed on what is
// plainly the same book. Expanding before stripping makes the two sides agree.
export const normTitle = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s\+\s/g, ' and ')
    .replace(/[^a-z0-9]/g, '');

// The three forms of a title, kept LABELLED rather than as a bare array.
//
// They used to be returned as a deduped array and selected positionally. That breaks
// silently: when a title has no parenthetical, `full` and `noSeries` are identical, the
// Set collapses them, and index 1 becomes the subtitle-stripped form. Code asking for
// "the first two, excluding the subtitle-stripped one" then got exactly the form it was
// trying to exclude — which is how "Hellblazer: Tainted Love" kept matching a bare
// "Hellblazer" record after the fix meant to stop it.
export function titleForms(t) {
  const full = (t || '').trim();
  if (!full) return { full: '', noSeries: '', noSubtitle: '' };

  // Goodreads-style series markers: "(Miss Marple, #9)", "[JoJo …]", trailing ", #1".
  const noSeries = full
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s*,\s*#\d+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Publisher subtitle: ": A Novel", " — Book One", ": An Arcane History".
  const noSubtitle = noSeries.replace(/\s*[:—–]\s*.*$/, '').replace(/\s+-{1,2}\s+.*$/, '').trim();

  return { full, noSeries, noSubtitle };
}

const uniq = (xs) => [...new Set(xs.filter((x) => x && x.length))];

// Every form worth comparing against, most specific first.
export function titleVariants(t) {
  const f = titleForms(t);
  return uniq([f.full, f.noSeries, f.noSubtitle]);
}

// Volume/instalment number, read from the SERIES-STRIPPED form so a parenthetical series
// marker — "Fourth Wing (The Empyrean, 1)" — is not mistaken for one. Serialized works
// put the number in the title proper: "…, Vol. 10", "…, Tome 13", "The Infinity Crusade,
// Vol. 1".
const VOLUME_RX = /(?:^|[\s,:—–-])(?:vol\.?|volume|tome|part|pt\.?|book|no\.?|#)\s*(\d+)\b/gi;

// ALL instalment numbers in a title, in order — not just the first.
//
// Reading only the first is what let two JoJo volumes survive the v42 reset and collapse
// onto one ISBN again:
//
//   "JoJo's Bizarre Adventure: Part 1—Phantom Blood, Vol. 2"  → first match is Part 1
//   "JoJo's Bizarre Adventure: Part 1—Phantom Blood, Vol. 3"  → first match is Part 1
//
// Both reported volume 1, the guard saw agreement, and the bounded prefix rule then let
// them through to the same Hardcover record. Comparing the full sequence — [1,2] vs
// [1,3] — distinguishes them, and correctly treats "Part 1, Vol. 2" as a different thing
// from either "Part 1" or "Vol. 2" alone.
function volumesOf(t) {
  const stripped = (t || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ');
  const out = [];
  for (const m of stripped.matchAll(VOLUME_RX)) out.push(Number(m[1]));
  return out;
}

const sameVolumes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// The text after a colon, once series markers are off. Used to tell "same work, publisher
// subtitle" from "different instalments of one series".
function subtitleOf(t) {
  const stripped = (t || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ');
  const m = stripped.match(/:\s*(.+)$/);
  return m ? normTitle(m[1]) : null;
}

// Matching is ASYMMETRIC, and that asymmetry is the point.
//
// `want` is what the catalog holds — what a reader actually asked for. `got` is a
// candidate from Hardcover/OpenLibrary/Google Books. Reducing the two sides is not
// equally safe:
//
//   want "Babel"                    got "Babel: An Arcane History"
//     Reducing GOT to "Babel" discards detail from the RECORD WE FOUND. Safe: the user
//     asked for Babel and this is Babel, more fully described.
//
//   want "Hellblazer: Tainted Love"  got "Hellblazer"
//     Reducing WANT to "Hellblazer" discards what the USER ASKED FOR. Not safe: it turns
//     a specific collection into the series container, and every other Hellblazer volume
//     reduces to the same thing. This is how "Tainted Love" and "Dangerous Habits" ended
//     up sharing 9781563891502 — each matched a bare "Hellblazer" record.
//
// So `want` is never reduced past its subtitle; only `got` is. Series markers are still
// stripped from both, since "(Miss Marple, #9)" is bibliographic annotation rather than
// part of the title.
export function titleMatches(want, got) {
  const wf = titleForms(want);
  // Explicitly the two forms that keep the subtitle. Never wf.noSubtitle.
  const A = uniq([wf.full, wf.noSeries]).map(normTitle).filter(Boolean);
  const B = titleVariants(got).map(normTitle).filter(Boolean);
  if (!A.length || !B.length) return false;

  // ─── Serialized-work guards ───────────────────────────────────────────────
  // Both of these exist because the variant approach alone still collapsed whole
  // comic and manga runs onto one ISBN. Fifteen JoJo's Bizarre Adventure volumes,
  // eight Pokémon Adventures, six Hellblazer collections and five X-Men arcs each
  // shared a single ISBN, because every one of them reduces to the same
  // subtitle-stripped variant.

  const sWant = subtitleOf(want);
  const sGot = subtitleOf(got);

  if (sWant && sGot && sWant === sGot) {
    // Both name the same work after the colon. Fall through — but NOT past the volume
    // check below.
    //
    // An earlier version treated a matching subtitle as decisive enough to waive a
    // volume mismatch, so "Hellblazer, Vol. 1: Original Sins" matched "Hellblazer:
    // Original Sins". Those are different collections: the 1992 "Original Sins" gathers
    // Hellblazer #1-9, while the 2011 "Vol. 1: Original Sins" reissue adds Swamp Thing
    // #76-77. Different contents, different ISBNs, two catalog rows that should each
    // keep their own.
    //
    // The general rule: a volume number is part of a work's identity in a way a shared
    // subtitle cannot override. When one side numbers itself and the other does not,
    // they are different editions at best and different books at worst — and for a
    // purchase link, "at worst" is what matters.
  } else if (sWant && sGot) {
    // Both carry a colon-subtitle and they DIFFER: different works sharing an imprint.
    // "X-Men: Inferno" vs "X-Men: Days of Future Past", "Mistborn: Secret History" vs
    // "Mistborn: The Final Empire", every Hellblazer collection. Here the subtitle IS
    // the title and the part before the colon is just the series banner.
    //
    // Note this must be checked BEFORE falling through to variant matching, and must
    // NOT be waived by "some variant agrees" — the subtitle-stripped variant of both
    // sides is the bare series name, so it always agrees. That escape hatch silently
    // disabled this entire guard on the first attempt.
    return false;
  } else {
    // At most one side has a subtitle — the publisher-subtitle case we still want to
    // match ("Babel" → "Babel: An Arcane History"). Fall through to the volume check.
  }

  // If either side names a volume, both must name the SAME one. Matching "The Infinity
  // Crusade, Vol. 1" to a bare "The Infinity Crusade" record is how Vol. 1 and Vol. 2
  // ended up sharing an ISBN: the bounded prefix rule let "vol1" and "vol2" through
  // because each is exactly the 4-character floor.
  // Applies unconditionally — see the note above about why a matching subtitle does not
  // waive this.
  const vWant = volumesOf(want);
  const vGot = volumesOf(got);
  if ((vWant.length || vGot.length) && !sameVolumes(vWant, vGot)) return false;

  // Exact agreement on any pair of variants is the strong signal, and covers most real
  // cases once series markers and subtitles are off both sides.
  for (const a of A) for (const b of B) if (a === b) return true;

  // Otherwise allow a prefix, but only a tightly bounded one.
  for (const a of A) {
    for (const b of B) {
      const [short, long] = a.length <= b.length ? [a, b] : [b, a];
      if (short.length < 8) continue;            // "dune" prefixes "dunemessiah"
      if (!long.startsWith(short)) continue;
      if (long.length - short.length <= Math.max(4, short.length * 0.3)) return true;
    }
  }
  return false;
}

// Surname is the stable part of an author string across "V.E. Schwab" / "V. E. Schwab" /
// "Schwab, V.E." and translated credits.
export function authorSurname(a) {
  return normTitle((a || '').split(/[,&]|\sand\s/i)[0].trim().split(/\s+/).pop() || '');
}

export function authorMatches(want, names) {
  const s = authorSurname(want);
  if (!s) return true;                 // nothing stored to corroborate against
  if (!names || !names.length) return false;  // can't corroborate → don't accept
  return names.some((n) => normTitle(n).includes(s));
}
