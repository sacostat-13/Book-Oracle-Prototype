// Book lookup helpers for bulk import.
//
// ─── THE CHAIN, END TO END (v0.56) ───────────────────────────────────────────
//
// lookupByTitle(title, author) runs these in order. Each stage only exists
// because the one before it missed:
//
//   STAGE 1 — three deterministic sources, in parallel:
//       Hardcover    best metadata + structured series
//       OpenLibrary  broadest coverage, no auth, no rate limit
//       Wikipedia    best descriptions
//     Merged Hardcover > OpenLibrary > Wikipedia. Accepted only if the result's
//     title actually matches what the user typed (TITLE_MATCH_MIN) — Hardcover's
//     fuzzy search returns confident near-misses that must not be imported as
//     the wrong book.
//
//   STAGE 2 — Google Books, one deterministic call, no Claude tokens.
//     The three sources above are English/US-weighted and miss Spanish-language
//     and Latin American indie titles. Last resort only: its covers are
//     low-trust (see googleBooksService.js), so it never competes with stage 1.
//
//   STAGE 3 — Claude repairs the QUERY, then stage 1+2 run again (v0.56).
//     Everything above missed. Historically that ended the chain and created a
//     row from the user's raw input — no ISBN, no cover, and a normalized_key
//     built from a title that isn't the book's real title. Those rows can never
//     be matched or deduplicated afterwards; 206 of ~2,500 books had accumulated
//     that way, each one a dead purchase link and a weak Oracle recommendation.
//
//     Claude is asked ONLY for a canonical title/author — never for a
//     description, ISBN or cover. Those come from the real sources on the retry.
//     So Claude misremembering a detail cannot put bad data in the catalog; the
//     worst it can do is produce a search string that also finds nothing.
//     Guarded by `_retried` so it runs at most once per lookup.
//
//   STAGE 4 — the raw record. `needsReview: true` + `noApiMatch: true`,
//     mapping to status='incomplete' at the upsert site. Users never lose a book
//     they typed in. These rows are what batch-scripts/curateManualBooks.mjs
//     later repairs offline with web search.
//
// ─── WHAT CALLS WHAT ─────────────────────────────────────────────────────────
//
//   lookupByTitle  — Bulk import (titles tab), BookModal, BookPage,
//                    SessionCreate, SessionDetail.  Gets stages 1-4.
//   lookupByAsin   — Bulk import (Amazon URLs tab).  Does NOT get stage 3: an
//                    ASIN is already an exact identifier, so there is no
//                    ambiguous query for Claude to repair.
//
//   BulkImport.jsx adds a FIFTH stage of its own for the titles tab: when a
//   result still comes back noApiMatch, it calls Claude a second time — this
//   time for full book data (title, author, description, genre, series) rather
//   than just a query fix. That produces a usable, reviewable row where this
//   file would return a bare one. It is not redundant with stage 3: it only
//   fires on books stage 3 already failed to rescue.
//
// ─── RATE LIMIT, AND WHY BULK IMPORTS DEGRADE GRACEFULLY ─────────────────────
//
// Stages 3 and 5 both route through feature:'search' — the free Haiku tier,
// which does NOT charge Oracle quota but IS throttled per user (15 calls/60s,
// see netlify/functions/claude.js). A large paste where many titles miss can
// exhaust that: a 100-book import with 30 misses wants up to 60 calls.
//
// This is deliberate and safe. Past the limit the proxy returns 429,
// claudeNormalizeQuery swallows it and returns null, and the book falls through
// to the raw record exactly as it did before v0.56 — no error, no lost book.
// The weekly catalog-maintenance workflow then repairs the remainder offline
// with no rate limit and better tools. Bulk imports get best-effort enrichment;
// the cron guarantees eventual correctness.
//
// PRH dropped in v0.21: narrow catalog, parallel call cost not justified.
//
// Merge is null-fill with ONE special case:
//   description (`d`): Wikipedia wins when other sources are null OR very
//   short (< 200 chars). Wikipedia's lede paragraphs are usually richer.

