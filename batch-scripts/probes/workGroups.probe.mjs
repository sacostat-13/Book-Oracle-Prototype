// workGroups.probe.mjs — does the same-work collapse actually collapse?
//
//   node batch-scripts/probes/workGroups.probe.mjs
//
// No database, no network, no test framework: this imports src/lib/workGroups.js
// directly and runs it over hand-built rows. Written after the first release of
// "More by this author" shipped and the section showed *The River Has Roots*
// alongside *El río tiene raíces*, two entries for *This Is How You Lose the
// Time War*, and its German and Czech translations — none of which any amount
// of reading the code had predicted.
//
// Half of these cases assert that things DO collapse. The other half assert
// that things DO NOT, and those are the important ones: a false collapse hides
// a book completely and the reader cannot tell it happened, whereas a missed
// one merely shows a book twice. If you loosen a signal in workGroups.js, this
// file is what tells you what you broke.

import { collapseWorks } from '../../src/lib/workGroups.js';
let pass=0, fail=0;
const check=(n,c,e='')=>{ if(c){pass++;console.log('  ok  '+n);} else {fail++;console.log('  FAIL '+n+'  '+e);} };

console.log('--- reported case: Amal El-Mohtar ---');

// What the page actually returned. No shared ids: the translations are separate
// catalog rows and the Google Books hits never touched our catalog.
const elMohtar = [
  {t:'The River Has Roots',a:'Amal El-Mohtar',language:'en'},          // sentinel
  {t:'El río tiene raíces',a:'Amal El-Mohtar',language:'es'},
  {t:'This Is How You Lose the Time War',a:'Amal El-Mohtar',language:'en'},
  {t:'This Is How You Lose the Time War: A Novel',a:'Amal El-Mohtar',language:'en'},
  {t:'Verlorene der Zeiten',a:'Amal El-Mohtar',language:'de'},
  {t:'Tak prohraješ časovou válku',a:'Amal El-Mohtar',language:'cs'},
];
let r = collapseWorks(elMohtar,{uiLang:'en'});
check('Time War title variant collapses',
  r.filter(b=>/Time War/i.test(b.t)).length===1,
  JSON.stringify(r.map(b=>b.t)));

// The translations have no shared identifier, so the collapse CANNOT group them
// — that is what the language restriction in googleBooksByAuthor is for. This
// test pins the honest boundary so nobody assumes the collapse covers it.
check('untitled-link translations survive collapse (language filter handles them)',
  r.some(b=>b.t==='Tak prohraješ časovou válku'));

// With a shared work id — what the catalog looks like once enriched — they do.
const linked = [
  {t:'This Is How You Lose the Time War',a:'Amal El-Mohtar',hardcoverId:42,language:'en',originalLanguage:'en',coverUrl:'c'},
  {t:'Verlorene der Zeiten',a:'Amal El-Mohtar',hardcoverId:42,language:'de',originalLanguage:'en',coverUrl:'c'},
  {t:'Tak prohraješ časovou válku',a:'Amal El-Mohtar',hardcoverId:42,language:'cs',originalLanguage:'en',coverUrl:'c'},
];
r = collapseWorks(linked,{uiLang:'en'});
check('linked translations collapse to the original-language row',
  r.length===1 && r[0].t==='This Is How You Lose the Time War', JSON.stringify(r.map(b=>b.t)));

console.log('\n--- co-author ---');
const coauth = [
  {t:'This Is How You Lose the Time War',a:'Amal El-Mohtar'},
  {t:'This Is How You Lose the Time War',a:'Amal El-Mohtar',fromLookup:true}, // canonicalised in authorWorks
];
check('catalog row and canonicalised GB hit are one book', collapseWorks(coauth).length===1);

console.log('\n--- the false-collapse guard ---');
const expanse = [
  {t:'The Expanse: Leviathan Wakes',a:'James S. A. Corey'},
  {t:'The Expanse: Caliban’s War',a:'James S. A. Corey'},
  {t:'The Expanse: Abaddon’s Gate',a:'James S. A. Corey'},
];
check('series titles sharing a colon prefix are NOT collapsed',
  collapseWorks(expanse).length===3, JSON.stringify(collapseWorks(expanse).map(b=>b.t)));

const dune = [{t:'Dune',a:'Frank Herbert'},{t:'Dune Messiah',a:'Frank Herbert'}];
check('prefix titles are NOT collapsed', collapseWorks(dune).length===2);

const emma = [
  {t:'Emma',a:'Jane Austen'},
  {t:'Emma: A Modern Retelling',a:'Alexander McCall Smith'},
];
check('same title different author is NOT collapsed', collapseWorks(emma).length===2);

console.log('\n--- edition noise ---');
const noise = [
  {t:'Piranesi',a:'Susanna Clarke',coverUrl:'c'},
  {t:'Piranesi: A Novel',a:'Susanna Clarke'},
  {t:'Piranesi (Illustrated Edition)',a:'Susanna Clarke'},
];
r=collapseWorks(noise);
check('edition noise variants collapse to one', r.length===1, JSON.stringify(r.map(b=>b.t)));
check('and the one kept is the one with a cover', r[0].t==='Piranesi');

