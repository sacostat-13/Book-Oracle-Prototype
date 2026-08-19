// titleLanguage.probe.mjs — does the last-resort language guess fire only when
// it should?
//
//   node batch-scripts/probes/titleLanguage.probe.mjs
//
// This heuristic DROPS rows from "More by this author", so its failure modes
// are asymmetric and the tests are weighted accordingly: a missed translation
// shows one extra cover, a false positive hides a real book from the reader
// with no way for them to know. Most of what follows is therefore negative
// cases — titles that must NOT be judged foreign.
//
// Written from the reported case: *The Dragon Keeper* listed *Aprendiz del
// Asesino*, *La Nef Du Crépuscule* and *Die Tochter des Wolfs* among Robin
// Hobb's books, because those catalog rows have language = NULL and no shared
// identifier with their English originals.

import { guessTitleLanguage, isForeignTo } from '../../src/lib/titleLanguage.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log('  ok  ' + n); }
  else { fail++; console.log('  FAIL ' + n + '  ' + e); }
};

console.log('--- the three that were reported ---');
for (const [title, lang] of [
  ['Aprendiz del Asesino', 'es'],
  ['La Nef Du Crepuscule', 'fr'],
  ['La Nef Du Crépuscule', 'fr'],
  ['Die Tochter des Wolfs', 'de'],
  // From the real backfill dry run: classified English on the strength of "a",
  // which is a Spanish preposition too. It cost a correct write.
  ['Contraataque a los 30', 'es'],
  ['Aprendiz de asesino', 'es'],
]) {
  check(`"${title}" reads as non-English`,
    isForeignTo({ t: title }, 'en'), `guess=${guessTitleLanguage(title)}`);
}

console.log('\n--- Robin Hobb in English: every one must survive ---');
for (const title of [
  'The Dragon Keeper', 'Assassin\'s Apprentice', 'Royal Assassin', 'Assassin\'s Quest',
  'Ship of Magic', 'The Mad Ship', 'Ship of Destiny', 'Fool\'s Errand',
  'The Golden Fool', 'Fool\'s Fate', 'Dragon Haven', 'City of Dragons',
  'Blood of Dragons', 'Fool\'s Assassin', 'Fool\'s Quest', 'Assassin\'s Fate',
  'Renegade\'s Magic', 'Shaman\'s Crossing', 'Forest Mage', 'Soldier Son',
]) {
  check(`"${title}" survives`, !isForeignTo({ t: title }, 'en'),
    `guess=${guessTitleLanguage(title)}`);
}

console.log('\n--- English titles containing foreign-looking words ---');
// The residual risk named in titleLanguage.js. These are the traps.
for (const title of [
  'Die Hard',                       // "die" is English; excluded as a marker
  'War and Peace',                  // "war" is German for "was"
  'The Man in the High Castle',     // "man", "in", "im"
  'A Time to Die',
  'An Ember in the Ashes',
  'On Writing',
  'As I Lay Dying',
  'Das Boot',                       // genuinely German, but see below
  'Los Angeles Noir',               // the known false positive
]) {
  const foreign = isForeignTo({ t: title }, 'en');
  const note = `guess=${guessTitleLanguage(title)}`;
  if (title === 'Das Boot' || title === 'Los Angeles Noir') {
    console.log(`  --  "${title}" → foreign=${foreign} (${note}) — documented limitation, not asserted`);
  } else {
    check(`"${title}" is NOT judged foreign`, !foreign, note);
  }
}

console.log('\n--- a populated language column always wins ---');
check('declared es beats an English-looking title',
  isForeignTo({ t: 'Assassin\'s Apprentice', language: 'es' }, 'en'));
check('declared en beats a Spanish-looking title',
  !isForeignTo({ t: 'Aprendiz del Asesino', language: 'en' }, 'en'));
check('no anchor means never foreign',
  !isForeignTo({ t: 'Aprendiz del Asesino' }, null));
check('Spanish reader keeps the Spanish title',
  !isForeignTo({ t: 'Aprendiz del Asesino' }, 'es'));
check('Spanish reader drops the German title',
  isForeignTo({ t: 'Die Tochter des Wolfs' }, 'es'));

console.log('\n--- degenerate input ---');
check('empty title', !isForeignTo({ t: '' }, 'en'));
check('null book', !isForeignTo(null, 'en'));
check('single word never guesses', guessTitleLanguage('Piranesi') === null);
check('no signal returns null', guessTitleLanguage('Dragon Keeper') === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