import { cleanTitle, cleanAuthor } from './bookHelpers';
import {
  hardcoverLookupByIsbn,
  hardcoverLookupByAsin,
  hardcoverSearch,
} from './hardcoverService';
import { wikipediaLookup } from './wikipediaService';
import { googleBooksLookup, bestTitleMatch } from './googleBooksService';
import { callClaudeWithStatus, parseJSONResponse } from './claudeApi';

// A merged Hardcover/OL/Wikipedia result is only trusted if its title actually
// matches what the user typed. Hardcover's fuzzy search returns near-misses
// ("Antes que Morras" for "Morras Malditas", "No apagues la luz" for "Apaguemos
// la luz…") that must not be silently imported. 0.6 rejects a single shared
// common word; segment-aware matching keeps correct "Collective: Title" inputs.
const TITLE_MATCH_MIN = 0.6;

// What counts as a "rich enough" description that we won't let Wikipedia
// overwrite it. Set low enough that one-paragraph blurbs still win, high
// enough that a 4-word stub gets replaced.
const RICH_DESCRIPTION_MIN_CHARS = 200;

// Merge book records. `primary` is the higher-priority source; `secondary`
// fills in nulls. Both can be null/undefined.
function mergeBookData(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  // Start with secondary as base, overlay primary on top, but for fields where
  // primary is null/undefined, keep secondary's value.
  const out = { ...secondary };
  for (const key of Object.keys(primary)) {
    if (primary[key] !== null && primary[key] !== undefined) {
      out[key] = primary[key];
    }
  }
  // Combine source attribution tags so we know what was consulted.
  out.fromHardcover = primary.fromHardcover || secondary.fromHardcover || false;
  out.fromOpenLibrary = primary.fromOpenLibrary || secondary.fromOpenLibrary || false;
  out.fromWikipedia = primary.fromWikipedia || secondary.fromWikipedia || false;
  out.fromGoogleBooks = primary.fromGoogleBooks || secondary.fromGoogleBooks || false;
  return out;
}

// Merge three sources in priority order: a > b > c.
function mergeThree(a, b, c) {
  return mergeBookData(a, mergeBookData(b, c));
}

// v0.10: merge four sources. The first three follow standard priority
// (a > b > c). Wikipedia (`wiki`) is special-cased: it fills nulls
// like any other source, BUT also wins on `description` when the merged
// description from the first three is null or too short to be useful.
function mergeFour(a, b, c, wiki) {
  const baseMerge = mergeThree(a, b, c);
  if (!wiki) return baseMerge;
  if (!baseMerge) {
    // Only Wikipedia hit. That's fine for description, but we want to
    // be careful: Wikipedia alone shouldn't be the entire record because
    // it doesn't provide author, pages, ISBN reliably. Return what we
    // have so the caller can decide.
    return wiki;
  }

  const merged = mergeBookData(baseMerge, wiki);

  // Description override: prefer Wikipedia if the existing description
  // is missing or too short. This is the main reason we added Wikipedia.
  if (wiki.d) {
    const existing = baseMerge.d;
    if (!existing || existing.trim().length < RICH_DESCRIPTION_MIN_CHARS) {
      merged.d = wiki.d;
      merged.descriptionSource = 'wikipedia';
    } else {
      // Existing description is rich enough — keep it.
      merged.d = existing;
    }
  }

  // Preserve Wikipedia's specific fields regardless of overall merge order
  // — these are unique to it and useful in BookModal (v0.11).
  if (wiki.wikipediaUrl) merged.wikipediaUrl = wiki.wikipediaUrl;
  if (wiki.wikipediaLang) merged.wikipediaLang = wiki.wikipediaLang;
  if (wiki.descriptionShort) merged.descriptionShort = wiki.descriptionShort;

  // Wikipedia's thumbnail is low-quality — only use it if NOTHING else
  // produced a cover.
  if (!baseMerge.coverUrl && wiki.coverUrl) {
    merged.coverUrl = wiki.coverUrl;
  } else if (baseMerge.coverUrl) {
    merged.coverUrl = baseMerge.coverUrl;
  }

  return merged;
}

// ---------- Amazon URL parsing ----------

const ASIN_REGEX = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i;

export function extractAsinFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(ASIN_REGEX);
  return m ? m[1].toUpperCase() : null;
}

// ---------- Lookup chain ----------

