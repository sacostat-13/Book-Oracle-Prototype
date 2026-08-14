// src/lib/oraclePrompt.js — v0.63.3
//
// Shared prompt construction for every Oracle surface that talks to Claude.
//
// This file exists because v0.63 fixed the "Prompt too long" 413 in
// OracleCategories and nowhere else. The fix — a bounded denylist HINT plus
// exact client-side filtering after the response — was written inline in that
// one view, so OracleAsk and OracleSimilar kept shipping the unbounded
// [...readNext, ...library, ...wishlist] denylist and kept failing for exactly
// the readers the app is built for. A fix that lives in a component is a fix
// for one screen; the same bug still open in two other files is what that
// costs.
//
// Three jobs:
//   1. buildExcludeHint   — a bounded, recency-first denylist sample.
//   2. filterAlreadyKnown — the real guarantee, applied locally to the full
//      shelf after the model answers. Exact, free, and not subject to
//      attention over a wall of comma-separated titles.
//   3. buildShelfSignature — the compact "we know your shelf" block that makes
//      the landing page's claim concrete rather than aspirational.

import { bookKey } from './bookHelpers';

// claude.js rejects anything over MAX_PROMPT_CHARS (50_000) with a 413. The
// rest of an Oracle prompt — taste profile, shelf signature, request — runs
// about 4k characters, so 6k for the denylist sample leaves an order of
// magnitude of headroom and still carries several hundred titles. Sized to be
// obviously safe rather than maximally full: the list is a hint now, and
// doubling it would not make the recommendations better.
export const EXCLUDE_CHAR_BUDGET = 6000;

