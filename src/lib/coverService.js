// Cover-fetching service. Ported from original tryOpenLibrary / tryGoogleBooks / fetchCoverURL.
import { cleanTitle, cleanAuthor } from './bookHelpers';

const coverCache = new Map();

function verifyImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth >= 50 && img.naturalHeight >= 50);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function tryOpenLibrary(title, author) {
  try {
    const q = `title=${encodeURIComponent(cleanTitle(title))}&author=${encodeURIComponent(cleanAuthor(author))}&limit=3`;
    const resp = await fetch(`https://openlibrary.org/search.json?${q}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.docs || data.docs.length === 0) return null;
    for (const doc of data.docs.slice(0, 3)) {
      if (doc.cover_i) {
        const url = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
        if (await verifyImage(url)) return url;
      }
      if (doc.isbn && doc.isbn.length > 0) {
        const url = `https://covers.openlibrary.org/b/isbn/${doc.isbn[0]}-L.jpg`;
        if (await verifyImage(url)) return url;
      }
    }
  } catch {}
  return null;
}

async function tryGoogleBooks(title, author) {
  try {
    const query = encodeURIComponent(
      `intitle:"${cleanTitle(title)}" inauthor:"${cleanAuthor(author)}"`
    );
    const resp = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=3`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.items) return null;
    for (const item of data.items) {
      const img =
        item?.volumeInfo?.imageLinks?.thumbnail ||
        item?.volumeInfo?.imageLinks?.smallThumbnail;
      if (img) {
        const upgraded = img
          .replace(/^http:/, 'https:')
          .replace(/&edge=curl/, '')
          .replace(/&zoom=\d/, '&zoom=1');
        if (await verifyImage(upgraded)) return upgraded;
      }
    }
  } catch {}
  return null;
}

export async function fetchCoverURL(title, author) {
  const key = `${title}|${author}`;
  if (coverCache.has(key)) return coverCache.get(key);
  let url = await tryOpenLibrary(title, author);
  if (!url) url = await tryGoogleBooks(title, author);
  coverCache.set(key, url);
  return url;
}