// Read the current i18n language from localStorage so we can hit
// es.wikipedia first for Spanish-mode users without threading the lang
// through every caller. The I18nContext writes this key on every change.
//
// We do this lazily inside the lookup functions rather than importing
// the I18n context — that keeps bookLookup.js a pure utility module
// that can be called from anywhere (including non-React code paths
// like importGoodreads).
function currentLang() {
  try {
    const stored = localStorage.getItem('book_oracle_lang');
    if (stored === 'es' || stored === 'en') return stored;
  } catch {
    // localStorage might not be available (SSR, private mode, etc.)
  }
  return 'en';
}

// Look up by ASIN (Amazon URL identifier). Tries PRH + Hardcover + OL + Wikipedia.
// `amazonUrl` is preserved on the result so "View on Amazon" keeps working.
//
// Wikipedia for ASIN-only lookups isn't great — we don't know the title yet,
// only the identifier. So for ASIN, Wikipedia only joins the party AFTER one
// of the other sources resolved a title to use as its query.
export async function lookupByAsin(asin, amazonUrl) {
  if (!asin) return null;
  const isbnLike = /^\d{9}[\dX]$/i.test(asin);

  const [hc, ol] = await Promise.all([
    hardcoverLookupByAsin(asin).catch(() => null),
    _lookupByAsinOL(asin).catch(() => null),
  ]);

  const resolvedTitle = hc?.t || ol?.t;
  const resolvedAuthor = hc?.a || ol?.a;
  const wiki = resolvedTitle
    ? await wikipediaLookup(resolvedTitle, resolvedAuthor, currentLang()).catch(() => null)
    : null;

  const merged = mergeThree(hc, ol, wiki);
  if (!merged) return null;

  merged.amazonUrl = amazonUrl || null;
  merged.manuallyAdded = true;
  return merged;
}

// Look up by title (+ optional author). Used for the title-list paste flow.
//
// All four sources fire in parallel here since we already have a title to
// query Wikipedia with.
// Ask Claude for the canonical title/author behind a failed query — a spelling fix, an
// expansion of a partial title, the author a user omitted. Returns null when it can't
// identify the book confidently, which is the correct and expected answer for genuinely
// obscure or self-published titles.
//
// Deliberately NOT asked for a description, ISBN or cover: those come from the real
// sources on the retry. Keeping the output to two fields also keeps it inside the free
// tier's 400-token cap.
async function claudeNormalizeQuery(title, author) {
  const prompt = `A book search failed to match anything in several book databases.
The user typed:
  title: ${JSON.stringify(title)}
  author: ${JSON.stringify(author || null)}

The text may be misspelled, lowercase, truncated, partially remembered, missing the
author, or in a language other than English.

Return ONLY valid JSON, no markdown, no preamble:
{"t": "canonical published title", "a": "primary author's full name"}

Rules:
- Give the title as published: correct capitalisation, no series markers, no subtitle
  after a colon, no edition wording.
- If you cannot confidently identify one specific real book, return exactly: null
- Never invent a plausible-sounding book. null is a correct answer.`;
  const systemPrompt =
    'You identify books from messy user input. Return only valid JSON, no markdown fences. Return null rather than guessing.';

  // { text, unavailable } — see callClaudeWithStatus. `unavailable` is the whole point:
  // it separates "Claude could not identify this" from "Claude never saw it".
  const { text, unavailable } = await callClaudeWithStatus(prompt, systemPrompt, {
    feature: 'search',
    maxTokens: 200,
  });
  if (unavailable) return { fixed: null, unavailable: true };

  const parsed = parseJSONResponse(text);
  if (!parsed || !parsed.t) return { fixed: null, unavailable: false };
  return {
    fixed: { t: String(parsed.t).trim(), a: parsed.a ? String(parsed.a).trim() : null },
    unavailable: false,
  };
}

