// series-gate.test.js — the pre-approvals that should never have been 'y'.
//
// THE BUGS THESE EXIST FOR
//
// Every case below is a row that carried approve='y' in a real CSV and was
// wrong. None is invented. The rule each one bought is in
// batch-scripts/_shared/seriesGate.mjs with the same date against it, so a
// guard that stops working shows up here as the specific book it stopped
// catching — the same contract series-candidates.test.js keeps for the filters.
//
// The positive cases matter at least as much. Every rule here is a TRADE: it
// refuses rows to stop worse rows, and the ones it must NOT refuse (Dungeon
// Crawler Carl's unbounded tail, a plain volume in a series we already hold)
// are the measure of whether the trade is still the one that was agreed.
//
// What this suite does not do: find the next failure mode. Five of the six so
// far came from upstream doing something nobody predicted. Green here means the
// known errors have not come back.

import { describe, it, expect } from 'vitest';
import { preApprovalVerdict, withdrawCrossSeriesDuplicates } from '../batch-scripts/_shared/seriesGate.mjs';
import { normTitle } from '../batch-scripts/_shared/seriesCandidates.mjs';

const authors = (...names) => new Set(names.map(normTitle));

// A series we hold books in, one clean candidate, nothing odd: the shape that
// SHOULD pre-approve. Every case below is this with one thing changed.
const baseline = (over = {}) => ({
  candidate: { title: 'Malice of Crows', author: 'Lila Bowen', pick: true, pickReason: 'has a eng edition' },
  action: 'insert',
  position: 3,
  candidateCount: 1,
  heldAuthors: authors('Lila Bowen'),
  heldCount: 2,
  claimedTotal: 4,
  maxHeldPosition: 2,
  ...over,
});

describe('the baseline it is allowed to approve', () => {
  it('pre-approves a sole picked candidate in a series we hold books in', () => {
    const v = preApprovalVerdict(baseline());
    expect(v.preApprove).toBe(true);
    expect(v.confidence).toBe(100);
    expect(v.vetoes).toEqual([]);
  });

  it('still approves at exactly the threshold, and not a point below', () => {
    // Containment (-10) plus a missing author (-20) lands on 70.
    const at = preApprovalVerdict(baseline({ minConfidence: 70, exactSeriesMatch: false, seriesHitName: 'Shadow', candidate: { title: 'Malice of Crows', pick: true } }));
    expect(at.confidence).toBe(70);
    expect(at.preApprove).toBe(true);

    const below = preApprovalVerdict(baseline({ minConfidence: 71, exactSeriesMatch: false, seriesHitName: 'Shadow', candidate: { title: 'Malice of Crows', pick: true } }));
    expect(below.preApprove).toBe(false);
    expect(below.vetoes).toContain('below-confidence');
  });
});

