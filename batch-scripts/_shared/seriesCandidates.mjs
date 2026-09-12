// seriesCandidates.mjs — deciding which of Hardcover's "books in this series"
// are actually volumes, and which of those is the one this catalog wants.
//
// Pure. No network, no database, no environment. That is the point: this is the
// half of seriesBackfill.mjs that kept getting it wrong, and a pure function is
// the half a test can hold still.
//
// WHAT HARDCOVER RETURNS
// ----------------------
// A "book" in `book_series` is a work record, not a volume. Translations,
// omnibuses, box sets and split-volume editions each get their own, all attached
// to the series, often all at the same position. Crescent City — a THREE book
// series — comes back with twenty-five.
//
// FILTERS, IN ORDER
//   1. Integer positions only — 1.1 and 2.2 are halves of one volume.
//   2. Bundle/box-set/omnibus titles out, by pattern.
//   3. Omnibus by containment — a title wholly containing another candidate's
//      title is a collection of it. Catches "House of Earth and Blood, House of
//      Sky and Breath", which matches no bundle word.
//   4. Language, when the caller can supply it. A candidate carries the SET of
//      languages it has editions in, and goes only when that set is non-empty
//      and ours is not in it. Unknown never disqualifies anything.
//   5. Author. A translation is very often credited to its translator.
//   6. Page-count outliers, per position, against that position's median.
//
// Then the bundle-quotation signal breaks whatever ties remain: a collection
// edition quotes its volumes in the original language, so a candidate whose
// title appears inside the collection titles THIS series threw out is what those
// collections are made of. `House of Earth and Blood` is quoted in two of them;
// `Dom Ziemi i Krwi` in none. That is what separates an original from a
// translation credited to the SAME author, which the author filter cannot see.
//
// THE AUTHOR FILTER READS EVERY CONTRIBUTION, NOT THE FIRST
// ---------------------------------------------------------
// 2026-09-09, from a real propose run. Hardcover's contributions are not
// author-first, and for an audiobook the first one can be the NARRATOR:
//
//   House of Sky and Breath   768pp   credited to "Elizabeth Evans"
//
// That is the English volume — Elizabeth Evans narrates it — and the filter
// threw it out as "usually a translation". It did no harm only because the
// catalog already held position 2, so the row was never going to be proposed.
// Had position 2 been empty, the filter would have dropped the real book and
// left a translation standing.
//
// So a candidate carries `authors` — every contribution — and matches if ANY of
// them is the series author. A narrator alongside Sarah J. Maas keeps the book;
// a translator instead of her still loses it.
//
// ON "ORIGINAL LANGUAGE"
// ----------------------
// `wantLanguage` is the language THIS CATALOG is written in, not a claim about
// the work. The Books Oracle holds English titles for Japanese works — Ring,
// Love Hina, the JoJo volumes — so English is the right preference there even
// though it is not the original language. A catalog holding the Spanish edition
// of a Spanish novel would want something else, and this function takes the
// answer rather than deciding it.
//
// It is also a question about EDITIONS, not about works. Malazan on 2026-09-09
// deleted eight English volumes as Spanish because a work was assigned the one
// language of the first edition that happened to come back. A work has editions
// in many languages; the only sound question is whether ours is among them.