export async function lookupByTitle(title, author, _retried = false) {
  if (!title) return null;

  // allSettled rather than catch(() => null): a source that THREW did not run, which is
  // a different fact from a source that ran and found nothing. Most of these services
  // swallow their own errors internally, so this catches only outright failures — but
  // those are exactly the ones that would otherwise masquerade as "book doesn't exist".
  const settled = await Promise.allSettled([
    hardcoverSearch(title, author),
    _lookupByTitleOL(title, author),
    wikipediaLookup(title, author, currentLang()),
  ]);
  const sourceFailed = settled.some((r) => r.status === 'rejected');
  const [hc, ol, wiki] = settled.map((r) => (r.status === 'fulfilled' ? r.value : null));

  // Priority: Hardcover > OL > Wikipedia, with description override.
  // BUT only trust it if its title actually matches the query — Hardcover's
  // fuzzy search returns confident near-misses that would otherwise be imported
  // as the wrong book (and mask the Google Books fallback below).
  const merged = mergeThree(hc, ol, wiki);
  if (merged && bestTitleMatch(title, merged.t || '') >= TITLE_MATCH_MIN) {
    merged.manuallyAdded = true;
    return merged;
  }

  // Coverage fallback: the primary chain missed (or only returned a near-miss).
  // Try Google Books —
  // one deterministic call (no Claude tokens), strong on Spanish-language and
  // Latin American titles the English-weighted sources skip. See
  // googleBooksService.js for why it's only used as a last resort.
  const gb = await googleBooksLookup(title, author, currentLang()).catch(() => null);
  if (gb) {
    gb.manuallyAdded = true;
    return gb;
  }

  // v0.56 — LAST RESORT: let Claude repair the QUERY, then run the chain again.
  //
  // Everything above has missed, and historically that meant creating a row from the
  // user's raw input: no ISBN, no cover, no pages, no description, and a normalized_key
  // built from a title that isn't the book's real title. Those rows can never be matched
  // or deduplicated afterwards, and they accumulated to 206 of ~2,500 books before anyone
  // noticed — every one of them a dead purchase link and a weak Oracle recommendation.
  //
  // The important design choice: Claude is used to FIX THE SEARCH STRING, not to supply
  // the book data. The deterministic sources are far more reliable for ISBNs, covers and
  // page counts — they were only failing because the query was misspelled, partial, or
  // missing an author. So we ask Claude for a canonical title/author, then re-run the
  // real chain with it. What gets stored still comes from Hardcover/OpenLibrary/Google
  // Books, so a Claude misremembering can't put a wrong ISBN in the catalog.
  //
  // Routed through feature:'search' — the free Haiku tier, rate limited per user and
  // never charged against Oracle quota (see netlify/functions/claude.js). Deeper repair
  // with web search happens offline in batch-scripts/curateManualBooks.mjs.
  let claudeUnavailable = false;
  if (!_retried) {
    const { fixed, unavailable } = await claudeNormalizeQuery(title, author);
    claudeUnavailable = unavailable;
    const changed = fixed && (
      (fixed.t || '').toLowerCase() !== title.trim().toLowerCase() ||
      (fixed.a || '').toLowerCase() !== (author || '').trim().toLowerCase()
    );
    if (changed) {
      // `_retried` guards the recursion: one correction attempt, never a loop.
      const second = await lookupByTitle(fixed.t, fixed.a || author, true).catch(() => null);
      if (second && !second.noApiMatch) {
        second.manuallyAdded = true;
        second.titleCorrectedByClaude = { from: title, to: fixed.t };
        return second;
      }
    }
  }

  // Nothing found. Record WHY, because the two reasons need different treatment:
  //
  //   noApiMatch        every source ran and none knew the book. A real dead end —
  //                     either a genuinely obscure title or a typo. Worth a human or
  //                     Claude-with-web-search looking at it.
  //
  //   lookupIncomplete  at least one stage never ran: the free-search throttle was
  //                     saturated (15/60s per user, easily hit mid bulk-import), a
  //                     source threw, or quota was spent. NOT evidence the book is
  //                     unfindable. Simply retrying later usually resolves it.
  //
  // Conflating these is what makes "we tried everything, so the title must be wrong"
  // unsafe as a reason to refuse the add.
  const lookupIncomplete = claudeUnavailable || sourceFailed;
  return {
    t: title.trim(),
    a: (author || '').trim() || null,
    g: null,
    d: null,
    pp: null,
    coverUrl: null,
    s: null,
    isbn: null,
    manuallyAdded: true,
    needsReview: true, // v0.15: was `unverified: true`. Maps to status='incomplete' on insert.
    noApiMatch: !lookupIncomplete, // every source ran and missed → a real dead end
    lookupIncomplete,              // a stage never ran → retryable, not a dead end
  };
}