describe('no frame of reference — 2026-09-11 The Shadow, 2026-09-17 Hardcore History', () => {
  // The catalog series holds Lila Bowen's books. It held NONE of them at the
  // time of the run, so fourteen Walter B. Gibson pulps were pre-approved at
  // positions 7 to 329: right language, sole candidate at each, nothing held to
  // contradict them. The CSV carried no 'no author in common' and no 'nothing
  // claims a length' note on those rows — those checks did not fire quietly,
  // they did not run.
  const gibson = {
    // The credit line verbatim from the CSV: 'Maxwell Grant / Walter B. Gibson'.
    candidate: { title: 'Shadowed Millions', author: 'Maxwell Grant', authors: ['Maxwell Grant', 'Walter B. Gibson'], pick: true, pickReason: 'has a eng edition' },
    action: 'insert',
    position: 21,
    heldAuthors: new Set(),   // nothing held, so nothing to compare against
    heldCount: 0,
    claimedTotal: null,
    maxHeldPosition: null,
  };

  it('refuses to pre-approve anything into a series holding no books', () => {
    const v = preApprovalVerdict(gibson);
    expect(v.preApprove).toBe(false);
    expect(v.vetoes).toContain('no-frame-of-reference');
  });

  it('says why on the row, because the row is what a human reads', () => {
    const v = preApprovalVerdict(gibson);
    expect(v.notes.join('; ')).toContain('this series holds no books');
  });

  it('is the ONLY thing stopping it — confidence alone would have passed it', () => {
    // The point of the rule: every other guard is inert here.
    const v = preApprovalVerdict(gibson);
    expect(v.confidence).toBe(100);
    expect(v.vetoes).toEqual(['no-frame-of-reference']);
  });

  it('lets the same candidate through once the series holds a POSITIONED book', () => {
    // The way out has to actually be a way out.
    const v = preApprovalVerdict({ ...gibson, heldCount: 1, heldAuthors: authors('Maxwell Grant'), maxHeldPosition: 20 });
    expect(v.preApprove).toBe(true);
  });

  it('a claimed total is the other way out, with nothing positioned', () => {
    const v = preApprovalVerdict({ ...gibson, heldCount: 1, heldAuthors: authors('Maxwell Grant'), claimedTotal: 30 });
    expect(v.preApprove).toBe(true);
  });

  // HARDCORE HISTORY, 2026-09-17 — and 2026-09-10, the same 36 rows both times.
  // One held book, "Human Resources", UNNUMBERED and with no pages, and no
  // total_books. heldCount is 1, so the 2026-09-11 rule passed it; every other
  // structural guard had nothing to compare against. Thirty-six episodes of Dan
  // Carlin's podcast were pre-approved at positions 1 to 68.
  const carlin = {
    candidate: { title: 'Wrath of the Khans', author: 'Dan Carlin', pick: true, pickReason: 'has a eng edition' },
    action: 'insert',
    position: 43,
    heldCount: 1,                 // "Human Resources"
    heldAuthors: authors('Dan Carlin'),
    maxHeldPosition: null,        // ...which carries no position
    claimedTotal: null,           // ...and nothing claims a length
  };

  it('refuses a series whose only held book carries no position', () => {
    const v = preApprovalVerdict(carlin);
    expect(v.preApprove).toBe(false);
    expect(v.vetoes).toContain('no-frame-of-reference');
  });

  it('says the more specific thing when a book IS held', () => {
    // "holds no books" would be a lie here, and the note is what a human reads.
    const joined = preApprovalVerdict(carlin).notes.join('; ');
    expect(joined).toContain('nothing with a position and claims no length');
    expect(joined).not.toContain('holds no books');
  });

  it('is the only thing stopping it — everything else is satisfied', () => {
    const v = preApprovalVerdict(carlin);
    expect(v.confidence).toBe(100);
    expect(v.vetoes).toEqual(['no-frame-of-reference']);
  });

  it('LAUNDRY FILES MUST STILL PASS: no page counts, but positioned volumes', () => {
    // The page-count guard rejected on 2026-09-10 vetoed ten real Stross novels.
    // This rule must not, which is the whole reason it looks at positions.
    const v = preApprovalVerdict({
      candidate: { title: 'The Nightmare Stacks', author: 'Charles Stross', pick: true, pickReason: 'has a eng edition' },
      action: 'insert', position: 7,
      heldCount: 4, heldAuthors: authors('Charles Stross'),
      maxHeldPosition: 6, claimedTotal: null,
    });
    expect(v.preApprove).toBe(true);
    expect(v.vetoes).toEqual([]);
  });
});

describe('disowned — 2026-09-09, Semper Human and Spellbound', () => {
  // Ian Douglas's military SF into N. K. Jemisin's Inheritance Trilogy, and
  // Nancy Holder's Spellbound into Janet Evanovich's Wicked. Both carried the
  // 'not the series author' note and sailed through on a 15-point penalty.
  it('vetoes a candidate crediting nobody the series credits', () => {
    const v = preApprovalVerdict(baseline({
      candidate: { title: 'Semper Human', author: 'Ian Douglas', pick: true },
      heldAuthors: authors('N. K. Jemisin'),
    }));
    expect(v.preApprove).toBe(false);
    expect(v.vetoes).toContain('disowned');
    expect(v.confidence).toBe(85);   // the old penalty, which was not enough
  });

  it('does not fire when the candidate credits nobody at all', () => {
    // A different doubt, already worth 20 points. Vetoing here would take the
    // narrator case with it.
    const v = preApprovalVerdict(baseline({ candidate: { title: 'Malice of Crows', pick: true } }));
    expect(v.vetoes).not.toContain('disowned');
    expect(v.confidence).toBe(80);
  });

  it('does not fire when the series has no authors to compare against', () => {
    // This is the hole holdsNothing now covers; the rule itself must stay
    // narrow, or it would veto every first look.
    const v = preApprovalVerdict(baseline({
      candidate: { title: 'Semper Human', author: 'Ian Douglas', pick: true },
      heldAuthors: new Set(),
      heldCount: 3,
    }));
    expect(v.vetoes).not.toContain('disowned');
  });

  it('matches on ANY credited contributor, not just the first', () => {
    // Reading only the first credit picks up the narrator: DCC's 'This
    // Inevitable Ruin' came back credited to Erik Wilson and took 40 points.
    const v = preApprovalVerdict(baseline({
      candidate: { title: 'This Inevitable Ruin', authors: ['Erik Wilson', 'Matt Dinniman'], pick: true },
      heldAuthors: authors('Matt Dinniman'),
    }));
    expect(v.vetoes).not.toContain('disowned');
    expect(v.preApprove).toBe(true);
  });
});

