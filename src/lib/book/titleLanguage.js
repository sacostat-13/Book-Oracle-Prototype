// titleLanguage.js — guessing a title's language when the row will not say.
//
// A LAST RESORT, AND DELIBERATELY A WEAK ONE
//
// `books.language` is the right answer to "what language is this row", and
// upsert_book has written it since v0.64. But it is NULL on every row that
// predates that migration, and nothing backfills it — so for the existing
// catalog the column cannot answer anything yet.
//
// That gap is visible: "More by this author" on *The Dragon Keeper* showed
// *Aprendiz del Asesino*, *La Nef Du Crépuscule* and *Die Tochter des Wolfs*
// alongside the English Robin Hobb novels. Those are catalog rows whose
// language column is null, so no filter built on it could see them.
//
// This module exists to cover exactly that window, and it is built to become
// irrelevant: callers check `row.language` FIRST and only fall back here when
// it is null. As the column fills in, this code stops being consulted.
//
// HOW IT DECIDES, AND WHY IT IS SO CONSERVATIVE
//
// Function words, not vocabulary. "Asesino" being Spanish is not something we
// can know without a dictionary, but "del" is a Spanish function word that
// appears in a large share of Spanish titles and essentially never in English
// ones. A handful of those carries most of the signal for the languages this
// app actually sees.
//
// Two rules keep it from firing on English:
//
//   1. Markers that are ALSO ordinary English words are excluded outright.
//      German "die", "war", "man", "an", "in", "am" are all English words —
//      "Die Hard", "War and Peace", "The Man in the High Castle" would every
//      one of them be misread as German. So German is detected on "der/des/
//      das/und/von/dem/den/eine/mit/auf", never on "die".
//   2. An English function word anywhere in the title vetoes the guess. English
//      titles are full of "the/of/and/a/to/in", and a title carrying one is not
//      a Spanish title no matter what else it contains.
//
// The residual risk is an English title with no English function word that
// happens to contain a foreign marker — "Los Angeles Noir" would be read as
// Spanish. That is why callers use this to DROP a row from one discovery strip
// and nothing else: the book stays searchable, shelvable and linkable. It must
// never gate identity, dedupe, or anything a reader could not undo by looking.
//
// Returns null for "no idea", which is the common and correct answer.

const MARKERS = {
  // Every entry here is checked against ENGLISH_FUNCTION below: a word that is
  // also English is not a usable marker, however common it is in its own
  // language.
  // 'de' earns its place despite being the weakest entry here. The catalog row
  // that started this is *Aprendiz de asesino* — "de", not "del" — and without
  // it the title carried no signal at all and sailed straight through the
  // filter. It is a preposition in Spanish, French, Portuguese and Italian and
  // a word in none of English, so it is safe; it just cannot say WHICH of the
  // four, which is fine (see guessIsEnglish below for why that is enough).
  es: ['del', 'de', 'los', 'las', 'una', 'unos', 'unas', 'con', 'por', 'para', 'el', 'la', 'y', 'que', 'sus'],
  fr: ['du', 'des', 'les', 'une', 'dans', 'avec', 'le', 'ses', 'aux', 'chez', 'de'],
  de: ['der', 'des', 'das', 'und', 'von', 'dem', 'den', 'eine', 'einen', 'mit', 'auf', 'im'],
  it: ['della', 'delle', 'degli', 'dei', 'con', 'nel', 'una', 'gli', 'di', 'da'],
  pt: ['dos', 'das', 'uma', 'com', 'para', 'nao', 'sao', 'de'],
};

// Markers that belong to exactly one language in the table above. Used only to
// break ties: "des" is French AND German, so *Die Tochter des Wolfs* scored 1-1
// and came back French purely because French is iterated first. "die"/"der" are
// German-only, so a title carrying one of those should win for German.
const UNIQUE = (() => {
  const seen = new Map();
  for (const [lang, ms] of Object.entries(MARKERS)) {
    for (const m of ms) seen.set(m, seen.has(m) ? null : lang);
  }
  return seen;
})();