// ---------- OpenLibrary implementations (fallback) ----------

async function _lookupByAsinOL(asin) {
  try {
    const isbnLike = /^\d{9}[\dX]$/i.test(asin);
    if (isbnLike) {
      const r = await fetch(`https://openlibrary.org/isbn/${asin}.json`);
      if (r.ok) {
        const d = await r.json();
        const authors = d.authors
          ? await fetchAuthorNames(d.authors.map((a) => a.key))
          : [];
        return {
          t: d.title || 'Unknown title',
          a: authors[0] || 'Unknown author',
          d: typeof d.description === 'string' ? d.description : d.description?.value || null,
          pp: d.number_of_pages || null,
          fromOpenLibrary: true,
          manuallyAdded: true,
        };
      }
    }

    const r = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(asin)}&limit=1&fields=title,author_name,subject,number_of_pages_median,first_publish_year`
    );
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.docs || d.docs.length === 0) return null;
    const doc = d.docs[0];
    return {
      t: doc.title || 'Unknown title',
      a: (doc.author_name || [])[0] || 'Unknown author',
      g: pickGenreFromSubjects(doc.subject),
      pp: doc.number_of_pages_median || null,
      fromOpenLibrary: true,
      manuallyAdded: true,
    };
  } catch {
    return null;
  }
}

async function fetchAuthorNames(keys) {
  try {
    const names = await Promise.all(
      keys.map(async (k) => {
        const r = await fetch(`https://openlibrary.org${k}.json`);
        if (!r.ok) return null;
        const d = await r.json();
        return d.name || null;
      })
    );
    return names.filter(Boolean);
  } catch {
    return [];
  }
}

async function _lookupByTitleOL(title, author) {
  try {
    let q = `title=${encodeURIComponent(cleanTitle(title))}`;
    if (author) q += `&author=${encodeURIComponent(cleanAuthor(author))}`;
    q += '&limit=3&fields=title,author_name,subject,number_of_pages_median,first_publish_year';
    const r = await fetch(`https://openlibrary.org/search.json?${q}`);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.docs || d.docs.length === 0) return null;

    const target = cleanTitle(title).toLowerCase();
    const best =
      d.docs.find((x) => x.title?.toLowerCase().includes(target)) || d.docs[0];

    return {
      t: best.title,
      a: (best.author_name || [])[0] || author || 'Unknown author',
      g: pickGenreFromSubjects(best.subject),
      pp: best.number_of_pages_median || null,
      fromOpenLibrary: true,
      manuallyAdded: true,
    };
  } catch {
    return null;
  }
}

// ---------- Genre helper ----------

const GENRE_KEYWORDS = [
  ['Horror', /horror|gothic|ghost|haunt/i],
  ['Fantasy', /fantasy|magic|wizard|dragon/i],
  ['Science Fiction', /science fiction|sci-fi|cyberpunk|dystop/i],
  ['Mystery', /mystery|detective|crime|thriller/i],
  ['Romance', /romance|love stor/i],
  ['Literary Fiction', /literary|literature|fiction/i],
  ['Memoir', /memoir|autobiograph/i],
  ['Biography', /biograph/i],
  ['Nonfiction', /history|politics|essays|nonfiction|non-fiction/i],
  ['Poetry', /poetry|poems/i],
  ['Young Adult', /young adult/i],
  ['Graphic Novel', /graphic novel|comic/i],
];

function pickGenreFromSubjects(subjects) {
  if (!subjects || !Array.isArray(subjects)) return null;
  const joined = subjects.slice(0, 30).join(' ');
  for (const [label, rx] of GENRE_KEYWORDS) {
    if (rx.test(joined)) return label;
  }
  return null;
}

// ---------- Title list parser ----------
// Accepts free-form lines and tries to split "Title — Author", "Title - Author",
// "Title by Author". Falls back to the whole line as title.
export function parseTitleList(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  return lines.map((line) => {
    const sep = line.match(/^(.+?)\s+(?:—|–|-|by)\s+(.+)$/i);
    if (sep) {
      return { t: sep[1].trim(), a: sep[2].trim(), raw: line };
    }
    return { t: line, a: null, raw: line };
  });
}