describe('structurallyOdd — 2026-09-09, Dragonlance and Red God', () => {
  it('vetoes position 0, where Hardcover files box sets and prequels', () => {
    const v = preApprovalVerdict(baseline({ position: 0 }));
    expect(v.preApprove).toBe(false);
    expect(v.vetoes).toContain('structurally-odd');
  });

  it('vetoes a position past the claimed total — Red God at 7 of 6', () => {
    const v = preApprovalVerdict(baseline({ position: 7, claimedTotal: 6 }));
    expect(v.preApprove).toBe(false);
    expect(v.vetoes).toContain('structurally-odd');
    // It was a 20-point penalty landing on exactly 80, which passed a >= 80
    // threshold. The veto exists because the penalty did not.
    expect(v.confidence).toBe(80);
  });

  it('does not veto a tail volume when nothing claims a length', () => {
    // Dungeon Crawler Carl: no total_books here or upstream. Refusing every
    // unbounded tail would cost far more than it saves, so this SAYS SO instead.
    const v = preApprovalVerdict(baseline({ position: 9, claimedTotal: null, maxHeldPosition: 8 }));
    expect(v.preApprove).toBe(true);
    expect(v.notes.join('; ')).toContain('nothing claims a length');
  });
});

describe('the choice it refuses to make', () => {
  it('pre-approves nothing when the module did not pick this candidate', () => {
    const v = preApprovalVerdict(baseline({
      candidate: { title: 'Дань псам. Том 1', author: 'Steven Erikson', pick: false },
      candidateCount: 4,
    }));
    expect(v.preApprove).toBe(false);
    expect(v.vetoes).toContain('not-picked');
    expect(v.notes.join('; ')).toContain('alternative at position 3');
  });

  it('never pre-approves a move of a volume a human placed', () => {
    // 2026-09-11: ten silent moves pre-approved at confidence 100, including
    // Prelude to Foundation from #1 to #6 — renumbering a deliberate
    // chronological order into Hardcover's publication one.
    const v = preApprovalVerdict(baseline({ action: 'set-position', structuralMove: true }));
    expect(v.preApprove).toBe(false);
    expect(v.vetoes).toContain('structural-move');
  });

  it('never pre-approves a skip', () => {
    const v = preApprovalVerdict(baseline({ action: 'skip' }));
    expect(v.preApprove).toBe(false);
  });
});

describe('non-Latin title — 2026-09-12, Oz', () => {
  // Position 3 pre-approved أوزما أميرة أوز, the Arabic Ozma of Oz, with
  // language reading 'eng'. Nothing had failed: the WORK has English editions,
  // so membership passed. The row was a specific edition, and it was Arabic.
  const arabicOzma = baseline({
    candidate: { title: 'أوزما أميرة أوز', author: 'L. Frank Baum', pick: true, pickReason: 'the only candidate not titled after the series' },
    position: 3,
    heldAuthors: authors('L. Frank Baum'),   // the Oz series holds Baum, as the real one does
  });

  it('refuses a title written in another script, whatever the editions report', () => {
    const v = preApprovalVerdict(arabicOzma);
    expect(v.preApprove).toBe(false);
    expect(v.vetoes).toContain('non-latin-title');
  });

  it('is a veto, not a filter — the row stays approvable by hand', () => {
    // The catalog deliberately holds English titles for Japanese works, so the
    // row must remain in the file for a human to take.
    const v = preApprovalVerdict(arabicOzma);
    expect(v.confidence).toBe(100);
    expect(v.notes.join('; ')).toContain('not in Latin script');
  });

  it('catches Cyrillic, Greek and Han as well as Arabic', () => {
    for (const title of ['Дом Цепей', 'Το μάτι του Γκόλεμ', '2010太空漫游', 'ล่าตุลาแดง']) {
      const v = preApprovalVerdict(baseline({ candidate: { title, author: 'Someone', pick: true } }));
      expect(v.vetoes, title).toContain('non-latin-title');
    }
  });

  it('leaves accented Latin titles alone', () => {
    // One-directional on purpose: Latin-script translations are the same error
    // and are NOT caught here. Kış Ustası must pass this rule, not fail it for
    // the wrong reason.
    for (const title of ['Kış Ustası', 'Anschlag auf den Präsidenten', 'Máquinas mortales']) {
      const v = preApprovalVerdict(baseline({ candidate: { title, author: 'Someone', pick: true } }));
      expect(v.vetoes, title).not.toContain('non-latin-title');
    }
  });

  it('does not fire on a title with no letters at all', () => {
    const v = preApprovalVerdict(baseline({ candidate: { title: '1Q84', author: 'Haruki Murakami', pick: true } }));
    expect(v.vetoes).not.toContain('non-latin-title');
  });
});

