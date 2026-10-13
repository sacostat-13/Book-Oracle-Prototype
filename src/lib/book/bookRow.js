// src/lib/book/bookRow.js — a `books` row (plus its series join) → the client
// book object every view uses (t, a, g, c, p, pp, coverUrl, s, bookId, …).
//
// Moved out of DataContext in Sprint 4 so the domain modules (lists, clubs)
// can map rows without importing the provider. `extra` carries per-shelf
// fields (rating, notes, dateRead, _id, …) and wins over the row.

/**
 * @param {object|null} b      a `books` row, optionally with `series` and `position_in_series`
 * @param {object} [extra]     fields merged last (per-user/shelf data)
 * @returns {object|null}      client book, or null for a missing row
 */
export function bookRowToClient(b, extra = {}) {
  if (!b) return null;
  const series = b.series
    ? {
        name: b.series.name,
        n: b.position_in_series || null,
        total: b.series.total_books || null,
        // v0.15: status replaces verified. 'oracle_categorized' counts as verified in the UI.
        status: b.series.status || 'unreviewed',
        verifiedSource: b.series.verified_source || null,
        verifiedAt: b.series.verified_at || null,
        verifiedBy: b.series.verified_by || null,
        // v0.14: series.status was renamed to publication_status. Old API rows
        // may still have `status` populated with publication state during the
        // brief transition; fall back to it if publication_status is null.
        publicationStatus: b.series.publication_status || 'unknown',
        seriesId: b.series.id,
        fromHardcover: b.series.source === 'hardcover',
        fromOpenLibrary: b.series.source === 'openlibrary',
      }
    : undefined;
  return {
    t: b.title,
    // v0.63: '' rather than the raw null. A null author is correct in the
    // database but interpolates as the string "null" in every template literal
    // that builds a title — see displayAuthor() in bookHelpers for what is
    // actually rendered.
    a: b.author || '',
    g: b.genre || undefined,
    // v0.55: author gender for the "books by women" accomplishment. NOT a
    // genre — deliberately a separate column/field so it never touches the
    // genres/genresByBookId taxonomy. 'unknown' (checked, no signal) is kept
    // undefined here same as other unset enrichment fields.
    ag: (b.author_gender && b.author_gender !== 'unknown') ? b.author_gender : undefined,
    // v0.60.1: `ag` collapses 'unknown' and never-checked into undefined, which
    // is right for display but useless for deciding whether to spend an Oracle
    // call. Without this flag, every book the Oracle honestly answered
    // "unknown" for would look unprocessed forever and be re-billed on every
    // run. The timestamp is stamped for 'unknown' too, so it is the only
    // reliable "we already asked" signal.
    agChecked: !!b.author_gender_checked_at,
    c: b.complexity || undefined,
    p: b.depth || undefined,
    d: b.description || undefined,
    pp: b.pages || undefined,
    coverUrl: b.cover_url || undefined,
    isbn: b.isbn || undefined,
    s: series,
    // v0.15: status replaces verified. 'oracle_categorized' counts as verified in the UI.
    status: b.status || 'unreviewed',
    verifiedSource: b.verified_source || null,
    verifiedAt: b.verified_at || null,
    verifiedBy: b.verified_by || null,
    source: b.source,
    bookId: b.id,
    // v0.64 — carried for collapseWorks (src/lib/book/workGroups.js), which uses
    // them to tell a TRANSLATION of a book already on the shelf from a
    // different book. Nothing renders these; they are identity, not display.
    //
    // hardcover_id is the one that matters most: Hardcover's `books` node is
    // work-level, so two rows sharing it are the same novel even when their
    // titles share no characters — which is the case no title comparison can
    // ever catch.
    hardcoverId: b.hardcover_id ?? undefined,
    goodreadsId: b.goodreads_id ?? undefined,
    language: b.language || undefined,
    originalLanguage: b.original_language || undefined,
    // Round-tripped so cacheBookFields → upsertBookOnServer re-sends what the
    // catalog already knows rather than nothing (20260930140000).
    fy: b.first_published_year ?? undefined,
    ...extra,
  };
}