// Present in a title ⇒ this is English and we do not guess further.
//
// UNAMBIGUOUSLY English only. The first version of this list included the short
// prepositions and articles — a, an, to, in, on, at, by, or, as — and every one
// of them is a word in another language this app actually sees:
//
//   a    Spanish/Portuguese/French/Catalan preposition
//   an   German preposition
//   in   German/Dutch preposition
//   on   French pronoun
//   as   Portuguese feminine plural article
//   or   French noun (gold)
//
// The cost was not theoretical. *Contraataque a los 30* — Spanish, ISBN
// 9788410293540 — was classified English on the strength of "a", which put it
// in the backfill's conflict list and stopped a correct `es` from being
// written. Removing them loses nothing: a title short enough to depend on "a"
// for its English-ness ("A Time to Die") carries no foreign marker either, so
// it returns null and callers treat that as "keep" regardless.
const ENGLISH_FUNCTION = new Set([
  'the', 'of', 'and', 'for', 'with', 'from', 'into', 'upon', 'about',
  'his', 'her', 'their', 'its', 'my', 'your', 'our',
  'who', 'what', 'when', 'where', 'why', 'how',
  'not', 'but', 'out', 'over', 'under', 'after', 'before', 'between',
  'against', 'through', 'never', 'always', 'she', 'they', 'we', 'you',
]);

function words(title) {
  return (title || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Best guess at a title's language, or null when there is no usable signal.
 * Null is the expected answer for most English titles — they simply carry an
 * English function word and are vetoed, which is the same outcome as "no idea"
 * for every caller.
 */
export function guessTitleLanguage(title) {
  const w = words(title);
  if (w.length < 2) return null;               // one word says nothing
  if (w.some((x) => ENGLISH_FUNCTION.has(x))) return null;

  // Score by total markers, then break ties on markers unique to one language.
  // Without the tiebreak the winner is whichever language happens to be listed
  // first, which is how a German title was labelled French.
  let best = null;
  let bestHits = 0;
  let bestUnique = 0;
  for (const [lang, markers] of Object.entries(MARKERS)) {
    const hit = w.filter((x) => markers.includes(x));
    if (hit.length === 0) continue;
    const unique = hit.filter((x) => UNIQUE.get(x) === lang).length;
    if (hit.length > bestHits || (hit.length === bestHits && unique > bestUnique)) {
      bestHits = hit.length; bestUnique = unique; best = lang;
    }
  }
  return bestHits > 0 ? best : null;
}

/**
 * Is this book in a language other than `anchor`?
 *
 * Trusts `book.language` when the row has one and only guesses otherwise, so a
 * populated column always beats the heuristic. Returns false whenever anything
 * is unknown — the caller drops rows on `true`, so uncertainty must mean keep.
 */
export function isForeignTo(book, anchor) {
  if (!anchor) return false;
  const declared = (book?.language || '').toLowerCase();
  if (declared) return declared !== anchor;
  const guessed = guessTitleLanguage(book?.t);
  return !!guessed && guessed !== anchor;
}

/**
 * Coarser and far more reliable than guessTitleLanguage: is this title English?
 * Returns true, false, or null for "no signal".
 *
 * This is the granularity the heuristic is actually trustworthy at. Deciding
 * that *Die Tochter des Wolfs* is German rather than French needs a real
 * language model; deciding it is not English needs one function word. Callers
 * that only have to separate English from everything else — which is most of
 * them — should ask this rather than comparing language codes and inheriting a
 * precision the guess does not have.
 */
export function guessIsEnglish(title) {
  const w = words(title);
  if (w.length < 2) return null;
  if (w.some((x) => ENGLISH_FUNCTION.has(x))) return true;
  for (const markers of Object.values(MARKERS)) {
    if (w.some((x) => markers.includes(x))) return false;
  }
  return null;
}