// A collection does not have to say "bundle" in English. `Sorceleur -
// L'Intégrale` is the complete Witcher saga in French and was pre-approved as
// volume 0 on 2026-09-09 because nothing here matched it.
// LIBRARY EDITION, added 2026-09-10.
//
// THE BUG THIS EXISTS FOR: the queue's Hellboy run. Position 7 offered two
// candidates, both confirmed English, so neither could be picked and the
// position stayed unresolved:
//
//   Hellboy, Library Edition, Vol. 4: The Crooked Man and the Troll Witch  312pp
//   Hellboy, Vol. 7: The Troll Witch and Others                            144pp
//
// The first collects the second. It says so in the title, in the words comics
// publishers actually use — and "library edition", "deluxe edition",
// "compendium" and "treasury" were all missing from a pattern that already knew
// "omnibus" and "intégrale". Containment could not catch it either: it collects
// volumes 7 and 10, and their titles are not substrings of its own.
//
// The cost was not noise in the CSV. Hellboy #7 is a REAL missing volume -- the
// gap the 2026-09-09 diagnostic reported -- and it went unproposed because a
// collection of it was standing at the same position.
export const COLLECTION_RE =
  /\b(bundle|box(ed)? ?set|omnibus|anthology|collection|complete (series|collection)|series set|set of \d+|\d+[- ]book|set books?\b|books? #?\d+\s*[-–—]\s*#?\d+|part \d+ of \d+|vols?\.? \d+\s*[-–—]\s*\d+|int[ée]grale|edizione integrale|obras completas|edici[óo]n completa|gesamtausgabe|opera omnia|samlade|coffret|library edition|deluxe edition|collector['’]?s edition|anniversary edition|compendium|treasury)\b|omnibus/i;

// The trailing `|omnibus` is deliberately OUTSIDE the \b group.
//
// THE BUG THIS EXISTS FOR: Venom: Lethal Protector, 2026-09-17. Position 1
// pre-approved "Venomnibus, Vol. 1" — an omnibus whose name welds the word to
// the front, so `\bomnibus` never matched it. Nothing else in this pattern
// needs the same treatment: "collection" inside "recollection" would be a false
// positive, but no ordinary book title contains "omnibus" as a substring
// without being one.

// A COLLECTIVE NOUN AT THE END OF A TITLE, WITH NOTHING CLAIMING A VOLUME.
//
// THE BUG THIS EXISTS FOR: The Legend of Drizzt, 2026-09-12. Position 4
// pre-approved "The Icewind Dale Trilogy" — 1,040 pages, the omnibus of books
// 4-6 — while "The Crystal Shard", the actual volume 4, sat underneath it as an
// unapproved alternative. Nothing above caught it: "trilogy" was in no pattern,
// and the page-count test compares against the median of the position's OWN
// candidates, seven of whose eight entries were omnibuses (1,040 / 1,031 /
// 1,042 / 1,024 / 1,056 / 1,024 / 900). The median came out at 1,031, so the
// omnibus looked perfectly normal. A median taken over a polluted pool defends
// nothing.
//
// The word alone is not enough, and this is why the rule is about the TAIL. A
// real volume that mentions a trilogy always also names itself:
//
//   REJECT   Vampire Blood Trilogy            The Icewind Dale Trilogy
//   KEEP     The Rogue: The Traitor Spy Trilogy, Book 2
//   KEEP     Servant of the Shard: ... Book 1 of The Sellswords Trilogy
//   KEEP     Ancillary Mercy: The conclusion to the trilogy that began with ...
//   KEEP     Homeland (Forgotten Realms: The Dark Elf Trilogy, #1; ...)
//
// Replayed against every candidate carrying a collective noun in the 2026-09-10,
// -11 and -12 runs: 9 rejected, every one an omnibus; 12 kept, every one a real
// volume. If that ratio ever shifts, this comment is the thing to re-measure.
const COLLECTION_TAIL_RE = /\b(trilogy|duology|tetralogy|quartet|quintet|sextet)\s*$/i;
const VOLUME_MARKER_RE = /\b(book|vol|volume|part|no)\b\.?\s*#?\s*\d|#\s*\d/i;

// True when the title ends in a collective noun and nothing in it claims to be
// one numbered volume.
export const readsAsCollectedSet = (title) => {
  const t = (title || '').trim();
  return COLLECTION_TAIL_RE.test(t) && !VOLUME_MARKER_RE.test(t);
};

// Unicode-aware. It stripped everything outside [a-z0-9], so EVERY Cyrillic or
// Greek title normalised to the empty string: "Дом Цепей" and "Дань псам" were
// the same key, so two Russian volumes at one position silently deduped down to
// one, and every one of them took the `title too short` penalty in
// seriesBackfill for having no ASCII in it. \p{L}\p{N} keeps letters and
// numbers in any script and drops punctuation and spacing as before.
//
// NOT the same function as bookKey() in seriesBackfill.mjs. That one mirrors
// compute_book_key() in SQL and MUST stay ASCII-only to match what the database
// computes; this one only ever compares titles with each other.
export const normTitle = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Goodreads-style titles carry the series and position inside the title itself:
// "Fool Moon (The Dresden Files, #2)", "The Crystal Shard (Forgotten Realms: The
// Icewind Dale, #1; Legend of Drizzt, #4)".
//
// THE BUG THIS EXISTS FOR: The Dresden Files, 2026-09-10. The queue reported
// FOURTEEN position mismatches on a series whose catalog is very nearly right:
//
//   #2   ours "Fool Moon (The Dresden Files, #2)"   theirs "Fool Moon"
//   #3   ours "Grave Peril (The Dresden Files, #3)" theirs "Grave Peril"
//   ...
//
// The same book, thirteen times, reported as a disagreement because an exact
// title comparison saw a suffix. And the fourteenth was REAL -- position 1
// holds the graphic novel while Storm Front, book one of a famous seventeen
// book series, is missing entirely. A signal that cries wolf thirteen times
// buries the one thing it was built to find.
//
// Only a trailing parenthetical containing a # is removed: that shape means
// "series, position" and nothing else. "Overlord (Light Novel)" keeps its own.
export const cleanTitle = (t) => (t || '').replace(/\s*\([^()]*#[^()]*\)\s*$/, '').trim();

// The languages a candidate has editions in, as a deduped array.
//
// Reads `languages` (the set) and falls back to `language` (the single value
// the pre-2026-09-09 shape carried), so a caller that has not been updated,
// and every fixture written against the old shape, still means something
// sensible: one language is a set of one. Unknown is an EMPTY ARRAY and never
// null — "we did not look" and "it is in no language" must not be the same
// value, which is the mistake that started all this.
export const languagesOf = (c) => {
  const raw = Array.isArray(c?.languages)
    ? c.languages
    : (c?.languages ?? c?.language) == null ? [] : [c.languages ?? c.language];
  return [...new Set(raw.filter((l) => l != null && l !== ''))];
};

// Mirrors normalizeSeriesName() in src/lib/seriesService.js and the SQL behind
// series.normalized_name. It lived in seriesBackfill.mjs as a fourth copy; one
// import is one fewer thing to drift.
export const normSeries = (s) =>
  (s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');

/**
 * Which of Hardcover's search hits is our series, and what else did it offer.
 *
 * THE BUG THIS EXISTS FOR: the caller started `bestScore` at -1, so when NO hit
 * matched at all, the FIRST hit won by default and its volumes were fetched as
 * if they were ours. Downstream the name-corroboration guard caught it and set
 * confidence 0, so nothing was ever pre-approved — but the CSV filled with
 * another series' books and said only that the name did not match.
 *
 * A score of 0 now resolves to nothing, and the hits that were offered come
 * back as `nearMisses` so a naming mismatch is diagnosable instead of being
 * reported as "Hardcover has no volume list". Our catalog calls one series
 * "The Icewind Dale"; if Hardcover files it as "Icewind Dale Trilogy" that is a
 * one-line fix, and it is invisible without this.
 */
// A LONGER NAME THAT NAMES A DIFFERENT MEDIUM IS A DIFFERENT SERIES.
//
// THE BUG THIS EXISTS FOR: The Parasol Protectorate, 2026-09-16. Positions 2 and
// 3 pre-approved "Soulless: The Manga, Vol. 2" and "Vol. 3", because containment
// accepted the Hardcover series "The Parasol Protectorate Manga". Those
// positions are Changeless and Blameless. The manga is a real thing with the
// same story and it is not this series.
//
// Containment is right in general — "The Last Apprentice" and "The Last
// Apprentice / Wardstone Chronicles" are the same series under two names — so
// this refuses only the residue that names a FORMAT or an EDITION RUN. Replayed
// against every containment match in six runs:
//
//   REFUSED   manga · collectededitions · singleissues · issues · readingorder
//             · 1993 · 1976 · 2007singleissues
//   KEPT      wardstonechronicles · lastapprentice · trilogy · quartet · a
//             · tothegalaxy · cinder · stainlesssteel · jojosbizarreadventure
//
// `trilogy` and `quartet` stay KEPT on purpose: "The Hollow Kingdom Trilogy" is
// the same series as "The Hollow Kingdom". A collective noun renames a series; a
// format qualifier replaces it.
const FORMAT_QUALIFIER = /^(manga|comics?|graphicnovels?|collectededitions?|singleissues?|issues?|readingorder|audiobooks?|omnibus(es)?|illustrated|adaptations?)+$/;

// True when `got` is `want` plus nothing but format qualifiers and year runs.
export function namesADifferentFormat(want, got) {
  if (!want || !got || got === want || !got.includes(want)) return false;
  const residue = got.replace(want, '').replace(/\d{4}/g, '');
  return residue === '' || FORMAT_QUALIFIER.test(residue);
}

export function rankSeriesHits(hits, wantedName) {
  const want = normSeries(wantedName);
  const scored = (hits || []).map((h) => {
    const doc = h?.document || h;
    const got = normSeries(doc?.name);
    const contains = got && (got.includes(want) || want.includes(got));
    return {
      doc,
      id: doc?.id ?? null,
      name: doc?.name || '',
      score: got === want ? 2 : (contains && !namesADifferentFormat(want, got)) ? 1 : 0,
      exact: got === want,
    };
  });
  return {
    // EVERY plausible hit, best first — not just the winner.
    //
    // THE BUG THIS EXISTS FOR: 2026-09-09. "Marvel Zombies" and "The Icewind
    // Dale" both matched a Hardcover series EXACTLY, and both of those records
    // have no books attached. Returning only the best hit meant stopping at a
    // stub: an exact match to an empty record beat a containing match to the
    // populated one, and the run reported "0 entries" as though Hardcover knew
    // nothing about the series.
    //
    // A name is not an identifier. Hardcover carries several series records
    // under one title, and the useful one is whichever has the books, so the
    // caller walks this list rather than trusting position zero.
    ranked: scored.filter((s) => s.score >= 1 && s.id != null)
      .sort((a, b) => b.score - a.score),
    nearMisses: scored.filter((s) => s.score === 0 && s.name).map((s) => s.name).slice(0, 5),
  };
}

// The top of the ranking, for callers that only want one answer.
export function resolveSeriesHit(hits, wantedName) {
  const { ranked, nearMisses } = rankSeriesHits(hits, wantedName);
  const top = ranked[0] || null;
  return {
    hit: top ? top.doc : null,
    score: top ? top.score : 0,
    exact: !!top?.exact,
    nearMisses,
  };
}

// ONE CREDIT LINE IS NOT ONE AUTHOR.
//
// THE BUG THIS EXISTS FOR: the first --stale queue run, 2026-09-10. Five series,
// 53 proposals, ZERO pre-approved — against 44 out of 46 on the 25-series run a
// day earlier. Discworld: Tiffany Aching was the tell: five proposals, every
// position resolved to a single pick, and not one of them approvable.
//
// Our catalog stores a book's creators as one slash-joined string, and the
// 2026-09-09 diagnostic printed exactly what that looks like:
//
//   Discworld: Tiffany Aching   an_author "Paul Kidby"
//   Hellboy                     an_author "Duncan Fegredo / Dave Stewart / Mike Mignola"
//   Dungeon Crawler Carl        an_author "Erik Wilson / Matt Dinniman"
//
// Compared whole, "duncanfegredodavestewartmikemignola" never equals
// "mikemignola", so every Hellboy volume Hardcover offers is credited to
// nobody we know, and the disowned veto — which cost exactly two rows across 25
// series — vetoed everything. Tiffany Aching is worse: the held books are
// credited to the ILLUSTRATOR, so Terry Pratchett does not match either.
//
// Splitting on the separators a credit line actually uses fixes both. NOT on
// commas: "Erikson, Steven" is one name written backwards, and splitting it
// invents two people.
export const splitAuthors = (value) =>
  String(value || '')
    .split(/\s*[\/;&|]\s*|\s+(?:and|with)\s+/i)
    .map((a) => a.trim())
    .filter((a) => a.length >= 2);

// Every individual name on every credit line a candidate carries.
const authorsOf = (c) =>
  (c.authors && c.authors.length ? c.authors : [c.author])
    .filter(Boolean)
    .flatMap(splitAuthors);

/**
 * @param {Array<{position:number,title:string,author?:string,authors?:string[],
 *                language?:string|number|null,pages:number|null,description:string,
 *                coverUrl:string,hardcoverId:number|null}>} candidates
 * @param {{seriesAuthors?: string[], wantLanguage?: string|number|null}} [opts]
 * @returns {{ byPosition: Map<number, object[]>, rejected: Array<object & {reason:string}> }}
 *          Survivors carry `originality` (how many collection titles quote them)
 *          and `pick` (the unique best at their position).
 */
export function candidatesByPosition(candidates, { seriesAuthors = [], wantLanguage = null, heldTitles = [], seriesName = '' } = {}) {
  const rejected = [];
  let keep = [];

  // The corpus for the containment test: every distinct sibling title, plus the
  // ones the catalog already holds. Held titles matter because an omnibus
  // quotes the volumes it collects, and some of those are volumes we own — for
  // Crescent City the omnibus quotes House of Sky and Breath, which is the one
  // book that series had.
  //
  // DEDUPED. The count used to include duplicate editions, so the run reported
  // "contains 5 other volume title(s)" where the honest number was one.
  //
  // The length floor keeps a short title from being "contained in" everything.
  const allTitles = [...new Set(
    [...candidates.map((c) => c.title), ...heldTitles].map(normTitle)
  )].filter((t) => t.length > 6);
  // The corpus for the originality signal: every title this series threw out as
  // a collection. Built as we go.
  const collectionTitles = [];

  for (const c of candidates) {
    if (!Number.isInteger(c.position)) {
      rejected.push({ ...c, reason: `split edition (position ${c.position})` }); continue;
    }
    if (COLLECTION_RE.test(c.title)) {
      collectionTitles.push(normTitle(c.title));
      rejected.push({ ...c, reason: 'title reads as a bundle or collection' }); continue;
    }
    if (readsAsCollectedSet(c.title)) {
      collectionTitles.push(normTitle(c.title));
      rejected.push({ ...c, reason: 'title ends in a collective noun and claims no volume number — a collected set' }); continue;
    }
    // TWO sibling titles, not one.
    //
    // THE BUG THIS EXISTS FOR: Marvel Zombies, 2026-09-09. Every volume in that
    // series was rejected as a collection and the series proposed nothing. One
    // candidate is titled exactly "Marvel Zombies", so `marvelzombies` is a
    // substring of `marvelzombies2`, `marvelzombiesavengers`,
    // `marvelzombiesbattleworld` — of every sibling it has. Containing ONE
    // sibling title is not a collection, it is the ordinary way a sequel is
    // named, and any series with a volume named after the series does this:
    // Dune, Hellboy, Jaws, Saga, Borne. `Ring` escaped only because four
    // characters is under the length floor.
    //
    // A collection quotes TWO of them — "House of Earth and Blood, House of Sky
    // and Breath" — which is what the filter was always describing and never
    // what it tested. Everything that quotes one and adds a subtitle is a
    // volume, and everything that announces itself in words is COLLECTION_RE's
    // business one branch up.
    const nt = normTitle(c.title);
    const contains = allTitles.filter((t) => t !== nt && nt.includes(t));
    if (contains.length >= 2) {
      collectionTitles.push(nt);
      rejected.push({ ...c, reason: `title quotes ${contains.length} other volume titles — a collection` }); continue;
    }
    keep.push(c);
  }

  // Language: DOES THIS WORK HAVE AN EDITION IN THE LANGUAGE WE WANT — not
  // "is this work in that language", which is a question a work record cannot
  // answer.
  //
  // THE BUG THIS EXISTS FOR: Malazan Book of the Fallen, 2026-09-09. Eight of
  // the ten English volumes were rejected, in the reviewer's own words, as
  // `edition language spa, not eng`:
  //
  //   Gardens of the Moon    spa      Deadhouse Gates   spa
  //   Memories of Ice        spa      House of Chains   spa
  //   The Bonehunters        spa      Toll the Hounds   spa
  //   Dust of Dreams         ita      The Crippled God  ita
  //
  // They are English works with Spanish and Italian editions. The old rule read
  // ONE language off a sample of three arbitrary editions and treated it as the
  // work's language, so which language a book "was" depended on which editions
  // Hardcover happened to return first. Midnight Tides and Reaper's Gale came
  // back `eng` and were pre-approved; their siblings came back `spa` and were
  // deleted. Same series, same author, same shelf — different dice.
  //
  // And the damage was not the missing rows. With the English volume gone, the
  // Russian and Italian translations were left ALONE at their positions and
  // promoted to sole candidate: position 4 proposed "Дом Цепей", 9 "La polvere
  // dei sogni", 10 "Il Dio storpio". A filter aimed at translations had made
  // translations the answer.
  //
  // So `languages` is a SET now, and this asks whether the wanted one is in it.
  // A work is removed only when we have seen its editions and ours is not among
  // them. An empty set is still unknown and still keeps the candidate — the
  // reason that has always been right: Hardcover answers for roughly half a
  // series, and treating "unknown" as "foreign" throws away more originals than
  // translations.
  if (wantLanguage != null) {
    const survivors = [];
    for (const c of keep) {
      const langs = languagesOf(c);
      if (langs.length && !langs.includes(wantLanguage)) {
        rejected.push({ ...c, reason: `editions are ${langs.join(', ')} — no ${wantLanguage} among them` });
      } else survivors.push(c);
    }
    keep = survivors;
  }

  // Editions of one work: same position, same normalised title. Keep the most
  // complete, because that row becomes the catalog entry.
  const byTitle = new Map();
  for (const c of keep) {
    const k = `${c.position}::${normTitle(c.title)}`;
    const prev = byTitle.get(k);
    if (!prev) { byTitle.set(k, c); continue; }
    const score = (x) => (x.coverUrl ? 4 : 0) + (x.pages ? 2 : 0) + (x.description ? 1 : 0) + (languagesOf(x).length ? 1 : 0);
    if (score(c) > score(prev)) byTitle.set(k, c);
  }

  const byPosition = new Map();
  for (const c of byTitle.values()) {
    if (!byPosition.has(c.position)) byPosition.set(c.position, []);
    byPosition.get(c.position).push(c);
  }

  // AUTHOR, PER POSITION — not across the series.
  //
  // THE BUG THIS EXISTS FOR: Marvel Zombies, 2026-09-09. Our catalog credits
  // that series to Robert Kirkman. Hardcover credits its volumes to Arthur
  // Suydam, Fred Van Lente, Kev Walker, Marvel Comics — a different creative
  // team per volume, which is simply what a comics series is. A filter that
  // dropped everything not credited to Kirkman left one position standing out
  // of seven.
  //
  // The filter exists to separate a translation from its original, and that is
  // a question about two rows at the SAME position: when one candidate for
  // volume 2 is credited to Sarah J. Maas and another to Seyhan Dönmez, the
  // second is a translation. It is not a question that can be asked of a
  // volume standing alone — a volume by a different author, with nothing to
  // compare it to, is just a volume by a different author.
  //
  // So the rule became local: at a position where SOME candidate carries the
  // series author, the ones that do not are translations of it. Where none
  // does, there is nothing to say and all of them stay.
  const known = new Set(seriesAuthors.flatMap(splitAuthors).map(normTitle).filter(Boolean));
  if (known.size) {
    for (const [pos, list] of byPosition) {
      const matches = (c) => authorsOf(c).some((a) => known.has(normTitle(a)));
      if (!list.some(matches)) continue;
      const survivors = [];
      for (const c of list) {
        const names = authorsOf(c);
        if (names.length && !matches(c)) {
          rejected.push({ ...c, reason: `credited to ${names.map((n) => `"${n}"`).join(', ')}, none of them the series author, while another candidate for this volume is — usually a translation` });
        } else survivors.push(c);
      }
      byPosition.set(pos, survivors);
    }
  }

  // Page-count outliers, per position, against that position's own median. A
  // 4,379-page "volume" beside three ~800-page ones is a collection whatever it
  // calls itself. Needs three page counts before a median means anything.
  for (const [pos, list] of byPosition) {
    const paged = list.filter((c) => c.pages > 0).map((c) => c.pages).sort((a, b) => a - b);
    if (paged.length < 3) continue;
    const median = paged[Math.floor(paged.length / 2)];
    const kept = [];
    for (const c of list) {
      if (c.pages && c.pages > median * 1.6) {
        collectionTitles.push(normTitle(c.title));
        rejected.push({ ...c, reason: `${c.pages} pages against a median of ${median} — a collection` });
      } else kept.push(c);
    }
    byPosition.set(pos, kept);
  }

  // Originality, and the pick.
  for (const [, list] of byPosition) {
    for (const c of list) {
      const nt = normTitle(c.title);
      c.originality = collectionTitles.filter((t) => t !== nt && t.includes(nt)).length;
      c.pick = false;
      c.pickReason = '';
    }
    // A LONE CANDIDATE IS NOT EVIDENCE.
    //
    // Until 2026-09-09 `list.length === 1` set pick unconditionally: with one
    // candidate there is nothing to compare, so every signal sat idle and the
    // row was pre-approved because Hardcover had filed it at that position.
    // The 25-series run measured what that is worth. Twelve of twenty-four
    // pre-approvals were lone candidates, and half of those were wrong:
    //
    //   Malazan #10        Il Dio storpio            Italian
    //   The Witcher #4     Veža lastovičky           Slovak
    //   The Witcher #0     Sorceleur - L'Intégrale   French omnibus
    //   The Locked Tomb #1 Gideon: a Nona            a translation
    //   Red Rising #7      Red God                   beyond total_books
    //   Night Lords #0     Throne of Lies            position 0
    //
    // Every one of them was credited to the real author — translations name the
    // original author alongside the translator — so the author filter passed
    // them, the language was unknown, and nothing else was looking.
    //
    // So a lone candidate now needs the one thing that is a FACT rather than an
    // inference: a language the API actually reported, matching the one we
    // want. Hardcover answers for roughly half the books in a series, so this
    // gives up perhaps half the automatic picks. That is the correct trade when
    // the alternative is a 50% error rate on exactly the rows a reader would
    // trust most.
    const confirmed = wantLanguage == null
      ? []
      : list.filter((c) => languagesOf(c).includes(wantLanguage));

    if (confirmed.length === 1) {
      confirmed[0].pick = true;
      confirmed[0].pickReason = `has a ${wantLanguage} edition`;
    } else if (list.length === 1) {
      list[0].pickReason = languagesOf(list[0]).length === 0
        ? 'the only candidate, but no language reported — needs a human look'
        : `the only candidate, and its editions are ${languagesOf(list[0]).join(', ')}, not ${wantLanguage}`;
    } else {
      // Two or more, none confirmed (or several confirmed): fall back to the
      // quotation signal, which at least compares them against each other.
      const pool = confirmed.length ? confirmed : list;

      // A VOLUME NAMED AFTER ITS SERIES CANNOT WIN THE QUOTATION SIGNAL.
      //
      // THE BUG THIS EXISTS FOR: A Series of Unfortunate Events, 2026-09-10.
      // Position 1 offered ten candidates, and this picked one titled "A Series
      // of Unfortunate Events" at confidence 100, reason "quoted in 8
      // collection edition(s) of this series". The real book one, The Bad
      // Beginning, sat underneath it as an unapproved alternative.
      //
      // Of course it was quoted eight times. Every box set of this series is
      // called "A Series of Unfortunate Events <something>", so a candidate
      // whose title IS the series name is a substring of all of them by
      // construction. The signal asks "which volume do the collections
      // collect", and a series-named title answers it accidentally and always.
      //
      // Same shape as the Marvel Zombies containment bug, at the other end: a
      // volume named after its series breaks any test that compares titles by
      // substring. There it was rejected for containing its siblings; here it
      // wins for being contained by its collections.
      // CONTAINS, not equals. "A Series of Unfortunate Events Pack" is not the
      // series name exactly, carries no bundle word, and quotes only one
      // sibling title so containment leaves it alone -- yet it is a box set and
      // it competes. Anything with the series name inside it is disqualified
      // from this particular tiebreak.
      //
      // Yes, that also excludes honest volumes like "Marvel Zombies 2". The
      // consequence is the safe one: if every candidate at a position contains
      // the series name, nothing wins by quotation and the position goes to a
      // human -- rather than being decided by a signal that, for these titles,
      // measures nothing but the series' own name.
      // A SHORT SERIES NAME EXCLUDES THE WHOLE SERIES.
      //
      // THE BUG THIS EXISTS FOR: Oz, 2026-09-12. The series name normalises to
      // `oz`, two characters, which is a substring of EVERY English volume in
      // it — Ozma of Oz, Tik-Tok of Oz, The Scarecrow of Oz. So the exclusion
      // below removed all of them and left exactly one candidate that did not
      // contain `oz`: أوزما أميرة أوز, the Arabic edition. It was pre-approved
      // at confidence 100, reason "the only candidate not titled after the
      // series", while "Ozma of Oz" sat underneath it as an alternative.
      //
      // Below four characters the test stops measuring what it was built to
      // measure. Oz was the only series under that length in three runs, so the
      // floor costs nothing measurable and turns this position back into a
      // two-candidate choice that goes to a human.
      const nsName = normTitle(seriesName);
      const eligible = nsName.length >= 4
        ? pool.filter((c) => !normTitle(c.title).includes(nsName))
        : pool;
      const top = eligible.length ? Math.max(...eligible.map((c) => c.originality)) : 0;
      const winners = eligible.filter((c) => c.originality === top);

      if (eligible.length === 1 && pool.length > 1) {
        // Excluding the series-named title left exactly one candidate, so the
        // tiebreak is decided without needing a quotation count at all. The Bad
        // Beginning is quoted in none of the box sets -- they quote the SERIES
        // name, which is the whole problem -- so requiring top > 0 here would
        // disqualify the right answer along with the wrong one.
        eligible[0].pick = true;
        eligible[0].pickReason = 'the only candidate not titled after the series';
      } else if (top > 0 && winners.length === 1) {
        winners[0].pick = true;
        winners[0].pickReason = `quoted in ${top} collection edition(s) of this series`;
      }
    }
    list.sort((a, b) =>
      (Number(b.pick) - Number(a.pick)) ||
      (b.originality - a.originality) ||
      a.title.localeCompare(b.title));
  }

  return { byPosition, rejected };
}
