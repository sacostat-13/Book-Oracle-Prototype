// seriesGate.mjs — the pre-approval decision, and nothing else.
//
// WHY THIS IS ITS OWN FILE
//
// Five rules stand between Hardcover's data and an unattended write into the
// shared `books` catalog, and every one of them was bought with a bad run:
//
//   language membership   2026-09-09  four Russian and Italian volumes
//                                     proposed as Malazan's canon
//   disowned              2026-09-09  Ian Douglas into N. K. Jemisin's
//                                     Inheritance Trilogy
//   structurallyOdd       2026-09-09  Red God at 7 of 6; five position-0
//                                     box sets into Dragonlance
//   no frame of reference 2026-09-11  fourteen Walter B. Gibson pulps into
//                                     Lila Bowen's three-book series, and
//                         2026-09-17  36 podcast episodes into Hardcore History
//   one book, one series  2026-09-11  six JoJo volumes into two series at once
//
// Until now each rule was a condition inside a 700-line function that also
// talks to Supabase and Hardcover, which means it could only be exercised by a
// live run against live upstream data — and the way a broken rule announced
// itself was a human reading a CSV. This file exists so the rules can be tested
// as what they are: a decision over plain data.
//
// WHAT A TEST HERE DOES AND DOES NOT BUY
//
// It protects the rules already paid for. It will NOT find the sixth failure
// mode: five of the six so far came from upstream doing something nobody
// predicted, and a test only asserts what somebody already thought to assert.
// The CSV review stays the discovery mechanism. A green suite means the known
// errors have not come back — nothing more, and believing otherwise is the
// empty-result-versus-failure trap in a new hat.

import { normTitle, splitAuthors } from './seriesCandidates.mjs';

export const DEFAULT_MIN_CONFIDENCE = 80;

/**
 * The whole pre-approval decision for one candidate at one position.
 *
 * Takes plain data — no clients, no network, no module state — and returns the
 * confidence, the notes this decision generates (in the order the CSV prints
 * them), and whether the row may carry a 'y'.
 *
 * `vetoes` names every rule that refused, so a caller (or a test) can say WHY a
 * row was held back rather than inferring it from a false.
 */