// Loose enough to catch edition/spacing/punctuation drift between what the
// model returns and what is on the shelf, strict enough not to collapse
// genuinely different books.
//
// This was deliberately un-exported while it lived in OracleCategories, on the
// grounds that a second notion of "same book" leaking out is how identity bugs
// start. That reasoning still holds — which is why it is exported from HERE,
// once, rather than copy-pasted into the two other views that need it.
// `bookKey` remains the canonical identity everywhere else.
export function normalizeTitle(t) {
  return (t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents: "Pedro Páramo" === "Pedro Paramo"
    .replace(/\s*\([^)]*\)\s*$/, '')   // drop a trailing "(Series, #3)"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Recency-first: a book added last week is far likelier to be re-suggested
// than one read in 2011, so if the budget only fits part of the shelf it
// should fit the part that matters. Callers pass `known` as
// [...readNext, ...library, ...wishlist]; readNext is the most immediate
// signal, so it is preserved at the head, and DataContext already returns
// library newest-read-first.
export function buildExcludeHint(known, budget = EXCLUDE_CHAR_BUDGET) {
  const seen = new Set();
  const parts = [];
  let used = 0;

  for (const b of (known || [])) {
    const title = (b?.t || '').trim();
    if (!title) continue;
    const key = normalizeTitle(title);
    if (seen.has(key)) continue;   // the old list shipped duplicates too
    seen.add(key);

    const piece = `"${title}"`;
    const cost = piece.length + 2; // ", "
    if (used + cost > budget) break;
    parts.push(piece);
    used += cost;
  }

  return parts.join(', ') || '(nothing yet)';
}

// The real guarantee that we never recommend a book the reader already has.
// Applied to the FULL shelf rather than to whatever fitted in the character
// budget above.
//
// bookKey is title+author, so it misses the case where the model returns a
// different edition's author string for a book already on the shelf
// ("Jim  Butcher" vs "Jim Butcher"). Title alone is the safety net: a false
// positive costs one suggestion out of the extras we asked for, a false
// negative shows the reader a book they have already read, which is the
// failure they notice.
export function filterAlreadyKnown(books, known) {
  const knownKeys = new Set((known || []).map(bookKey));
  const knownTitles = new Set((known || []).map((b) => normalizeTitle(b?.t)));
  return (books || []).filter(
    (b) => !knownKeys.has(bookKey(b)) && !knownTitles.has(normalizeTitle(b.t))
  );
}

// ---------- shelf signature ----------

const SIG_RECENT_READS = 8;
const SIG_TOP_RATED = 8;
const SIG_RECENT_WISHLIST = 10;
const SIG_QUEUED = 5;

function fmtRead(b) {
  if (!b?.t) return null;
  const author = b.a ? ` by ${b.a}` : '';
  const rating = b.rating ? ` (${b.rating}★)` : '';
  return `${b.t}${author}${rating}`;
}

/**
 * A compact, concrete picture of the reader's actual shelf — roughly 1kB.
 *
 * describeTasteProfile() already compresses the WHOLE library into averages,
 * and that is the statistically honest part of the personalization. But an
 * average is not evidence: "Gothic (4.7★)" cannot produce a reason a reader
 * recognizes, whereas "you gave Piranesi 5★ three weeks ago" can. This block
 * is what lets the Oracle say why in the reader's own terms, and what makes
 * "the Oracle reads your shelf" true as written rather than true-ish.
 *
 * Ordering matters here and is not obvious from the call site:
 *   - state.library arrives read_at DESC  → newest read is index 0.
 *   - state.wishlist arrives added_at ASC → newest add is the LAST element.
 * The previous inline versions had both backwards, so the block labelled
 * "Books they've read recently" carried the fifteen OLDEST reads, and the
 * wishlist sample carried the thirty oldest saves.
 */
export function buildShelfSignature(state, opts = {}) {
  const {
    recentReads = SIG_RECENT_READS,
    topRated = SIG_TOP_RATED,
    recentWishlist = SIG_RECENT_WISHLIST,
    queued = SIG_QUEUED,
  } = opts;

  const library = state?.library || [];
  const wishlist = state?.wishlist || [];
  const readNext = state?.readNext || [];
  const lines = [];

  // Scale first. "412 read, 1204 wanted" is itself a strong signal about who
  // is asking, and it is the cheapest one we have.
  lines.push(
    `The reader's shelves hold ${library.length} finished books, ${wishlist.length} on the wishlist, and ${readNext.length} queued to read next.`
  );

  const recent = library.slice(0, recentReads).map(fmtRead).filter(Boolean);
  if (recent.length > 0) {
    lines.push(`Most recently finished: ${recent.join('; ')}.`);
  }

  // Highest-rated, minus anything already named above — repeating a title
  // inside a 1kB block spends the budget twice for no extra signal.
  const shown = new Set(library.slice(0, recentReads).map((b) => normalizeTitle(b?.t)));
  const loved = library
    .filter((b) => (b.rating || 0) >= 4 && !shown.has(normalizeTitle(b?.t)))
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, topRated)
    .map(fmtRead)
    .filter(Boolean);
  if (loved.length > 0) {
    lines.push(`Loved (rated 4-5★): ${loved.join('; ')}.`);
  }

  const wanted = wishlist
    .slice(-recentWishlist)
    .reverse()
    .map((b) => b?.t)
    .filter(Boolean);
  if (wanted.length > 0) {
    lines.push(`Most recently added to the wishlist: ${wanted.join('; ')}.`);
  }

  const next = readNext.slice(0, queued).map((b) => b?.t).filter(Boolean);
  if (next.length > 0) {
    lines.push(`Queued to read next: ${next.join('; ')}.`);
  }

  return lines.join('\n');
}

// Appended to every recommending system prompt. The match % says how well a
// book fits; this says why, in language the reader can check against their own
// shelf. Kept next to buildShelfSignature deliberately — the instruction is
// only honest if the evidence it asks for is actually in the prompt.
export const REASON_INSTRUCTIONS = `
REASON RULES: Also return "reason" — one sentence, max 25 words, addressed to
the reader, saying why THIS reader would enjoy THIS book right now. Ground it
in something concrete you were told about them: a specific book they finished
or rated highly, a genre they rate well, their stated mood, level or goal.
Never restate the plot — that is what "description" is for — and never pad with
"you might like this because you like books". If you genuinely have nothing
about this reader to point at, say what the book itself does that earns the
recommendation.`;
