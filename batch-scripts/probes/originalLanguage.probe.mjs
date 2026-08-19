// originalLanguage.probe.mjs — offline checks for the rules behind
// books.original_language.
//
//   node batch-scripts/probes/originalLanguage.probe.mjs
//
// No network, no database, no keys. Exit code 0 = all pass, 1 = something
// regressed. Safe to run in CI and safe to run before a backfill.
//
// WHAT IS WORTH PROBING HERE
//
// Two rules in src/lib/originalLanguage.js can lose data, and neither of them
// fails loudly:
//
//   authorLikelySame() is the ONLY thing between a Wikidata title search and a
//   permanent write. Too loose and *Dune* the desert answers for *Dune* the
//   novel; too strict and every accented author in the catalog goes unfilled
//   because a Goodreads CSV stripped the accents years ago.
//
//   planPropagation() copies one row's answer onto another row. If its notion
//   of "same work" is wrong, it is wrong quietly and at scale.
//
// The 2026-08-17 postmortem's second wrong turn was a probe that hardcoded its
// own inputs and therefore came back clean while the job it was diagnosing was
// broken. The cases below are drawn from rows that are actually in the catalog
// — the placeholder-author rows, the two-surname Spanish authors, the
// duplicate-work pairs — rather than from invented ones.

import {
  normPerson, normTitleLoose, isPlaceholderAuthor, authorLikelySame,
  to6391, workKeys, planPropagation, decideWrite, searchTitles,
} from '../../src/lib/originalLanguage.js';