export function preApprovalVerdict({
  candidate,
  action,
  position,
  candidateCount = 1,
  structuralMove = false,
  exactSeriesMatch = true,
  seriesHitName = '',
  heldAuthors = new Set(),
  heldCount = 0,
  claimedTotal = null,
  claimedSource = 'total_books',
  maxHeldPosition = null,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
} = {}) {
  const v = candidate || {};
  const notes = [];
  const vetoes = [];

  // ---- confidence -----------------------------------------------------------
  let confidence = 100;

  if (!exactSeriesMatch) {
    confidence -= 10;
    notes.push(`series matched by containment ("${seriesHitName}")`);
  }

  // Reads EVERY contribution, as the filter does. Reading only v.author — the
  // first — picks up the NARRATOR on an audiobook: DCC's "This Inevitable Ruin"
  // came back credited to Erik Wilson, took 40 points and fell under the
  // threshold. The penalty is small because the per-position author filter has
  // already removed the case it was built for; what reaches here is a volume
  // with nobody to compare it against, which is a mild doubt, not a verdict.
  const vAuthors = (v.authors || [v.author]).filter(Boolean).flatMap(splitAuthors);
  const disowned =
    heldAuthors.size > 0 && vAuthors.length > 0 &&
    !vAuthors.some((a) => heldAuthors.has(normTitle(a)));

  if (disowned) {
    confidence -= 15;
    notes.push(`credited to ${vAuthors.map((a) => `"${a}"`).join(', ')}, not the series author`);
  }
  if (!v.author) { confidence -= 20; notes.push('no author'); }
  if (normTitle(v.title).length < 3) { confidence -= 40; notes.push('title too short'); }
  if (claimedTotal && position > claimedTotal) {
    confidence -= 20;
    notes.push(`beyond ${claimedSource} (${claimedTotal})`);
  }
  confidence = Math.max(0, confidence);

  // ---- which candidate, if any ----------------------------------------------
  // More than one candidate at a position is a real choice — an original and
  // its translations, most often — and this script cannot make it from the
  // fields it can safely query. So it states the choice and pre-approves
  // nothing. `pick` is the module's answer to "which of these is the original":
  // a lone candidate, or the one the series' own collection editions quote.
  // Everything else stays in the file as a visible, unapproved alternative.
  if (v.pickReason) notes.push(v.pick ? `chosen: ${v.pickReason}` : v.pickReason);
  if (candidateCount > 1 && !v.pick) {
    notes.push(`alternative at position ${position} — approve this instead only if the chosen one is wrong`);
  }
  if (!v.pick) vetoes.push('not-picked');

  // ---- the vetoes -----------------------------------------------------------
  // Two positions Hardcover uses for things that are not volumes, and that the
  // run got wrong in both directions: position 0 (prequels, omnibuses, box
  // sets) and beyond total_books (Red God at 7 of 6 — a different sub-series).
  // Both were confidence penalties that landed on exactly 80 and sailed through
  // a >= 80 threshold. A penalty that still passes is not a guard.
  const structurallyOdd = position === 0 || Boolean(claimedTotal && position > claimedTotal);
  if (structurallyOdd) {
    vetoes.push('structurally-odd');
    if (v.pick) notes.push('not pre-approved: unusual position for a volume');
  }

  // NOTHING BOUNDS THIS SERIES. The guard above is only as good as the number
  // it compares against, and for some series there is no number anywhere.
  // Dungeon Crawler Carl, 2026-09-09: no total_books here or upstream, so
  // Dinniman's standalone "The Beautiful Place" at position 9 had nothing to
  // fail against. This does not veto — refusing every tail volume of every
  // unbounded series would cost far more than it saves — it SAYS SO, on the
  // rows where the risk lives.
  if (!claimedTotal && maxHeldPosition && position > maxHeldPosition) {
    notes.push(`nothing claims a length for this series — no total_books here or upstream, so position ${position} is unbounded`);
  }

  // NOBODY WE KNOW WROTE THIS. 2026-09-09: Ian Douglas's Semper Human into
  // Jemisin's Inheritance Trilogy, Nancy Holder's Spellbound into Evanovich's
  // Wicked — both carried the `not the series author` note and sailed through
  // on a 15-point penalty. The per-position author FILTER cannot help: it drops
  // a non-matching candidate only when a matching one stands at the same
  // position, and at these positions there was none. So it is a veto, not a
  // filter — the row stays in the file, approvable by hand.
  if (disowned) {
    vetoes.push('disowned');
    if (v.pick) notes.push('not pre-approved: no author in common with the series');
  }

  // ONE UNNUMBERED BOOK IS NOT A FRAME OF REFERENCE.
  //
  // Every veto above compares the candidate to something the series already
  // claims: `disowned` needs heldAuthors, the structural guard needs
  // claimedTotal, the unbounded note needs maxHeldPosition. The 2026-09-11
  // version of this rule asked only whether the series held ANY book, and said
  // the way out was "one volume placed by hand".
  //
  // THE BUG THAT REFINED IT: Hardcore History, 2026-09-17 — and 2026-09-10
  // before it, the same 36 rows both times. That series holds exactly one book,
  // "Human Resources", UNNUMBERED and with no page count, and has no
  // total_books. So heldCount is 1 and the old rule passed; maxHeldPosition is
  // null so the unbounded note could not fire; claimedTotal is null so the
  // structural guard could not fire. Thirty-six episodes of Dan Carlin's
  // podcast were pre-approved at positions 1 to 68 — right credit, right
  // language, sole candidate at each — because Hardcover files the podcast as a
  // book_series and nothing here could say otherwise.
  //
  // A held book is not what the gate needs. It needs a FRAME: a held volume
  // that carries a position, or a claimed length. One positionless row is
  // neither, and satisfying the old rule with one was too easy.
  //
  // Note what this is NOT. A page-count guard was written for Hardcore History
  // on 2026-09-10 and rejected after replaying ten batches: it missed this
  // series (one entry has 690 pages — there is a printed transcript) and it
  // vetoed ten real Charles Stross novels in Laundry Files, none of which carry
  // a page count upstream. That reasoning still holds. This rule does not look
  // at pages at all, and Laundry Files keeps pre-approving because it has
  // positioned volumes.
  //
  // Replayed across every run to date:
  //
  //   09-12   289 pre-approvals    0 affected
  //   09-13    50 pre-approvals    0 affected
  //   09-14    67 pre-approvals    0 affected
  //   09-16    67 pre-approvals    0 affected
  //   09-17    40 pre-approvals   37 affected  (Hardcore History, Venom)
  //
  // 473 pre-approvals across four consecutive runs, untouched. It also subsumes
  // the old rule: zero held books is a special case of no positioned volume.
  //
  // The way out is still one human field, just a more specific one: number the
  // first volume, or set total_books.
  const noFrameOfReference = maxHeldPosition == null && !claimedTotal;
  if (noFrameOfReference) {
    vetoes.push('no-frame-of-reference');
    if (v.pick) {
      notes.push(heldCount === 0
        ? 'not pre-approved: this series holds no books, so nothing here could be checked against what we keep'
        : 'not pre-approved: this series holds nothing with a position and claims no length, so there is nothing to check a position against');
    }
  }

  if (structuralMove) {
    vetoes.push('structural-move');
    notes.push('not pre-approved: this moves a volume a human already placed');
  }

  // MEMBERSHIP IS NECESSARY, NOT SUFFICIENT.
  //
  // THE BUG THIS EXISTS FOR: Oz, 2026-09-12. Position 3 pre-approved
  // أوزما أميرة أوز — the Arabic Ozma of Oz — with `language` reading `eng`.
  //
  // Nothing had failed. The 2026-09-09 membership rule asks whether the WORK
  // has an English edition, and Ozma of Oz certainly does. But a candidate row
  // is a specific EDITION, and this one was the Arabic printing. Membership was
  // the right fix for Malazan, where the filter was deleting English volumes;
  // it was never a test of the row in front of you.
  //
  // Script is. A title written in Arabic, Cyrillic, Greek, Han, Thai or Bengali
  // is not the English edition whatever the edition list reports, and it costs
  // one regex to see. This is a VETO, not a filter: the row stays in the file,
  // because a catalog of English titles for Japanese works is exactly the thing
  // this project holds, and a human may well want it.
  //
  // Deliberately one-directional. It says nothing about Latin-script
  // translations — Kış Ustası, Adrijan Mol, Anschlag auf den Präsidenten — which
  // are the same error and are not caught here. Those need the edition data to
  // improve. This catches only what is unambiguous from the characters alone.
  const letters = [...String(v.title || '')].filter((ch) => /\p{L}/u.test(ch));
  const latin = letters.filter((ch) => /\p{Script=Latin}/u.test(ch)).length;
  const mostlyNonLatin = letters.length > 0 && latin / letters.length < 0.5;
  if (mostlyNonLatin) {
    vetoes.push('non-latin-title');
    if (v.pick) notes.push('not pre-approved: the title is not in Latin script, so this is a translated edition whatever its editions report');
  }

  if (action === 'skip') vetoes.push('skip');
  if (confidence < minConfidence) vetoes.push('below-confidence');

  const preApprove =
    action !== 'skip' && Boolean(v.pick) && !structurallyOdd && !disowned &&
    !structuralMove && !noFrameOfReference && !mostlyNonLatin &&
    confidence >= minConfidence;

  return { confidence, notes, preApprove, vetoes };
}

