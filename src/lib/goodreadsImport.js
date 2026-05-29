// Goodreads CSV import — ported directly from original parseGoodreadsCSV.
// Accepts books on the 'read' shelf or with My Rating > 0 or with a Date Read.

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

    books.push({
      t: title,
      a: author,
      rating: rating || null,
      dateRead: dateRead || null,
      fromGoodreads: true,
    });
  }
  return books;
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

    books.push({
      t: title,
      a: author,
      fromGoodreads: true,
      manuallyAdded: true, // surface the ✎ icon in the wishlist row
    });
  }
  return books;
}
