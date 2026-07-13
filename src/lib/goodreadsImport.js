// Goodreads CSV import — ported directly from original parseGoodreadsCSV.
// Accepts books on the 'read' shelf or with My Rating > 0 or with a Date Read.
//
// v0.44 (Goodreads import polish):
// - Series suffixes in titles — "The Fellowship of the Ring (The Lord of the
//   Rings, #1)" — are parsed into a proper series object and stripped from the
//   title, so imports match the catalog/API and land with series data intact.
// - Rows are deduped within the CSV itself (re-added editions export as
//   multiple rows); the kept row absorbs rating/date from its duplicates.

import { bookKey } from './bookHelpers';

// "Title (Series Name, #2)" → { title: "Title", series: { name, n } }.
// Handles decimal positions ("#1.5"), a missing comma ("(Dune #2)"), and
// multi-series parentheticals ("(Saga A, #1; Saga B, #3)" — first wins).
// Titles whose parenthetical carries no "#" (e.g. "(Spanish Edition)") are
// left untouched here — bookKey/cleanTitle handle those downstream.
export function splitGoodreadsSeriesTitle(rawTitle) {
  const raw = (rawTitle || '').trim();
  const m = raw.match(/^(.*?)\s*\(([^()]*#[^()]*)\)$/);
  if (!m || !m[1].trim()) return { title: raw, series: null };
  const first = m[2].split(';')[0].trim();
  const sm = first.match(/^(.+?),?\s*#\s*(\d+(?:\.\d+)?)$/);
  if (!sm) return { title: raw, series: null };
  const n = parseFloat(sm[2]);
  return {
    title: m[1].trim(),
    series: { name: sm[1].trim(), n: Number.isFinite(n) ? n : null },
  };
}

// In-CSV dedupe: same normalized title+author appearing twice (different
// editions, re-adds). First occurrence wins its place in the list; missing
// rating/date on the kept row are filled from later duplicates.
function dedupeCSVRows(books) {
  const byKey = new Map();
  const out = [];
  for (const b of books) {
    const k = bookKey(b);
    const kept = byKey.get(k);
    if (!kept) {
      byKey.set(k, b);
      out.push(b);
      continue;
    }
    if (kept.rating == null && b.rating != null) kept.rating = b.rating;
    if (!kept.dateRead && b.dateRead) kept.dateRead = b.dateRead;
    if (!kept.s && b.s) kept.s = b.s;
  }
  return out;
}

function splitCSVLines(text) {
  const lines = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuote = !inQuote;
      cur += ch;
    } else if (ch === '\n' && !inQuote) {
      lines.push(cur);
      cur = '';
    } else if (ch === '\r') {
      // skip
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function parseCSVLine(line) {
  const fields = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.replace(/^="?|"?$/g, '').trim());
}

export function parseGoodreadsCSV(text) {
  const lines = splitCSVLines(text);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const titleIdx = headers.indexOf('Title');
  const authorIdx = headers.indexOf('Author');
  const ratingIdx = headers.indexOf('My Rating');
  const shelfIdx = headers.indexOf('Exclusive Shelf');
  const dateReadIdx = headers.indexOf('Date Read');

  if (titleIdx === -1 || authorIdx === -1) return [];

  const books = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = parseCSVLine(lines[i]);
    const title = (fields[titleIdx] || '').trim();
    const author = (fields[authorIdx] || '').trim();
    const shelf = (fields[shelfIdx] || '').trim().toLowerCase();
    const rating = parseInt(fields[ratingIdx] || '0', 10);
    const dateRead = (fields[dateReadIdx] || '').trim();

    if (!title || !author) continue;
    if (shelf !== 'read' && !(rating > 0) && !dateRead) continue;

    const { title: cleanedTitle, series } = splitGoodreadsSeriesTitle(title);
    books.push({
      t: cleanedTitle,
      a: author,
      rating: rating || null,
      dateRead: dateRead || null,
      fromGoodreads: true,
      ...(series ? { s: series } : {}),
    });
  }
  return dedupeCSVRows(books);
}

// Parses the "to-read" shelf (and "currently-reading") from a Goodreads CSV.
// Used to populate the wishlist on import.
export function parseGoodreadsToReadCSV(text) {
  const lines = splitCSVLines(text);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const titleIdx = headers.indexOf('Title');
  const authorIdx = headers.indexOf('Author');
  const shelfIdx = headers.indexOf('Exclusive Shelf');
  const bookshelvesIdx = headers.indexOf('Bookshelves');

  if (titleIdx === -1 || authorIdx === -1) return [];

  const books = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = parseCSVLine(lines[i]);
    const title = (fields[titleIdx] || '').trim();
    const author = (fields[authorIdx] || '').trim();
    const shelf = (fields[shelfIdx] || '').trim().toLowerCase();
    const bookshelves = (fields[bookshelvesIdx] || '').toLowerCase();

    if (!title || !author) continue;
    // Accept the to-read shelf, or anything tagged to-read / want-to-read in bookshelves
    const isToRead = shelf === 'to-read' ||
                     shelf === 'currently-reading' ||
                     /\b(to-read|want-to-read|wishlist)\b/.test(bookshelves);
    if (!isToRead) continue;

    const { title: cleanedTitle, series } = splitGoodreadsSeriesTitle(title);
    books.push({
      t: cleanedTitle,
      a: author,
      fromGoodreads: true,
      manuallyAdded: true, // surface the ✎ icon in the wishlist row
      ...(series ? { s: series } : {}),
    });
  }
  return dedupeCSVRows(books);
}