describe('one book, two positions — 2026-09-11, JoJo and Maximum Carnage', () => {
  const rows = () => ([
    { approve: 'y', hardcover_id: '508102', series_name: 'Web of Spider-Man (1985)', position: 101, notes: 'chosen: has a eng edition' },
    { approve: 'y', hardcover_id: '508102', series_name: 'Amazing Spider-Man (1963-1998)', position: 378, notes: '' },
    { approve: 'y', hardcover_id: '202125', series_name: 'Stardust Crusaders', position: 1, notes: '' },
    { approve: 'y', hardcover_id: '202125', series_name: "Jojo's Bizarre Adventure", position: 13, notes: '' },
    { approve: 'y', hardcover_id: '777', series_name: 'Expeditionary Force', position: 4, notes: '' },
    { approve: '', hardcover_id: '508102', series_name: 'Somewhere Else', position: 9, notes: '' },
    { approve: 'y', hardcover_id: '', series_name: 'No Id Here', position: 2, notes: '' },
  ]);

  it('withdraws BOTH sides — neither frame is the right one to guess', () => {
    const out = rows();
    expect(withdrawCrossSeriesDuplicates(out)).toBe(4);
    expect(out[0].approve).toBe('');
    expect(out[1].approve).toBe('');
    expect(out[2].approve).toBe('');
    expect(out[3].approve).toBe('');
  });

  it('names the conflicting series on each row, and keeps the existing note', () => {
    const out = rows();
    withdrawCrossSeriesDuplicates(out);
    expect(out[0].notes).toContain('chosen: has a eng edition');
    expect(out[0].notes).toContain('Amazing Spider-Man (1963-1998) #378');
    expect(out[3].notes).toContain('Stardust Crusaders #1');
  });

  it('leaves a book approved into exactly one series alone', () => {
    const out = rows();
    withdrawCrossSeriesDuplicates(out);
    expect(out[4].approve).toBe('y');
  });

  it('ignores rows that were never approved, and rows carrying no id', () => {
    // The unapproved Somewhere Else row shares 508102 but is not a collision:
    // nothing would be written from it.
    const out = rows();
    withdrawCrossSeriesDuplicates(out);
    expect(out[5].approve).toBe('');
    expect(out[5].notes).toBe('');
    expect(out[6].approve).toBe('y');
  });

  it('withdraws a book approved into three series, not just two', () => {
    const out = [
      { approve: 'y', hardcover_id: '9', series_name: 'A', position: 1, notes: '' },
      { approve: 'y', hardcover_id: '9', series_name: 'B', position: 2, notes: '' },
      { approve: 'y', hardcover_id: '9', series_name: 'C', position: 3, notes: '' },
    ];
    expect(withdrawCrossSeriesDuplicates(out)).toBe(3);
    expect(out.every((r) => r.approve === '')).toBe(true);
    expect(out[0].notes).toContain('B #2');
    expect(out[0].notes).toContain('C #3');
  });
});

describe('the 2026-09-11 run, replayed', () => {
  // The measurement the empty-series rule was built on: every pre-approval in a
  // series holding a book was correct, and every wrong one came from a series
  // holding none. Asserted as a property, so the rule cannot be weakened
  // without this failing.
  it('approves nothing in an empty series, whatever else is right about it', () => {
    const empties = [
      { title: 'X-Men Legacy, Vol. 1: Divided He Stands', position: 208 },
      { title: 'The Complete Clone Saga Epic, Vol. 1', position: 117 },
      { title: 'Justice League Dark, Vol. 1: In the Dark', position: 1 },
      { title: 'The Crime Cult', position: 14 },
    ];
    for (const { title, position } of empties) {
      const v = preApprovalVerdict({
        candidate: { title, author: 'Somebody', pick: true, pickReason: 'has a eng edition' },
        action: 'insert', position, heldCount: 0, heldAuthors: new Set(),
        claimedTotal: null, maxHeldPosition: null,
      });
      expect(v.preApprove, `${title} at ${position}`).toBe(false);
    }
  });
});
