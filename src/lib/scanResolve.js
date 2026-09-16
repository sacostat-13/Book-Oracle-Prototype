// scanResolve.js — ISBN → book, for the scanner.
//
// Deliberately thin. The lookup work already exists; this only decides the
// order, caches within the session, and attaches the language signal.
//
// v1 does NOT write a shared isbn → book_id table. That cache is specified in
// claude/isbn-scan-v1-spec.md and is the right next step, but it needs a
// migration and a SECURITY DEFINER RPC, and none of that has to exist for a
// reader to scan their shelf. The in-memory map below gets the repeat-scan win
// within a session at no schema cost.

import { hardcoverLookupByIsbn } from './hardcoverService';
import { googleBooksLookupByIsbn } from './googleBooksService';
import { registrantLanguage } from './isbn';

// isbn → book | null (null is cached too: a miss is worth remembering for the
// length of a scanning session, or re-scanning the same unlisted book re-queries
// both services every time).
const sessionCache = new Map();

export function peekResolved(isbn) {
  return sessionCache.get(isbn);
}

/**
 * Resolve one ISBN to a normalized book object, or null.
 *
 * Confidence is reported but not acted on in v1 beyond flagging the row:
 *   'exact'  — a service matched the ISBN itself
 *   'none'   — nothing matched; the reader gets the ISBN and a manual path
 */
export async function resolveIsbn(isbn) {
  if (!isbn) return { book: null, confidence: 'none' };
  if (sessionCache.has(isbn)) {
    const cached = sessionCache.get(isbn);
    return { book: cached, confidence: cached ? 'exact' : 'none', cached: true };
  }

  let book = null;
  try {
    book = await hardcoverLookupByIsbn(isbn);
  } catch { book = null; }

  if (!book) {
    try {
      book = await googleBooksLookupByIsbn(isbn);
    } catch { book = null; }
  }

  if (book) {
    // Keep the scanned ISBN on the row. It is the edition the reader is
    // physically holding, which is not necessarily the ISBN the lookup
    // returned, and it is what a future reader_editions row is built from.
    book = { ...book, scannedIsbn: isbn, isbn: book.isbn || isbn };

    // The registration group is a free, offline language signal, and for
    // exactly the books our metadata sources are worst at — recent
    // non-Anglophone printings — it is often the only one available.
    if (!book.lang) {
      const guessed = registrantLanguage(isbn);
      if (guessed) book = { ...book, lang: guessed, langFromRegistrant: true };
    }
  }

  sessionCache.set(isbn, book);
  return { book, confidence: book ? 'exact' : 'none' };
}