let pass = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${name}\n      expected ${e}\n      got      ${a}`);
}

// ── Normalisation ────────────────────────────────────────────────────────────
check('normPerson strips diacritics', normPerson('Gabriel García Márquez'), 'gabriel garcia marquez');
check('normPerson strips honorifics', normPerson('Dr. Seuss'), 'seuss');
// "Richard Wells (ed.)" is how the catalog stores an anthology's editor. The
// parenthetical is a role, and leaving it in normalises to "richard wells ed",
// which matches nothing on either side.
check('normPerson strips an editor marker', normPerson('Richard Wells (ed.)'), 'richard wells');
check('normPerson strips (editor)', normPerson('Ann Vandermeer (editor)'), 'ann vandermeer');
check('normPerson survives a double space', normPerson('Jim  Butcher'), 'jim butcher');
check('normTitleLoose expands &', normTitleLoose('Rock Bottom & Nowhere'), 'rock bottom and nowhere');
check('normTitleLoose matches the "and" spelling', normTitleLoose('Rock Bottom and Nowhere'), 'rock bottom and nowhere');

// ── Placeholder authors ──────────────────────────────────────────────────────
// The 31 rows from the postmortem. Each of these must be skipped rather than
// searched, because a title match against them cannot be verified.
for (const p of ['Unknown author', 'unknown', 'Various', 'VV. AA.', 'Autor desconocido', '', null, '   ']) {
  check(`placeholder: ${JSON.stringify(p)}`, isPlaceholderAuthor(p), true);
}
for (const real of ['A.A. Milne', 'Various Ways of Being — Ann Author', 'Anonymous Bosch']) {
  check(`not a placeholder: ${real}`, isPlaceholderAuthor(real), false);
}

// ── Author verification ──────────────────────────────────────────────────────
// Must ACCEPT: the same person spelled the way four different sources spell them.
const same = [
  ['Gabriel García Márquez', 'Gabriel Garcia Marquez'],
  ['Gabriel García Márquez', 'García Márquez, Gabriel'],
  ['Gabriel García Márquez', 'G. García Márquez'],
  ['Robin Hobb', 'Robin Hobb'],
  ['Ursula K. Le Guin', 'Ursula Le Guin'],
  ['J.R.R. Tolkien', 'John Ronald Reuel Tolkien'],
  ['Mariana Enríquez', 'Mariana Enriquez'],
  ['Ocean Vuong', 'Vuong, Ocean'],
];
for (const [a, b] of same) check(`same person: ${a} ≈ ${b}`, authorLikelySame(a, b), true);

// Must REJECT: this is the half that protects the column.
const different = [
  ['Stephen King', 'Owen King'],
  ['Stephen King', 'Tabitha King'],
  ['Frank Herbert', 'Brian Herbert'],
  ['Amal El-Mohtar', 'Max Gladstone'],
  ['Gabriel García Márquez', 'Enrique Vila-Matas'],
  ['Unknown author', 'A.A. Milne'],          // the postmortem's case, exactly
  ['Robin Hobb', ''],
  ['', 'Robin Hobb'],
];
for (const [a, b] of different) check(`different people: ${a} vs ${b}`, authorLikelySame(a, b), false);

// J.R.R. vs John Ronald Reuel is an initials-vs-full-name agreement; Stephen
// vs Owen is a full-name contradiction. If a change ever makes the second pass,
// every King in the catalog inherits the wrong answer.

// ── Search titles ────────────────────────────────────────────────────────────
//
// Every case below is a real row that came back `no-search-hits` in the v0.64
// diagnose run. Wikidata holds all of these books; it does not hold the
// Goodreads annotation the catalog staples to them.
check('series annotation comes off',
  searchTitles('Turn Coat (The Dresden Files, #11)'),
  ['Turn Coat (The Dresden Files, #11)', 'Turn Coat']);
check('multi-series annotation comes off',
  searchTitles('Passage to Dawn (Legacy of the Drow, #4; The Legend of Drizzt, #10)'),
  ['Passage to Dawn (Legacy of the Drow, #4; The Legend of Drizzt, #10)', 'Passage to Dawn']);
check('subtitle is a separate, later rung',
  searchTitles('Cribsheet: A Data-Driven Guide to Better, More Relaxed Parenting'),
  ['Cribsheet: A Data-Driven Guide to Better, More Relaxed Parenting', 'Cribsheet']);
check('a plain title yields exactly one form',
  searchTitles('The Green Mile'), ['The Green Mile']);

// A bracketed romanisation goes FIRST: for a Japanese or Korean title, the
// romanised string is the one Wikidata is most likely to hold as a label or
// alias, and the native form often is not there at all.
{
  const forms = searchTitles("ジョジョの奇妙な冒険ストーンオーシャン 14 [JoJo no Kimyō na Bōken Sutōn'ōshan]");
  check('romanisation is tried first', forms[0], "JoJo no Kimyō na Bōken Sutōn'ōshan");
}
// …but a series note in brackets is not a romanisation.
{
  const forms = searchTitles('Some Book [Miss Marple, #9]');
  check('a bracketed series note is not promoted', forms[0], 'Some Book [Miss Marple, #9]');
}
check('the ladder is capped', searchTitles('A: B: C (X, #1) [Y, #2]').length <= 4, true);
check('nothing in, nothing out', searchTitles(''), []);

// ── Language codes ───────────────────────────────────────────────────────────
check('639-2 bibliographic', to6391('/languages/ger'), 'de');
check('639-2 terminological', to6391('deu'), 'de');
check('639-1 passes through', to6391('es'), 'es');
check('BCP-47 is reduced to the subtag', to6391('es-MX'), 'es');
check('nonsense is refused', to6391('US'), 'us');   // two letters: shape-valid, the caller's problem
check('unmapped 639-3 is refused', to6391('qqq'), null);
check('empty is refused', to6391(''), null);
check('null is refused', to6391(null), null);

// ── Work keys ────────────────────────────────────────────────────────────────
check('keys from every identifier',
  workKeys({ hardcover_id: 42, goodreads_id: 7, isbn: '978-0-06-088328-7' }),
  ['hc:42', 'gr:7', 'isbn:9780060883287']);
check('no identifiers, no keys', workKeys({ title: 'Orphan' }), []);
check('a title is never a key', workKeys({ title: 'Dune', author: 'Frank Herbert' }), []);

// ── Propagation ──────────────────────────────────────────────────────────────
//
// The case this exists for: One Hundred Years of Solitude and Cien años de
// soledad are two rows sharing a hardcover_id. Wikidata answers the English
// one; the Spanish one must inherit 'es' without a second request.
{
  const rows = [
    { id: 'a', title: 'One Hundred Years of Solitude', hardcover_id: 1, original_language: 'es' },
    { id: 'b', title: 'Cien años de soledad', hardcover_id: 1, original_language: null },
    { id: 'c', title: 'Cent ans de solitude', hardcover_id: 1, original_language: null },
  ];
  const { assignments, poisoned } = planPropagation(rows);
  check('propagates to both translations', assignments.map((a) => [a.id, a.code]), [['b', 'es'], ['c', 'es']]);
  check('nothing poisoned', poisoned, []);
}

// A group whose members disagree answers nobody. One of the two is mis-linked,
// and picking a winner would bury the evidence under a confident wrong answer.
{
  const rows = [
    { id: 'a', hardcover_id: 9, original_language: 'es' },
    { id: 'b', hardcover_id: 9, original_language: 'fr' },
    { id: 'c', hardcover_id: 9, original_language: null },
  ];
  const { assignments, poisoned } = planPropagation(rows);
  check('disagreeing group writes nothing', assignments, []);
  check('and is reported', poisoned, ['hc:9']);
}

// Two rows that share nothing must not infect each other, however alike they look.
{
  const rows = [
    { id: 'a', title: 'Crushed', author: 'G. Willow Wilson', original_language: 'en' },
    { id: 'b', title: 'Crushed', author: 'Kate Hamer', original_language: null },
  ];
  check('no shared identifier, no propagation', planPropagation(rows).assignments, []);
}

// An answer must not travel backwards over a row that already has one.
{
  const rows = [
    { id: 'a', goodreads_id: 5, original_language: 'ja' },
    { id: 'b', goodreads_id: 5, original_language: 'ja' },
  ];
  check('already-filled rows are left alone', planPropagation(rows).assignments, []);
}

// ── Write precedence ─────────────────────────────────────────────────────────
check('empty row is filled', decideWrite({ original_language: null }, 'es'), 'write');
check('agreement is a confirmation', decideWrite({ original_language: 'es' }, 'es'), 'confirm');
check('disagreement is not applied by default', decideWrite({ original_language: 'en' }, 'es'), 'conflict');
check('--force applies it', decideWrite({ original_language: 'en', original_language_source: 'oracle_inferred' }, 'es', { force: true }), 'write');
check('--force does not reach a verified answer',
  decideWrite({ original_language: 'en', original_language_source: 'verified' }, 'es', { force: true }), 'protected');
check('--force does not reach a self-stated answer',
  decideWrite({ original_language: 'en', original_language_source: 'self_stated' }, 'es', { force: true }), 'protected');
check('no code, no write', decideWrite({ original_language: null }, null), 'conflict');

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\noriginalLanguage.probe — ${pass} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log('');
  process.exit(1);
}
console.log('  All offline rules hold. This says nothing about whether Wikidata is reachable —');
console.log('  for that, run the backfill with --probe "Title|Author".\n');
