// originalLanguage.js — the pure decisions behind books.original_language.
//
// Everything here is a function of its arguments: no network, no Supabase, no
// process.argv. batch-scripts/scheduled/originalLanguageBackfill.mjs does the
// I/O and calls into this; batch-scripts/probes/originalLanguage.probe.mjs
// exercises it with no I/O at all.
//
// The split is not tidiness. The two rules in this file that can lose data —
// "is this Wikidata item really by this author?" and "are these two rows really
// the same work?" — are the ones a probe most needs to be able to hammer with
// awkward inputs, and they are unreachable inside a script that opens a DB
// connection on import. authorGenderBackfill.mjs's matching logic is still
// stuck inside it for exactly that reason.

// ── Normalisation ────────────────────────────────────────────────────────────

// Diacritics come off both sides of every comparison. Wikidata spells the
// author "Gabriel García Márquez"; the catalog holds that AND "Gabriel Garcia
// Marquez", because the second is what a Goodreads CSV contained. Neither is
// wrong, and the difference must not decide whether a book gets an answer.
export const deburr = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const normPerson = (s) =>
  deburr(s)
    .toLowerCase()
    .replace(/\b(jr|sr|ph ?d|md|dr|mr|mrs|ms)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const normTitleLoose = (s) =>
  deburr(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Author strings that are placeholders rather than people. A row carrying one
// of these cannot have a title match verified against anything, so the backfill
// does not search it at all. The 2026-08-17 postmortem (§4) is what this is
// for: 31 rows store the literal string "Unknown author", it was compared
// against ["A.A. Milne"], and Winnie-the-Pooh was rejected.
export const PLACEHOLDER_AUTHORS = new Set([
  'unknown author', 'unknown', 'anonymous', 'anon', 'various', 'various authors',
  'autor desconocido', 'desconocido', 'varios autores', 'vv aa', 'vvaa', 'aa vv',
  'n a', 'none', 'null', 'undefined',
]);

export function isPlaceholderAuthor(a) {
  const n = normPerson(a);
  return !n || PLACEHOLDER_AUTHORS.has(n);
}

// ── Author verification ──────────────────────────────────────────────────────

// "Gabriel García Márquez" vs "García Márquez, Gabriel" vs "G. García Márquez".
//
// Full-string equality is too strict for a catalog assembled from four lookup
// APIs and a Goodreads importer. A surname-only match is too loose — it would
// accept every King for every King, and this function is the ONLY thing
// standing between a Wikidata search result and a permanent write.
//
// The rule: surnames must match, and the given-name evidence must not
// CONTRADICT. An initial agreeing with a first letter counts as agreement,
// because "G. García Márquez" and "Gabriel García Márquez" are the same person
// and the catalog contains both. Two different full given names on a shared
// surname is a rejection, which is the case worth being strict about.
export function authorLikelySame(catalogAuthor, otherName) {
  const a = normPerson(catalogAuthor);
  const b = normPerson(otherName);
  if (!a || !b) return false;
  if (a === b) return true;

  // "Surname, Given" → "Given Surname" before splitting.
  const flip = (raw) => {
    const s = String(raw || '');
    if (!s.includes(',')) return normPerson(s);
    const [last, ...rest] = s.split(',');
    return normPerson(`${rest.join(' ')} ${last}`);
  };
  const fa = flip(catalogAuthor);
  const fb = flip(otherName);
  if (fa === fb) return true;

  const pa = fa.split(' ').filter(Boolean);
  const pb = fb.split(' ').filter(Boolean);
  if (!pa.length || !pb.length) return false;

  // Spanish and Portuguese names carry two surnames and sources disagree about
  // whether to keep both, so the last token AND the last two joined both count.
  const tail = (p) => [p[p.length - 1], p.slice(-2).join(' ')];
  const [la, la2] = tail(pa);
  const [lb, lb2] = tail(pb);
  if (!(la === lb || la2 === lb2 || la === lb2 || la2 === lb)) return false;

  const ga = pa[0];
  const gb = pb[0];
  if (!ga || !gb) return false;
  if (ga === gb) return true;
  if (ga.length === 1 || gb.length === 1) return ga[0] === gb[0];
  return false;
}

// ── Language codes ───────────────────────────────────────────────────────────

// OpenLibrary uses ISO 639-2, and for a couple of dozen languages 639-2 has TWO
// codes — a bibliographic one from the English name and a terminological one
// from the language's own name. German is "ger" or "deu". OpenLibrary records
// use both, having been imported from many sources over twenty years.
//
// The same table as languageBackfill.mjs carries, kept in step by hand. Merging
// them is a v0.65 chore, not a v0.64 one: languageBackfill is a script that has
// already run against production and is not worth re-testing to save a
// duplicated literal.
export const TO_639_1 = {
  eng: 'en', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de',
  ita: 'it', por: 'pt', dut: 'nl', nld: 'nl', rus: 'ru', jpn: 'ja',
  chi: 'zh', zho: 'zh', kor: 'ko', ara: 'ar', heb: 'he', hin: 'hi',
  swe: 'sv', nor: 'no', dan: 'da', fin: 'fi', isl: 'is', ice: 'is',
  pol: 'pl', cze: 'cs', ces: 'cs', slo: 'sk', slk: 'sk', hun: 'hu',
  rum: 'ro', ron: 'ro', gre: 'el', ell: 'el', tur: 'tr', ukr: 'uk',
  cat: 'ca', baq: 'eu', eus: 'eu', glg: 'gl', lat: 'la', wel: 'cy',
  cym: 'cy', gle: 'ga', bul: 'bg', hrv: 'hr', srp: 'sr', slv: 'sl',
  est: 'et', lav: 'lv', lit: 'lt', tha: 'th', vie: 'vi', ind: 'id',
  msa: 'ms', may: 'ms', per: 'fa', fas: 'fa', afr: 'af', epo: 'eo',
};

// Accepts '/languages/spa', 'spa', 'es', 'es-MX'. Returns a 639-1 subtag or
// null. A two-letter input passes through only if it looks like a language
// code — books.language is documented as holding the primary subtag and
// nothing else, so a truncated country string must not slip in.
export function to6391(raw) {
  const s = String(raw || '').trim().toLowerCase().split('/').pop().split('-')[0];
  if (!s) return null;
  if (s.length === 2) return /^[a-z]{2}$/.test(s) ? s : null;
  return TO_639_1[s] || null;
}

// ── Work grouping, for propagation ───────────────────────────────────────────

// Deliberately NOT src/lib/workGroups.js.
//
// collapseWorks() also groups on series+position and on title similarity, which
// is the right aggressiveness for choosing which of several rows to DISPLAY:
// showing the wrong cover is a cosmetic error that the next render can fix.
// Copying a language onto the wrong row is a permanent data error. So
// propagation uses only the three keys that are shared IDENTIFIERS rather than
// resemblances.
//
// `isValid` is injected so this module stays free of the isbn.js import and the
// probe can run it without one.
export function workKeys(row, isValid = () => true) {
  const keys = [];
  if (row?.hardcover_id) keys.push(`hc:${row.hardcover_id}`);
  if (row?.goodreads_id) keys.push(`gr:${row.goodreads_id}`);
  const isbn = String(row?.isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (isbn && isValid(isbn)) keys.push(`isbn:${isbn}`);
  return keys;
}

/**
 * Work out which rows can inherit an original_language from a sibling row of
 * the same work.
 *
 * A group whose members DISAGREE is poisoned and answers nobody. Two rows
 * sharing a hardcover_id and claiming different original languages is a catalog
 * problem — one of them is mis-linked — and resolving it by majority vote would
 * bury the evidence under a confident wrong answer.
 *
 * Returns { assignments: [{ id, code, viaKey }], poisoned: [key] }.
 */
export function planPropagation(rows, isValid = () => true) {
  const known = new Map();
  const poisoned = new Set();

  for (const r of rows || []) {
    if (!r?.original_language) continue;
    for (const k of workKeys(r, isValid)) {
      if (poisoned.has(k)) continue;
      const prev = known.get(k);
      if (prev && prev !== r.original_language) { poisoned.add(k); known.delete(k); continue; }
      known.set(k, r.original_language);
    }
  }

  const assignments = [];
  for (const r of rows || []) {
    if (!r || r.original_language) continue;
    const hits = workKeys(r, isValid)
      .map((k) => [k, known.get(k)])
      .filter(([, v]) => Boolean(v));
    const codes = new Set(hits.map(([, v]) => v));
    if (codes.size !== 1) continue;
    assignments.push({ id: r.id, code: hits[0][1], viaKey: hits[0][0] });
  }

  return { assignments, poisoned: [...poisoned] };
}

// ── Write precedence ─────────────────────────────────────────────────────────

// Sources a script is never allowed to overwrite, even with --force. Mirrors
// oracleBatch.mjs's HUMAN_SOURCES for author_gender: a value confirmed by hand
// outranks anything inferred, and this list is the only thing enforcing it.
export const HUMAN_SOURCES = ['self_stated', 'verified'];

/**
 * 'write' | 'confirm' | 'conflict' | 'protected'
 *
 * Write-once by default, for oracleBatch's reason: the language García Márquez
 * wrote in does not change, so a second and different answer means one of the
 * two is wrong — and the older one has at least had the chance to be corrected
 * by hand.
 */
export function decideWrite(row, code, { force = false } = {}) {
  if (!code) return 'conflict';
  if (row?.original_language == null) return 'write';
  if (row.original_language === code) return 'confirm';
  if (!force) return 'conflict';
  if (HUMAN_SOURCES.includes(row.original_language_source)) return 'protected';
  return 'write';
}
