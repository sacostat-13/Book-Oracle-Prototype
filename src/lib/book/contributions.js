// Which of a Hardcover book's contributors is the AUTHOR?
//
// THE BUG THIS EXISTS FOR
//
// hardcoverService.js took the first contribution and called it the author:
//
//   const author = (node.contributions || [])
//     .map((c) => c?.author?.name)
//     .filter(Boolean)[0] || null;
//
// Hardcover's contributions are not author-first, and the cost showed up as
// duplicate catalog rows credited to the wrong people. From the 2026-09-10
// Dresden Files query, both created in the preceding fortnight:
//
//   ec760b50  "Death Masks"  by James Marsters   — narrates the audiobooks
//   0dd12f7a  "White Night"  by Chris McGrath    — paints the covers
//
// Each landed on a position the real volume already held, invisible because
// series_volumes shows one row per position. The same bug threw the English
// "House of Sky and Breath" out of a Crescent City proposal on 2026-09-09,
// credited to its narrator Elizabeth Evans. seriesBackfill fixed it by reading
// EVERY contribution and comparing them against a known author; this path has
// to choose ONE name for books.author, so it needs the role.
//
// WHAT THE PROBE ESTABLISHED  (batch-scripts/probes/probeHardcoverContributions.mjs, 2026-09-10)
//
// `contributions.contribution` is a real String field and selecting it works.
// Observed values:
//
//   House of Sky and Breath    Narrator      Elizabeth Evans
//                              Author        Sarah J. Maas
//   A Hat Full of Sky          Author        Terry Pratchett
//                              illustrator   Paul Kidby
//
// Note the casing: "Author" capitalised, "illustrator" not. Hardcover is not
// consistent about it, so every comparison here is case-insensitive.
//
// (That second book is also where our own Wintersmith row got Paul Kidby, and
// why the Tiffany Aching author matching had nothing to work with.)
//
// This module is pure and has no imports, so tests/hardcover-contributions.test.js
// can pin it without pulling the app's data layer in behind it.

// Roles that mean "wrote the words". Hardcover uses "Author"; the others are
// defensive, cost nothing, and cover the obvious variants.
const AUTHOR_ROLE_RE = /^(author|writer|co-?author)$/i;

// Roles that definitely do NOT mean that. Only used to explain a decision --
// the positive test above is what selects.
const NOT_AUTHOR_RE = /^(narrator|illustrator|artist|translator|editor|cover|colorist|letterer|penciller|inker|foreword|introduction|afterword)$/i;

/**
 * The name to credit for a book.
 *
 * @param {Array} contributions  Hardcover contributions, ideally selected as
 *                               `contributions { contribution author { name } }`.
 * @param {object} [opts]
 * @param {boolean} [opts.requireRole=false]
 *        When true, return null unless a contribution is positively identified
 *        as the author by its role. Use this where a better fallback exists --
 *        the search index carries `author_names` and no roles at all, so
 *        guessing from an unroled list there would be no improvement on the bug
 *        this module exists to fix.
 * @returns {string|null}
 */
export function pickAuthorName(contributions, { requireRole = false } = {}) {
  const list = (Array.isArray(contributions) ? contributions : [])
    .filter((c) => c && c.author && typeof c.author.name === 'string' && c.author.name.trim());

  if (!list.length) return null;

  const roleOf = (c) => String(c.contribution ?? '').trim();

  // 1. Someone explicitly credited as the author.
  const authored = list.find((c) => AUTHOR_ROLE_RE.test(roleOf(c)));
  if (authored) return authored.author.name.trim();

  // 2. Nobody says, but nobody is disclaimed either. Older Hardcover records
  //    leave `contribution` null, and a null role on a book whose other
  //    contributors are also unroled is the ordinary "just the author" case.
  const unroled = list.find((c) => roleOf(c) === '');
  if (unroled && !requireRole) return unroled.author.name.trim();

  // 3. Every contributor carries a role and none of them is the author. That is
  //    a real state -- an audiobook edition record, a comics volume credited
  //    only to its artists -- and the honest answer is that we do not know.
  if (requireRole) return null;

  // 4. Last resort, and only where the caller has nothing better: the first
  //    name. This is the old behaviour, kept ONLY for the case where roles are
  //    absent from the payload entirely, so a caller that cannot select
  //    `contribution` is no worse off than before.
  return list[0].author.name.trim();
}

/** Everyone credited, in payload order. For callers that compare against a known author. */
export function allContributorNames(contributions) {
  return (Array.isArray(contributions) ? contributions : [])
    .map((c) => c?.author?.name)
    .filter((n) => typeof n === 'string' && n.trim())
    .map((n) => n.trim());
}

/** Whether a role is one we know is not authorship. Exported for messages and tests. */
export function isNonAuthorRole(role) {
  return NOT_AUTHOR_RE.test(String(role ?? '').trim());
}