/**
 * ONE BOOK CANNOT HOLD TWO POSITIONS.
 *
 * Every rule above judges one candidate against one position in one series.
 * Nothing compares a row to the rest of the file, and on 2026-09-11 seven
 * hardcover_ids were pre-approved twice — Maximum Carnage into two Spider-Man
 * titles, six JoJo volumes into both Stardust Crusaders and Jojo's Bizarre
 * Adventure.
 *
 * The JoJo pair is not a matcher bug. Stardust Crusaders IS part 3 of the
 * parent, so volume 1 of the part is volume 13 of the whole and BOTH ROWS ARE
 * RIGHT IN THEIR OWN FRAME. The file is what is wrong: apply it and, with a
 * single series_id on books, the later write moves the book out of the series
 * the earlier write placed it in. Which page keeps it is decided by ROW ORDER —
 * a race inside a CSV, silent, and invisible afterwards because both series
 * look plausible either way.
 *
 * This does not pick a frame. Whether a catalog series may be part of another
 * series, and what position_in_series means if it is, is a schema question and
 * not one to answer by guessing here. It withdraws BOTH pre-approvals in place
 * and names the conflict on each row. Returns how many it withdrew.
 */
export function withdrawCrossSeriesDuplicates(rows) {
  const approvedById = new Map();
  for (const r of rows) {
    if (r.approve !== 'y' || !r.hardcover_id) continue;
    const seen = approvedById.get(r.hardcover_id) || [];
    seen.push(r);
    approvedById.set(r.hardcover_id, seen);
  }

  let withdrawn = 0;
  for (const group of approvedById.values()) {
    if (group.length < 2) continue;
    withdrawn += group.length;
    for (const r of group) {
      const others = [...new Set(
        group.filter((o) => o !== r).map((o) => `${o.series_name} #${o.position}`)
      )];
      r.approve = '';
      r.notes = [r.notes, `not pre-approved: this same book is also proposed as ${others.join(', ')} — one book, two positions`]
        .filter(Boolean).join('; ');
    }
  }
  return withdrawn;
}