const accents = [
  {t:'El río tiene raíces',a:'Amal El-Mohtar'},
  {t:'El rio tiene raices',a:'Amal El-Mohtar'},
];
check('accent-only difference collapses', collapseWorks(accents).length===1);


console.log('\n--- general ---');

// 1. Translations collapse via shared work-level hardcover id.
const gm=[
 {t:'One Hundred Years of Solitude',a:'Gabriel García Márquez',hardcoverId:1,language:'en',originalLanguage:'es',coverUrl:'x'},
 {t:'Cien años de soledad',a:'Gabriel García Márquez',hardcoverId:1,language:'es',originalLanguage:'es',coverUrl:'x'},
 {t:'Cent ans de solitude',a:'Gabriel García Márquez',hardcoverId:1,language:'fr',originalLanguage:'es',coverUrl:'x'},
 {t:'Love in the Time of Cholera',a:'Gabriel García Márquez',hardcoverId:2,language:'en',coverUrl:'x'},
];
r=collapseWorks(gm,{uiLang:'en'});
check('3 translations + 1 other -> 2 entries', r.length===2, JSON.stringify(r.map(b=>b.t)));
check('original-language row wins over reader UI language', r[0].t==='Cien años de soledad', r[0].t);

// 2. Transitive grouping: A-B share hc, A-C share isbn. A precedence key misses C.
const tr=[
 {t:'A',a:'X',hardcoverId:9,isbn:'9780306406157'},
 {t:'B',a:'X',hardcoverId:9},
 {t:'C',a:'X',isbn:'978-0-306-40615-7'},
];
check('transitive union collapses all three', collapseWorks(tr).length===1);

// 3. NO false collapse: standalones with null series position must stay separate.
const st=[
 {t:'Book One',a:'Y',seriesId:null,seriesPosition:null},
 {t:'Book Two',a:'Y',seriesId:null,seriesPosition:null},
 {t:'Book Three',a:'Y'},
];
check('null series signals do not collapse standalones', collapseWorks(st).length===3);

// 4. Same series, different positions = different books.
const se=[
 {t:'Vol 1',a:'Z',seriesId:'s1',seriesPosition:1},
 {t:'Vol 2',a:'Z',seriesId:'s1',seriesPosition:2},
];
check('same series different position stays separate', collapseWorks(se).length===2);

// 5. Same series+position across languages = one book. Nested `s` shape too.
const sp=[
 {t:'Vol 1',a:'Z',seriesId:'s1',seriesPosition:1,language:'en'},
 {t:'Tomo 1',a:'Z',s:{seriesId:'s1',n:1},language:'es'},
];
check('series+position collapses across the two client shapes', collapseWorks(sp).length===1);

// 6. Order preserved by first member; unrelated books untouched.
const ord=[{t:'M',a:'Q'},{t:'N',a:'Q'},{t:'O',a:'Q'}];
check('no signals -> unchanged list and order',
  collapseWorks(ord).map(b=>b.t).join()==='M,N,O');

// 7. Group emitted at position of its FIRST member, not the representative's.
const pos=[
 {t:'First',a:'W'},
 {t:'EN',a:'W',hardcoverId:5,language:'en'},
 {t:'ES',a:'W',hardcoverId:5,language:'es',originalLanguage:'es',coverUrl:'c'},
 {t:'Last',a:'W'},
];
r=collapseWorks(pos,{uiLang:'en'});
check('group holds its first position while showing best rep',
  r.map(b=>b.t).join()==='First,ES,Last', r.map(b=>b.t).join());

// 8. Reader language only breaks ties when original is unknown.
const ui=[
 {t:'EN ed',a:'V',hardcoverId:7,language:'en',coverUrl:'c'},
 {t:'ES ed',a:'V',hardcoverId:7,language:'es',coverUrl:'c'},
];
check('uiLang es picks the Spanish row when no original known',
  collapseWorks(ui,{uiLang:'es'})[0].t==='ES ed');
check('uiLang en picks the English row when no original known',
  collapseWorks(ui,{uiLang:'en'})[0].t==='EN ed');

// 9. A known original beats the reader's language (the rule Simon chose).
const rule=[
 {t:'ES original',a:'U',hardcoverId:8,language:'es',originalLanguage:'es',coverUrl:'c'},
 {t:'EN translation',a:'U',hardcoverId:8,language:'en',originalLanguage:'es',coverUrl:'c'},
];
check('original language wins even for an English reader',
  collapseWorks(rule,{uiLang:'en'})[0].t==='ES original');

// 10. Invalid ISBNs must not group unrelated books.
const bad=[{t:'P',a:'T',isbn:'n/a'},{t:'R',a:'T',isbn:'unknown'}];
check('junk ISBNs do not collapse', collapseWorks(bad).length===2);

// 11. Degenerate input.
check('empty', collapseWorks([]).length===0);
check('null-safe', collapseWorks(null).length===0);
check('drops titleless rows', collapseWorks([{a:'x'},{t:'Real',a:'x'}]).length===1);


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
