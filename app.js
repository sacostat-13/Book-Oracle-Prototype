// ============================================================
// THE WISHLIST ORACLE — application logic
// ============================================================

// ---------- STATE ----------
const STATE_KEY = 'wishlist_oracle_state_v1';

const defaultState = {
  onboarded: false,
  profile: {
    readingLevel: null,   // 1-5
    goal: null,           // 'level-up' | 'explore' | 'random'
    goodreadsImported: false,
  },
  library: [],   // books marked as read [{t, a, g?, c?, p?, fromGoodreads?, rating?}]
  readNext: [],  // queued books [{t, a, g, c, p, d}]
  wishlist: [],  // books I want to read [{t, a, g, c, p, d, s?, amazonUrl?, manuallyAdded?}]
  currentPlan: null, // {timeline, type, books: [{month, t, a, reason}]}
  route: 'dashboard', // current screen
  routeParams: {},
  shelfSortMode: 'recent', // 'recent' | 'genre' | 'complexity' | 'shuffle'
  oracleMode: 'wishlist', // 'wishlist' | 'ai' — Oracle source preference
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // merge with defaults so new fields are present
      return {
        ...defaultState,
        ...parsed,
        profile: { ...defaultState.profile, ...(parsed.profile || {}) },
      };
    }
  } catch (e) {}
  return { ...defaultState };
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (e) {}
}

function resetState() {
  state = { ...defaultState };
  saveState();
  render();
}

// Seed wishlist from catalog if it's empty and user is onboarded.
// Called after onboarding completes and on every load to handle migration from
// older state versions that didn't have a wishlist field.
function seedWishlistIfNeeded() {
  if (state.onboarded && (!state.wishlist || state.wishlist.length === 0)) {
    // Copy the entire catalog, excluding books already in library
    const libraryKeys = new Set(state.library.map(bookKey));
    state.wishlist = ALL_BOOKS.filter(b => !libraryKeys.has(bookKey(b)))
                              .map(b => ({ ...b }));
    saveState();
  }
}

// ---------- BOOK HELPERS ----------
const BOOKS = window.BOOKS_DATA || [];

// dedupe by title
const _seen = new Set();
const ALL_BOOKS = BOOKS.filter(b => {
  const k = b.t.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (_seen.has(k)) return false;
  _seen.add(k);
  return true;
});

const GENRES = [...new Set(ALL_BOOKS.map(b => b.g))].sort();

function bookKey(b) {
  return (b.t || '').toLowerCase().replace(/[^a-z0-9]/g, '') + '|' +
         (b.a || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
}

function isInLibrary(book) {
  const k = bookKey(book);
  return state.library.some(b => bookKey(b) === k);
}

function isInReadNext(book) {
  const k = bookKey(book);
  return state.readNext.some(b => bookKey(b) === k);
}

function isInWishlist(book) {
  const k = bookKey(book);
  return state.wishlist && state.wishlist.some(b => bookKey(b) === k);
}

function findBookByTitle(title) {
  const norm = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Check wishlist first (may include manually-added books not in catalog)
  if (state.wishlist) {
    const inWish = state.wishlist.find(b => b.t.toLowerCase().replace(/[^a-z0-9]/g, '') === norm);
    if (inWish) return inWish;
  }
  return ALL_BOOKS.find(b => b.t.toLowerCase().replace(/[^a-z0-9]/g, '') === norm);
}

// ---------- COVER FETCHING (Open Library → Google Books → placeholder) ----------
const coverCache = new Map();

function verifyImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth >= 50 && img.naturalHeight >= 50);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

function cleanTitle(t) {
  return t.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '')
          .replace(/\s*\/.*$/, '').split(':')[0].trim();
}

function cleanAuthor(a) {
  return (a || '').split(/[,&]|\sand\s/i)[0].trim();
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
  } catch (e) {}
  return null;
}

async function tryGoogleBooks(title, author) {
  try {
    const query = encodeURIComponent(`intitle:"${cleanTitle(title)}" inauthor:"${cleanAuthor(author)}"`);
    const resp = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=3`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.items) return null;
    for (const item of data.items) {
      const img = item?.volumeInfo?.imageLinks?.thumbnail
                || item?.volumeInfo?.imageLinks?.smallThumbnail;
      if (img) {
        const upgraded = img.replace(/^http:/, 'https:').replace(/&edge=curl/, '').replace(/&zoom=\d/, '&zoom=1');
        if (await verifyImage(upgraded)) return upgraded;
      }
    }
  } catch (e) {}
  return null;
}

async function fetchCoverURL(title, author) {
  const key = `${title}|${author}`;
  if (coverCache.has(key)) return coverCache.get(key);
  let url = await tryOpenLibrary(title, author);
  if (!url) url = await tryGoogleBooks(title, author);
  coverCache.set(key, url);
  return url;
}

// ---------- OPEN LIBRARY ENRICHMENT (series + page count) ----------
// Persisted cache so we don't refetch on every page load.
// Key: "title|author" → { series: {name, n} | null, pages: number | null, fetchedAt: iso, miss: bool }
const ENRICH_CACHE_KEY = 'wishlist_oracle_ol_enrich_v1';

function loadEnrichCache() {
  try {
    const raw = localStorage.getItem(ENRICH_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function saveEnrichCache(cache) {
  try {
    localStorage.setItem(ENRICH_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

let enrichCache = loadEnrichCache();

// Parse a series string from Open Library — they come in many shapes:
//   "The Locked Tomb #1", "The Broken Earth, Book One", "Discworld (3)", "Daevabad Trilogy"
// Returns { name, n } or { name, n: null } if no position can be parsed.
function parseSeriesString(s) {
  if (!s || typeof s !== 'string') return null;
  // try "#N" or "Book N" or " N" at end, or "(N)"
  const patterns = [
    /^(.+?)\s*#\s*(\d+(?:\.\d+)?)\s*$/i,
    /^(.+?)\s*,\s*Book\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*$/i,
    /^(.+?)\s*\((\d+)\)\s*$/,
    /^(.+?)\s+Book\s+(\d+)\s*$/i,
    /^(.+?)\s+(\d+(?:\.\d+)?)\s*$/,  // last resort: name + trailing number
  ];
  const wordToNum = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  for (const p of patterns) {
    const m = s.match(p);
    if (m) {
      const name = m[1].trim();
      let n = m[2];
      n = wordToNum[n?.toLowerCase()] || parseFloat(n);
      if (isNaN(n)) n = null;
      // skip noise (single letters, very short names)
      if (name.length >= 3) return { name, n };
    }
  }
  return { name: s.trim(), n: null };
}

async function enrichBookFromOpenLibrary(title, author) {
  const key = `${title}|${author}`;
  if (enrichCache[key]) return enrichCache[key];

  try {
    const q = `title=${encodeURIComponent(cleanTitle(title))}&author=${encodeURIComponent(cleanAuthor(author))}&limit=3&fields=title,author_name,series,number_of_pages_median,first_publish_year`;
    const resp = await fetch(`https://openlibrary.org/search.json?${q}`);
    if (!resp.ok) {
      enrichCache[key] = { series: null, pages: null, miss: true, fetchedAt: new Date().toISOString() };
      saveEnrichCache(enrichCache);
      return enrichCache[key];
    }
    const data = await resp.json();
    if (!data.docs || data.docs.length === 0) {
      enrichCache[key] = { series: null, pages: null, miss: true, fetchedAt: new Date().toISOString() };
      saveEnrichCache(enrichCache);
      return enrichCache[key];
    }

    // Find the first doc that matches well (title contains query title, author name matches)
    const targetTitle = cleanTitle(title).toLowerCase();
    const targetAuthor = cleanAuthor(author).toLowerCase();
    const best = data.docs.find(d =>
      d.title?.toLowerCase().includes(targetTitle) &&
      (d.author_name || []).some(a => a.toLowerCase().includes(targetAuthor))
    ) || data.docs[0];

    let series = null;
    if (best.series && best.series.length > 0) {
      // Open Library returns series as array of strings; pick the first
      series = parseSeriesString(best.series[0]);
    }
    const pages = best.number_of_pages_median || null;

    enrichCache[key] = {
      series,
      pages,
      miss: false,
      fetchedAt: new Date().toISOString(),
    };
    saveEnrichCache(enrichCache);
    return enrichCache[key];
  } catch (e) {
    enrichCache[key] = { series: null, pages: null, miss: true, fetchedAt: new Date().toISOString() };
    saveEnrichCache(enrichCache);
    return enrichCache[key];
  }
}

// Fetch all books in a series from Open Library
const seriesBooksCache = {}; // in-memory only, keyed by series name

async function fetchSeriesBooks(seriesName) {
  if (!seriesName) return [];
  if (seriesBooksCache[seriesName]) return seriesBooksCache[seriesName];

  try {
    // OL doesn't have a clean "books in series" endpoint. The closest is a full-text search.
    const q = `q=${encodeURIComponent(`series:"${seriesName}"`)}&limit=30&fields=title,author_name,series,number_of_pages_median,first_publish_year,cover_i`;
    const resp = await fetch(`https://openlibrary.org/search.json?${q}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    if (!data.docs) return [];

    // Parse each result for its series + position; keep only those that match the series name
    const matches = [];
    const seenKeys = new Set();
    const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetSeries = normalize(seriesName);

    for (const doc of data.docs) {
      if (!doc.series) continue;
      for (const s of doc.series) {
        const parsed = parseSeriesString(s);
        if (!parsed) continue;
        if (normalize(parsed.name) !== targetSeries) continue;
        const author = (doc.author_name || [])[0] || '';
        const k = normalize(doc.title) + '|' + normalize(author).slice(0, 10);
        if (seenKeys.has(k)) continue;
        seenKeys.add(k);
        matches.push({
          t: doc.title,
          a: author,
          s: { name: parsed.name, n: parsed.n || matches.length + 1 },
          pp: doc.number_of_pages_median || null,
          year: doc.first_publish_year || null,
          fromOpenLibrary: true,
        });
        break;
      }
    }

    // Sort by position
    matches.sort((a, b) => {
      const an = a.s.n || 999;
      const bn = b.s.n || 999;
      return an - bn;
    });

    seriesBooksCache[seriesName] = matches;
    return matches;
  } catch (e) {
    return [];
  }
}

// ---------- PLACEHOLDER COVER GENERATOR ----------
const PALETTES = [
  { bg: 'linear-gradient(135deg, #2a1810 0%, #5a2a1f 100%)', accent: '#d4a574' },
  { bg: 'linear-gradient(135deg, #1a2818 0%, #3d4a36 100%)', accent: '#b08c3f' },
  { bg: 'linear-gradient(135deg, #1a1a2e 0%, #2d1b3d 100%)', accent: '#c9a978' },
  { bg: 'linear-gradient(135deg, #3d1818 0%, #6b1a1a 100%)', accent: '#e8dcc0' },
  { bg: 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)', accent: '#b08c3f' },
  { bg: 'linear-gradient(135deg, #2a1a2a 0%, #4a2a4a 100%)', accent: '#d4a574' },
  { bg: 'linear-gradient(135deg, #1a2a2a 0%, #2a3a3a 100%)', accent: '#c9a978' },
  { bg: 'linear-gradient(135deg, #2a2010 0%, #5a4520 100%)', accent: '#e8dcc0' },
];
const ORNAMENTS = ['❦', '✦', '✧', '❧', '☩', '✺', '⚜', '☥', '✠', '❈'];
const SPINE_COLORS = ['#6b1a1a', '#3d4a36', '#2d1b3d', '#4a2a4a', '#2a3a3a', '#5a4520', '#3d2418', '#1a3d4a', '#5a2a1f', '#2a1a2a', '#4a3a1a'];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h<<5)-h) + s.charCodeAt(i) | 0;
  return Math.abs(h);
}

function buildPlaceholder(title, author) {
  const palette = PALETTES[hashStr(title) % PALETTES.length];
  const orn = ORNAMENTS[hashStr(author || '') % ORNAMENTS.length];
  return `
    <div class="placeholder" style="background: ${palette.bg};">
      <div class="ph-ornament" style="color: ${palette.accent};">${orn}</div>
      <div class="ph-title">${escapeHtml(title)}</div>
      <div class="ph-author" style="color: ${palette.accent};">${escapeHtml(author || '')}</div>
      <div class="ph-ornament" style="color: ${palette.accent};">${orn}</div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ---------- TOAST ----------
let toastTimer;
function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------- ROUTING ----------
function go(route, params) {
  state.route = route;
  state.routeParams = params || {};
  saveState();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- CSV PARSER (Goodreads) ----------
// Goodreads CSV columns of interest:
//   Title, Author, My Rating, Exclusive Shelf, Date Read, Bookshelves
// We accept books on the 'read' shelf or with My Rating > 0
function parseGoodreadsCSV(text) {
  const lines = splitCSVLines(text);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
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
      fromGoodreads: true,
    });
  }
  return books;
}

function splitCSVLines(text) {
  // CSV may contain quoted fields with newlines inside
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
      if (inQuote && line[i+1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      fields.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map(f => f.replace(/^="?|"?$/g, '').trim());
}

// ---------- CLAUDE API ----------
async function callClaude(prompt, systemPrompt) {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: systemPrompt || "You are a literary book recommendation expert with deep knowledge of horror, gothic, literary fiction, and Latin American literature.",
        messages: [{ role: "user", content: prompt }],
      })
    });
    if (!response.ok) throw new Error('API request failed');
    const data = await response.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    return text;
  } catch (e) {
    console.error('Claude API error:', e);
    return null;
  }
}

// Parse JSON response that may be wrapped in markdown code fences
function parseJSONResponse(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // try to find a JSON array/object in the text
    const match = cleaned.match(/[\[\{][\s\S]*[\]\}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (e2) {}
    }
    return null;
  }
}

// ---------- ACTIONS ON BOOKS ----------
function addToReadNext(book) {
  if (isInReadNext(book) || isInLibrary(book)) return;
  state.readNext.push(book);
  saveState();
  showToast(`"${book.t}" added to Read Next`);
}

function removeFromReadNext(book) {
  const k = bookKey(book);
  state.readNext = state.readNext.filter(b => bookKey(b) !== k);
  saveState();
}

function markAsRead(book) {
  removeFromReadNext(book);
  // Books leave the wishlist when read (per design decision)
  removeFromWishlist(book, /* silent */ true);
  if (!isInLibrary(book)) {
    state.library.push({ ...book, dateRead: new Date().toISOString() });
    saveState();
    showToast(`"${book.t}" added to your library`);
  }
}

function removeFromLibrary(book) {
  const k = bookKey(book);
  state.library = state.library.filter(b => bookKey(b) !== k);
  saveState();
}

function addToWishlist(book) {
  if (isInWishlist(book) || isInLibrary(book)) return false;
  if (!state.wishlist) state.wishlist = [];
  state.wishlist.push({ ...book });
  saveState();
  showToast(`"${book.t}" added to your wishlist`);
  return true;
}

function removeFromWishlist(book, silent) {
  if (!state.wishlist) return;
  const k = bookKey(book);
  const before = state.wishlist.length;
  state.wishlist = state.wishlist.filter(b => bookKey(b) !== k);
  if (state.wishlist.length < before) {
    saveState();
    if (!silent) showToast(`"${book.t}" removed from wishlist`);
  }
}

// ============================================================
// BOOK DETAIL MODAL
// ============================================================
let modalCurrentBook = null;

function openBookModal(book) {
  modalCurrentBook = book;
  renderBookModal();
  document.body.style.overflow = 'hidden';

  // Fire-and-forget OL enrichment: fetch series + pages if not already cached
  // and not already known from the catalog
  const olKey = `${book.t}|${book.a}`;
  const needsEnrich = !enrichCache[olKey];
  if (needsEnrich) {
    enrichBookFromOpenLibrary(book.t, book.a).then(data => {
      // Re-render the modal if it's still showing the same book and we got new info
      if (modalCurrentBook && bookKey(modalCurrentBook) === bookKey(book)) {
        if ((data.series && data.series.name) || data.pages) {
          renderBookModal();
        }
      }
    });
  }

  // If the book is part of a series, also kick off a series-books fetch
  // so the dot row can grow as data arrives
  const seriesName = book.s?.name || enrichCache[olKey]?.series?.name;
  if (seriesName && !seriesBooksCache[seriesName]) {
    fetchSeriesBooks(seriesName).then(books => {
      if (books.length > 0 && modalCurrentBook && bookKey(modalCurrentBook) === bookKey(book)) {
        renderBookModal();
      }
    });
  }
}

function closeBookModal() {
  modalCurrentBook = null;
  const host = document.getElementById('modal-host');
  if (host) host.innerHTML = '';
  document.body.style.overflow = '';
}

function findSeriesEntries(seriesName) {
  // returns all books known to us that belong to this series
  if (!seriesName) return [];
  const sources = [
    ...ALL_BOOKS,
    ...(state.wishlist || []),
    ...state.library,
    ...state.readNext,
  ];
  // Dedupe by key
  const seen = new Set();
  const entries = [];
  for (const b of sources) {
    if (!b.s || b.s.name !== seriesName) continue;
    const k = bookKey(b);
    if (seen.has(k)) continue;
    seen.add(k);
    entries.push(b);
  }
  entries.sort((a, b) => (a.s.n || 0) - (b.s.n || 0));
  return entries;
}

function computeSimilarBooks(book, limit) {
  // fallback genre + complexity matching, used for the modal's "you might also like"
  const candidates = ALL_BOOKS.filter(c => bookKey(c) !== bookKey(book));
  const scored = candidates.map(c => {
    let score = 0;
    if (book.g && c.g === book.g) score += 3;
    if (book.c && c.c && Math.abs(c.c - book.c) <= 1) score += 2;
    if (book.p && c.p && Math.abs(c.p - book.p) <= 1) score += 1;
    // bonus for same author
    if (book.a && c.a && c.a === book.a) score += 1;
    return { book: c, score };
  }).filter(s => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit || 4).map(s => s.book);
}

function renderBookModal() {
  if (!modalCurrentBook) return;
  const b = modalCurrentBook;
  const host = document.getElementById('modal-host');
  if (!host) return;

  // Try to enrich the book with catalog data if it came from library (might be sparse)
  const enriched = findBookByTitle(b.t) || b;
  const display = { ...enriched, ...b }; // library version's rating/dateRead wins

  // Apply Open Library enrichment if cached
  const olKey = `${display.t}|${display.a}`;
  const olData = enrichCache[olKey];
  if (olData) {
    if (!display.s && olData.series && olData.series.name) {
      display.s = { ...olData.series, fromOpenLibrary: true };
    }
    if (!display.pp && olData.pages) {
      display.pp = olData.pages;
    }
  }

  const inLib = isInLibrary(display);
  const inNext = isInReadNext(display);
  const similar = computeSimilarBooks(display, 4);

  // Series block
  let seriesHTML = '';
  if (display.s && display.s.name) {
    // Find books in this series across wishlist, library, catalog, AND OpenLibrary cache
    let entries = findSeriesEntries(display.s.name);

    // If OL has fetched books for this series, merge in any not already present
    const olEntries = seriesBooksCache[display.s.name] || [];
    for (const olBook of olEntries) {
      if (!entries.some(e => bookKey(e) === bookKey(olBook))) {
        entries.push(olBook);
      }
    }

    // Ensure current book is in the entries list (it may not be in catalog if it was OL-enriched)
    if (!entries.some(e => bookKey(e) === bookKey(display))) {
      entries.push({ ...display });
    }

    // Sort by position
    entries.sort((a, b) => {
      const an = a.s?.n || 999;
      const bn = b.s?.n || 999;
      return an - bn;
    });

    const totalKnown = entries.length;
    const totalBooks = display.s.total || Math.max(totalKnown, display.s.n || totalKnown);

    // Build dots
    const dots = [];
    for (let i = 1; i <= totalBooks; i++) {
      const entry = entries.find(e => e.s?.n === i);
      if (entry) {
        const isCurrent = bookKey(entry) === bookKey(display);
        const read = isInLibrary(entry);
        const queued = isInReadNext(entry);
        const cls = isCurrent ? 'current' : (read ? 'read' : (queued ? 'queued' : ''));
        dots.push(`
          <div class="series-dot ${cls}"
               data-series-key="${bookKey(entry)}"
               title="${escapeHtml(entry.t)}${read ? ' — read' : queued ? ' — queued' : ''}">${i}</div>
        `);
      } else {
        dots.push(`<div class="series-dot" title="Book ${i} (not in your wishlist)">${i}</div>`);
      }
    }
    const readCount = entries.filter(e => isInLibrary(e)).length;
    const sourceLabel = display.s.fromOpenLibrary ? 'detected via Open Library' : 'curated';
    seriesHTML = `
      <div class="book-modal-section">
        <div class="book-modal-section-title">Part of a series · <span style="opacity:0.6; font-size: 0.65rem;">${sourceLabel}</span></div>
        <div class="series-name">${escapeHtml(display.s.name)}</div>
        <div class="series-progress">
          ${dots.join('')}
          <span class="series-progress-text">${readCount}/${totalBooks} read</span>
        </div>
        ${totalKnown < totalBooks
          ? `<div class="series-caveat">${totalKnown} of ${totalBooks} books known to us. <a id="modal-fetch-series" style="color: var(--gilt); cursor: pointer; text-decoration: underline dotted;">Fetch more from Open Library</a></div>`
          : ''
        }
        <div style="margin-top: 0.8rem;">
          <button class="li-action success" id="modal-plan-series">✦ Create a plan to finish this series</button>
        </div>
      </div>
    `;
  }

  // Rating block (Goodreads import or manual)
  let ratingHTML = '';
  if (display.rating) {
    const r = Math.max(1, Math.min(5, parseInt(display.rating, 10)));
    ratingHTML = `
      <div class="book-modal-rating">
        ${'★'.repeat(r)}<span class="empty-stars">${'★'.repeat(5 - r)}</span>
        <span class="rating-label">${display.fromGoodreads ? 'Goodreads rating' : 'Your rating'}</span>
      </div>
    `;
  } else if (inLib && display.fromGoodreads) {
    ratingHTML = `
      <div class="book-modal-rating">
        <span class="empty-stars">★★★★★</span>
        <span class="rating-label">No rating in Goodreads export</span>
      </div>
    `;
  }

  // Actions
  const inWish = isInWishlist(display);
  let actionsHTML = '';
  if (inLib) {
    actionsHTML = `<button class="btn btn-ghost" id="modal-remove-lib">Remove from library</button>`;
  } else if (inNext) {
    actionsHTML = `
      <button class="btn" id="modal-mark-read">✓ Mark as read</button>
      <button class="btn btn-ghost" id="modal-remove-next">Remove from queue</button>
    `;
  } else {
    // Not read, not queued. Show "add to read next" and either "add to wishlist" or "mark as read".
    actionsHTML = `
      <button class="btn" id="modal-add-next">+ Add to Read Next</button>
      ${!inWish ? `<button class="btn btn-gilt" id="modal-add-wishlist">+ Add to Wishlist</button>` : ''}
      <button class="btn btn-ghost" id="modal-mark-read">✓ Mark as read</button>
    `;
  }
  // Amazon link if present
  if (display.amazonUrl) {
    actionsHTML = `<a href="${escapeHtml(display.amazonUrl)}" target="_blank" rel="noopener" class="btn btn-ghost" style="text-decoration: none; display: inline-flex; align-items: center;">↗ View on Amazon</a>` + actionsHTML;
  }

  host.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="book-modal" id="book-modal">
        <button class="book-modal-close" id="modal-close-btn" aria-label="Close">×</button>

        <div class="book-modal-hero">
          <div class="book-modal-cover" id="modal-cover" data-title="${escapeHtml(display.t)}" data-author="${escapeHtml(display.a)}">
            ${buildPlaceholder(display.t, display.a)}
          </div>
          <div class="book-modal-info">
            ${display.g ? `<div class="book-modal-genre">${escapeHtml(display.g)}</div>` : ''}
            <h2 class="book-modal-title">${escapeHtml(display.t)}</h2>
            <div class="book-modal-author">${escapeHtml(display.a)}</div>
            ${ratingHTML}
            <div class="book-modal-meta">
              ${display.c ? `<span class="level-pill">prose ${'●'.repeat(display.c)}${'○'.repeat(5 - display.c)}</span>` : ''}
              ${display.p ? `<span class="level-pill">depth ${'●'.repeat(display.p)}${'○'.repeat(5 - display.p)}</span>` : ''}
              ${display.pp ? `<span class="level-pill">📄 ${display.pp} pages</span>` : ''}
              ${inLib ? '<span class="level-pill" style="background: var(--moss); color: var(--paper); border-color: var(--moss);">✓ Read</span>' : ''}
              ${inNext ? '<span class="level-pill">In Read Next</span>' : ''}
            </div>
          </div>
        </div>

        <div class="book-modal-body">
          ${display.d ? `
            <div class="book-modal-section">
              <div class="book-modal-section-title">Description</div>
              <div class="book-modal-description">${escapeHtml(display.d)}</div>
            </div>
          ` : ''}

          ${seriesHTML}

          ${similar.length > 0 ? `
            <div class="book-modal-section">
              <div class="book-modal-section-title">Similar books</div>
              <div class="similar-mini">
                ${similar.map(s => `
                  <div class="similar-mini-item" data-similar-key="${bookKey(s)}" style="cursor: pointer;">
                    <div>
                      <div class="similar-mini-title">${escapeHtml(s.t)}</div>
                      <div class="similar-mini-author">${escapeHtml(s.a)}${s.g ? ` · ${escapeHtml(s.g)}` : ''}</div>
                    </div>
                    ${isInLibrary(s) ? '<span style="color: var(--moss); font-size: 0.8rem; font-family: monospace;">✓ READ</span>' :
                      isInReadNext(s) ? '<span style="color: var(--gilt); font-size: 0.8rem; font-family: monospace;">✓ QUEUED</span>' :
                      '<span style="color: var(--paper-aged); opacity: 0.5; font-size: 0.8rem; font-family: monospace;">→</span>'}
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>

        <div class="book-modal-actions">
          ${actionsHTML}
        </div>
      </div>
    </div>
  `;

  attachBookModalEvents();
  loadModalCover();
}

function loadModalCover() {
  const coverEl = document.getElementById('modal-cover');
  if (!coverEl) return;
  const title = coverEl.dataset.title;
  const author = coverEl.dataset.author;
  fetchCoverURL(title, author).then(url => {
    if (!url || !modalCurrentBook) return;
    // Only update if modal is still open and on same book
    const current = document.getElementById('modal-cover');
    if (!current) return;
    const realImg = document.createElement('img');
    realImg.alt = title;
    realImg.style.position = 'absolute';
    realImg.style.top = '0';
    realImg.style.left = '0';
    realImg.onload = () => {
      current.classList.add('has-real-cover');
      realImg.classList.add('loaded');
    };
    realImg.src = url;
    current.appendChild(realImg);
  });
}

function attachBookModalEvents() {
  // Close
  const closeBtn = document.getElementById('modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeBookModal);

  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeBookModal();
    });
  }

  // Esc to close
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeBookModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // Actions
  const addNext = document.getElementById('modal-add-next');
  if (addNext) addNext.addEventListener('click', () => {
    const enriched = findBookByTitle(modalCurrentBook.t) || modalCurrentBook;
    addToReadNext(enriched);
    renderBookModal();
    // re-render dashboard nav badges
    const nav = document.querySelector('.topnav');
    if (nav) nav.outerHTML = renderNav();
  });

  const addWishlist = document.getElementById('modal-add-wishlist');
  if (addWishlist) addWishlist.addEventListener('click', () => {
    addToWishlist(modalCurrentBook);
    renderBookModal();
    const nav = document.querySelector('.topnav');
    if (nav) nav.outerHTML = renderNav();
  });

  const markRead = document.getElementById('modal-mark-read');
  if (markRead) markRead.addEventListener('click', () => {
    const enriched = findBookByTitle(modalCurrentBook.t) || modalCurrentBook;
    markAsRead(enriched);
    closeBookModal();
    render(); // full re-render so shelves update
  });

  const removeNext = document.getElementById('modal-remove-next');
  if (removeNext) removeNext.addEventListener('click', () => {
    removeFromReadNext(modalCurrentBook);
    closeBookModal();
    render();
  });

  const removeLib = document.getElementById('modal-remove-lib');
  if (removeLib) removeLib.addEventListener('click', () => {
    if (confirm(`Remove "${modalCurrentBook.t}" from your library?`)) {
      removeFromLibrary(modalCurrentBook);
      closeBookModal();
      render();
    }
  });

  // Create plan to finish series
  const planSeries = document.getElementById('modal-plan-series');
  if (planSeries) planSeries.addEventListener('click', () => {
    // Get the current series name from the modal's resolved display
    const b = modalCurrentBook;
    const olKey = `${b.t}|${b.a}`;
    const seriesName = b.s?.name || enrichCache[olKey]?.series?.name;
    if (!seriesName) return;
    closeBookModal();
    planForm = { type: 'series', target: seriesName, timeline: null };
    go('plan-view', { generating: true });
  });

  // Fetch more series info from Open Library
  const fetchSeriesLink = document.getElementById('modal-fetch-series');
  if (fetchSeriesLink) fetchSeriesLink.addEventListener('click', async () => {
    const b = modalCurrentBook;
    const olKey = `${b.t}|${b.a}`;
    const seriesName = b.s?.name || enrichCache[olKey]?.series?.name;
    if (!seriesName) return;
    fetchSeriesLink.textContent = 'Fetching from Open Library…';
    fetchSeriesLink.style.pointerEvents = 'none';
    delete seriesBooksCache[seriesName]; // force a re-fetch
    const books = await fetchSeriesBooks(seriesName);
    if (modalCurrentBook && bookKey(modalCurrentBook) === bookKey(b)) {
      renderBookModal();
      if (books.length === 0) {
        showToast('Open Library didn\'t return additional books for this series', true);
      } else {
        showToast(`Found ${books.length} books in this series`);
      }
    }
  });

  // Similar book clicks → swap modal
  document.querySelectorAll('[data-similar-key]').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.similarKey;
      const book = ALL_BOOKS.find(b => bookKey(b) === k);
      if (book) {
        // Use library version if we have it (for rating)
        const libVersion = state.library.find(lb => bookKey(lb) === k);
        openBookModal(libVersion || book);
      }
    });
  });

  // Series dot clicks → swap modal to that book
  document.querySelectorAll('[data-series-key]').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.seriesKey;
      if (k === bookKey(modalCurrentBook)) return; // already showing this one
      const book = ALL_BOOKS.find(b => bookKey(b) === k);
      if (book) {
        const libVersion = state.library.find(lb => bookKey(lb) === k);
        openBookModal(libVersion || book);
      }
    });
  });
}

// ============================================================
// RENDER ENGINE
// ============================================================

function render() {
  const app = document.getElementById('app');

  if (!state.onboarded) {
    app.innerHTML = renderOnboarding();
    attachOnboardingEvents();
    return;
  }

  app.innerHTML = renderNav() + '<div class="container" id="page-content"></div>';
  const content = document.getElementById('page-content');

  switch (state.route) {
    case 'dashboard':
      content.innerHTML = renderDashboard();
      attachDashboardEvents();
      break;
    case 'oracle':
      content.innerHTML = renderOracleFork();
      attachOracleForkEvents();
      break;
    case 'oracle-categories':
      content.innerHTML = renderOracleCategories();
      attachOracleCategoriesEvents();
      break;
    case 'oracle-similar':
      content.innerHTML = renderOracleSimilar();
      attachOracleSimilarEvents();
      break;
    case 'plan-create':
      content.innerHTML = renderPlanCreate();
      attachPlanCreateEvents();
      break;
    case 'plan-view':
      content.innerHTML = renderPlanView();
      attachPlanViewEvents();
      break;
    case 'read-next':
      content.innerHTML = renderReadNextList();
      attachReadNextEvents();
      break;
    case 'wishlist':
      content.innerHTML = renderWishlistPage();
      attachWishlistEvents();
      break;
    case 'library':
      content.innerHTML = renderLibraryList();
      attachLibraryEvents();
      break;
    case 'profile':
      content.innerHTML = renderProfile();
      attachProfileEvents();
      break;
    default:
      content.innerHTML = renderDashboard();
      attachDashboardEvents();
  }
}

// ============================================================
// TOP NAV
// ============================================================
function renderNav() {
  const r = state.route;
  const wishCount = (state.wishlist || []).length;
  return `
    <nav class="topnav">
      <div class="brand" data-go="dashboard">The <span class="accent">Wishlist</span> Oracle</div>
      <div class="nav-spacer"></div>
      <div class="nav-links">
        <button class="nav-btn ${r==='wishlist'?'active':''}" data-go="wishlist">
          Wishlist ${wishCount > 0 ? `<span class="nav-badge">${wishCount}</span>` : ''}
        </button>
        <button class="nav-btn ${r==='library'?'active':''}" data-go="library">
          Library ${state.library.length > 0 ? `<span class="nav-badge">${state.library.length}</span>` : ''}
        </button>
        <button class="nav-btn ${r==='read-next'?'active':''}" data-go="read-next">
          Read Next ${state.readNext.length > 0 ? `<span class="nav-badge">${state.readNext.length}</span>` : ''}
        </button>
        <button class="nav-btn ${r==='profile'?'active':''}" data-go="profile">Profile</button>
      </div>
    </nav>
  `;
}

// after every render, wire up nav clicks
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go]');
  if (t) {
    e.preventDefault();
    go(t.dataset.go, t.dataset.params ? JSON.parse(t.dataset.params) : {});
  }
});

// ============================================================
// ONBOARDING
// ============================================================
let onbStep = 1;
let onbData = { readingLevel: null, goal: null, goodreadsBooks: [] };

function renderOnboarding() {
  return `
    <div class="onboarding-wrap">
      <div class="onboarding-card">
        <div class="progress">
          <div class="progress-dot ${onbStep >= 1 ? (onbStep > 1 ? 'done' : 'active') : ''}"></div>
          <div class="progress-dot ${onbStep >= 2 ? (onbStep > 2 ? 'done' : 'active') : ''}"></div>
          <div class="progress-dot ${onbStep === 3 ? 'active' : ''}"></div>
        </div>
        ${onbStep === 1 ? renderOnbStep1() : ''}
        ${onbStep === 2 ? renderOnbStep2() : ''}
        ${onbStep === 3 ? renderOnbStep3() : ''}
      </div>
    </div>
  `;
}

function renderOnbStep1() {
  const levels = [
    { v: 1, title: "Casual companion", sub: "A book a month or two. I like a story that pulls me along — cozy fantasy, thrillers, page-turners." },
    { v: 2, title: "Steady reader", sub: "A book or two a month. Open to most genres if the writing's good. Not afraid of a slow start." },
    { v: 3, title: "Devoted reader", sub: "Reading is a major part of my life. I'll go anywhere a great book takes me — literary, weird, dark, demanding." },
    { v: 4, title: "Literary appetite", sub: "I'll wrestle with Faulkner and Han Kang. Difficult prose is part of the pleasure." },
    { v: 5, title: "Voracious + experimental", sub: "I want to be undone. Bring me the prose that breaks itself open — Donoso, Lispector, Cărtărescu." },
  ];
  return `
    <div class="onb-eyebrow">Step 1 of 3 · Reader profile</div>
    <h1 class="onb-title">What kind of reader are you, right now?</h1>
    <p class="onb-desc">No judgment, no pressure. This just helps us calibrate suggestions and reading plans to where you actually are.</p>
    <div class="choice-grid">
      ${levels.map(l => `
        <button class="choice ${onbData.readingLevel === l.v ? 'selected' : ''}" data-level="${l.v}">
          <div class="choice-title">${l.title}</div>
          <div class="choice-sub">${l.sub}</div>
        </button>
      `).join('')}
    </div>
    <div class="onb-actions">
      <div></div>
      <button class="btn" id="onb-next-1" ${onbData.readingLevel == null ? 'disabled' : ''}>Continue ❦</button>
    </div>
  `;
}

function renderOnbStep2() {
  const imported = onbData.goodreadsBooks.length;
  return `
    <div class="onb-eyebrow">Step 2 of 3 · Your shelves</div>
    <h1 class="onb-title">Bring your reading history with you.</h1>
    <p class="onb-desc">Export your Goodreads library and drop the CSV here. We'll fill your virtual library with what you've already read so suggestions can be smarter — and so the shelves don't start empty.</p>

    <div class="upload-zone" id="upload-zone">
      <input type="file" id="csv-input" class="file-hidden" accept=".csv,text/csv">
      <div class="upload-icon">📚</div>
      <div class="upload-text">${imported > 0 ? `<strong style="color:var(--gilt)">${imported}</strong> books loaded` : 'Drop your goodreads_library_export.csv here'}</div>
      <div class="upload-sub">${imported > 0 ? 'Tap to replace, or continue below' : 'or click to choose a file'}</div>
    </div>
    <div class="upload-help">
      <strong>How to export from Goodreads:</strong> Go to <a href="https://www.goodreads.com/review/import" target="_blank">goodreads.com/review/import</a> → click "Export Library" → wait a moment → download the CSV. <br>
      Don't have one yet? You can <a id="skip-link">skip this step</a> and add books manually later.
    </div>

    <div class="onb-actions">
      <button class="btn btn-ghost" id="onb-back-2">← Back</button>
      <button class="btn" id="onb-next-2">Continue ❦</button>
    </div>
  `;
}

function renderOnbStep3() {
  const goals = [
    { v: 'level-up', title: "Level up my reading", sub: "Stretch me. Build a path that takes me from where I am to something harder, deeper, weirder." },
    { v: 'explore', title: "Get into a new topic or genre", sub: "Introduce me to a category I haven't explored — Korean literature, folk horror, Latin American gothic — with a guided path." },
    { v: 'random', title: "Just give me something to read", sub: "I'm not trying to grow. I want a good book each month, suited to my taste. Surprise me." },
  ];
  return `
    <div class="onb-eyebrow">Step 3 of 3 · Your goal</div>
    <h1 class="onb-title">What are you hoping to get from this?</h1>
    <p class="onb-desc">This shapes the kind of reading plans we'll suggest. You can change it anytime in your profile.</p>
    <div class="choice-grid">
      ${goals.map(g => `
        <button class="choice ${onbData.goal === g.v ? 'selected' : ''}" data-goal="${g.v}">
          <div class="choice-title">${g.title}</div>
          <div class="choice-sub">${g.sub}</div>
        </button>
      `).join('')}
    </div>
    <div class="onb-actions">
      <button class="btn btn-ghost" id="onb-back-3">← Back</button>
      <button class="btn" id="onb-finish" ${onbData.goal == null ? 'disabled' : ''}>Enter the library ❦</button>
    </div>
  `;
}

function attachOnboardingEvents() {
  // Step 1
  document.querySelectorAll('[data-level]').forEach(el => {
    el.addEventListener('click', () => {
      onbData.readingLevel = parseInt(el.dataset.level, 10);
      render();
    });
  });
  const next1 = document.getElementById('onb-next-1');
  if (next1) next1.addEventListener('click', () => { onbStep = 2; render(); });

  // Step 2
  const uploadZone = document.getElementById('upload-zone');
  const csvInput = document.getElementById('csv-input');
  if (uploadZone) {
    uploadZone.addEventListener('click', () => csvInput.click());
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) await handleCSV(file);
    });
  }
  if (csvInput) {
    csvInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) await handleCSV(file);
    });
  }
  const back2 = document.getElementById('onb-back-2');
  if (back2) back2.addEventListener('click', () => { onbStep = 1; render(); });
  const next2 = document.getElementById('onb-next-2');
  if (next2) next2.addEventListener('click', () => { onbStep = 3; render(); });
  const skipLink = document.getElementById('skip-link');
  if (skipLink) skipLink.addEventListener('click', (e) => { e.preventDefault(); onbStep = 3; render(); });

  // Step 3
  document.querySelectorAll('[data-goal]').forEach(el => {
    el.addEventListener('click', () => {
      onbData.goal = el.dataset.goal;
      render();
    });
  });
  const back3 = document.getElementById('onb-back-3');
  if (back3) back3.addEventListener('click', () => { onbStep = 2; render(); });
  const finish = document.getElementById('onb-finish');
  if (finish) finish.addEventListener('click', finishOnboarding);
}

async function handleCSV(file) {
  try {
    const text = await file.text();
    const books = parseGoodreadsCSV(text);
    if (books.length === 0) {
      showToast("Couldn't find any read books in that file. Make sure it's the Goodreads export CSV.", true);
      return;
    }
    onbData.goodreadsBooks = books;
    showToast(`Loaded ${books.length} books from your Goodreads library`);
    render();
  } catch (e) {
    showToast("Couldn't read that file. Try downloading a fresh Goodreads export.", true);
  }
}

function finishOnboarding() {
  state.onboarded = true;
  state.profile.readingLevel = onbData.readingLevel;
  state.profile.goal = onbData.goal;
  state.profile.goodreadsImported = onbData.goodreadsBooks.length > 0;

  // enrich Goodreads books by matching against our catalog (gets genre/complexity tags)
  state.library = onbData.goodreadsBooks.map(gb => {
    const match = findBookByTitle(gb.t);
    if (match) {
      return { ...match, ...gb, dateRead: new Date().toISOString() };
    }
    return { ...gb, g: 'Imported', dateRead: new Date().toISOString() };
  });

  // Seed wishlist from the catalog, excluding what's already read
  seedWishlistIfNeeded();

  saveState();
  state.route = 'dashboard';
  render();
  setTimeout(() => showToast(`Welcome. Your library has ${state.library.length} books on its shelves and your wishlist has ${state.wishlist.length}.`), 400);
}

// ============================================================
// DASHBOARD (Library shelves + CTAs)
// ============================================================
function renderDashboard() {
  const levelNames = { 1: 'Casual', 2: 'Steady', 3: 'Devoted', 4: 'Literary', 5: 'Voracious' };
  const goalNames = {
    'level-up': 'Level up',
    'explore': 'Exploring',
    'random': 'Random monthly',
  };

  return `
    <div class="page-header">
      <div class="page-eyebrow">Your Library</div>
      <h1 class="page-title">Welcome <span class="accent">back</span></h1>
      <div style="margin-top: 0.8rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
        ${state.profile.readingLevel ? `<span class="level-pill">📖 ${levelNames[state.profile.readingLevel]} reader</span>` : ''}
        ${state.profile.goal ? `<span class="level-pill">🎯 ${goalNames[state.profile.goal]}</span>` : ''}
        <span class="level-pill">📚 ${state.library.length} read</span>
        <span class="level-pill">❦ ${state.readNext.length} queued</span>
      </div>
    </div>

    <div class="library-hero">
      ${renderShelves()}
    </div>

    <div class="dashboard-ctas">
      <div class="cta-card" data-go="oracle">
        <div class="cta-ornament">❦</div>
        <h2 class="cta-title">The <span class="accent">Wishlist</span> Oracle</h2>
        <p class="cta-desc">Draw books from the vault — by mood, by category, or by the books you already love.</p>
      </div>
      <div class="cta-card" data-go="plan-create">
        <div class="cta-ornament">✦</div>
        <h2 class="cta-title">Create a <span class="accent">Reading Plan</span></h2>
        <p class="cta-desc">Tell us where you want to go. We'll build a curated, paced path from where you are to where you're headed.</p>
      </div>
    </div>

    ${state.currentPlan ? `
      <div class="list-section">
        <h2>Your Current Plan</h2>
        <div class="list-item" style="border-left-color: var(--blood-bright);">
          <div class="li-num">✦</div>
          <div class="li-content">
            <div class="li-title">${escapeHtml(state.currentPlan.title || 'Active plan')}</div>
            <div class="li-author">${state.currentPlan.books.length} books over ${state.currentPlan.timeline} months</div>
          </div>
          <div class="li-actions">
            <button class="li-action" data-go="plan-view">View →</button>
          </div>
        </div>
      </div>
    ` : ''}
  `;
}

function renderShelves() {
  const sortModes = {
    recent: { label: 'Most recent', icon: '⟲' },
    genre: { label: 'By genre', icon: '◐' },
    complexity: { label: 'By complexity', icon: '▲' },
    shuffle: { label: 'Shuffle', icon: '✦' },
  };
  const mode = state.shelfSortMode || 'recent';
  const modeLabel = sortModes[mode]?.label || 'Most recent';

  // shelf controls (always shown)
  const controls = `
    <div class="shelf-controls">
      <span class="shelf-mode-label">Arranged: <strong>${escapeHtml(modeLabel)}</strong></span>
      <button class="shelf-refresh" id="shelf-refresh-btn" title="Re-arrange shelves">
        ${sortModes[mode]?.icon || '⟲'} <span>Re-arrange</span>
      </button>
    </div>
  `;

  if (state.library.length === 0) {
    return `
      ${controls}
      <div class="library-shelves">
        <div class="shelf">
          <div class="shelf-empty">Your shelves are empty.<br>Read a book or pick from your queue to fill them.</div>
          <div class="shelf-board"></div>
        </div>
        <div class="shelf">
          <div class="shelf-empty">&nbsp;</div>
          <div class="shelf-board"></div>
        </div>
      </div>
    `;
  }

  // sort books by mode
  let books = [...state.library];
  if (mode === 'recent') {
    books.reverse();
  } else if (mode === 'genre') {
    books.sort((a, b) => (a.g || 'zzz').localeCompare(b.g || 'zzz'));
  } else if (mode === 'complexity') {
    books.sort((a, b) => (a.c || 3) - (b.c || 3));
  } else if (mode === 'shuffle') {
    // seeded by Date.now bucket — changes on every refresh
    for (let i = books.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [books[i], books[j]] = [books[j], books[i]];
    }
  }

  // group books into shelves of ~15
  const perShelf = Math.max(10, Math.ceil(books.length / 3));
  const shelves = [];
  for (let i = 0; i < books.length; i += perShelf) {
    shelves.push(books.slice(i, i + perShelf));
  }
  // ensure at least 2 shelves visible
  while (shelves.length < 2) shelves.push([]);

  return `
    ${controls}
    <div class="library-shelves">
      ${shelves.map(shelf => `
        <div class="shelf">
          ${shelf.length === 0
            ? `<div class="shelf-empty">&nbsp;</div>`
            : shelf.map(b => {
                // color by genre if in genre mode, by title hash otherwise
                let color;
                if (mode === 'genre' && b.g) {
                  color = SPINE_COLORS[hashStr(b.g) % SPINE_COLORS.length];
                } else if (mode === 'complexity' && b.c) {
                  // complexity gradient: light → dark
                  const grad = ['#8a6e3a', '#6b1a1a', '#5a2a4a', '#3d2418', '#1a0d08'];
                  color = grad[Math.max(0, Math.min(4, (b.c || 3) - 1))];
                } else {
                  color = SPINE_COLORS[hashStr(b.t) % SPINE_COLORS.length];
                }
                const width = 22 + (hashStr(b.a || '') % 14);
                return `
                  <div class="book-spine"
                       style="--spine-color: ${color}; min-width: ${width}px;"
                       title="${escapeHtml(b.t)} — ${escapeHtml(b.a)}"
                       data-spine-key="${bookKey(b)}">
                    <div class="spine-text">${escapeHtml(b.t.length > 30 ? b.t.slice(0, 28) + '…' : b.t)}</div>
                  </div>
                `;
              }).join('')
          }
          <div class="shelf-board"></div>
        </div>
      `).join('')}
    </div>
  `;
}

function attachDashboardEvents() {
  // shelf re-arrange button cycles through modes
  const refreshBtn = document.getElementById('shelf-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const modes = ['recent', 'genre', 'complexity', 'shuffle'];
      const cur = state.shelfSortMode || 'recent';
      const idx = modes.indexOf(cur);
      // If already on shuffle, stay on shuffle and re-shuffle. Else advance.
      state.shelfSortMode = cur === 'shuffle' ? 'shuffle' : modes[(idx + 1) % modes.length];
      saveState();
      // re-render just the shelf area for smoother UX
      const wrap = document.querySelector('.library-hero');
      if (wrap) {
        wrap.innerHTML = renderShelves();
        attachShelfEvents();
        attachDashboardEvents(); // re-bind refresh button
      } else {
        render();
      }
    });
  }
  attachShelfEvents();
}

function attachShelfEvents() {
  // click on a spine → open book modal
  document.querySelectorAll('[data-spine-key]').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.spineKey;
      const book = state.library.find(b => bookKey(b) === k);
      if (book) openBookModal(book);
    });
  });
}

// ============================================================
// ORACLE FORK
// ============================================================
function renderOracleFork() {
  return `
    <div class="breadcrumb"><a data-go="dashboard">Dashboard</a> · Wishlist Oracle</div>
    <div class="page-header">
      <div class="page-eyebrow">Wishlist Oracle</div>
      <h1 class="page-title">How shall we <span class="accent">divine</span>?</h1>
      <p class="page-subtitle">Two ways to draw books from the vault.</p>
    </div>
    <div class="oracle-fork">
      <div class="cta-card" data-go="oracle-categories">
        <div class="cta-ornament">❦</div>
        <h2 class="cta-title">By <span class="accent">categories</span></h2>
        <p class="cta-desc">Pick a temperament — folk horror, gothic, sapphic, Latin American — and draw three books to choose from.</p>
      </div>
      <div class="cta-card" data-go="oracle-similar">
        <div class="cta-ornament">✦</div>
        <h2 class="cta-title">Based on <span class="accent">other books</span></h2>
        <p class="cta-desc">Tell us 1–3 books you've loved. We'll find others with the same blood in them.</p>
      </div>
    </div>
  `;
}

function attachOracleForkEvents() {}

// ============================================================
// ORACLE — BY CATEGORIES
// ============================================================
let currentDraw = []; // currently displayed cards

function renderOracleCategories() {
  const mode = state.oracleMode || 'wishlist';
  // Available genres = wishlist genres in wishlist mode, all known in AI mode
  const sourceBooks = mode === 'wishlist' ? (state.wishlist || []) : ALL_BOOKS;
  const sourceGenres = [...new Set(sourceBooks.map(b => b.g).filter(Boolean))].sort();
  return `
    <div class="breadcrumb">
      <a data-go="dashboard">Dashboard</a> · <a data-go="oracle">Oracle</a> · By Categories
    </div>
    <div class="page-header">
      <div class="page-eyebrow">By categories</div>
      <h1 class="page-title">Choose a <span class="accent">temperament</span></h1>
      <p class="page-subtitle">Three books drawn fresh, ${mode === 'wishlist' ? 'from your wishlist' : 'from anywhere (AI)'}.</p>
    </div>

    <div class="oracle-mode-toggle">
      <span class="oracle-mode-label">Source:</span>
      <div class="toggle-group">
        <button class="toggle-btn ${mode === 'wishlist' ? 'active' : ''}" data-oracle-mode="wishlist">
          ❦ My wishlist
          <span class="toggle-sub">${(state.wishlist || []).length} books</span>
        </button>
        <button class="toggle-btn ${mode === 'ai' ? 'active' : ''}" data-oracle-mode="ai">
          ✦ AI recommends
          <span class="toggle-sub">may go beyond wishlist</span>
        </button>
      </div>
    </div>

    <section class="controls">
      <div class="field">
        <label for="genre">Temperament</label>
        <select id="genre">
          <option value="all">— All books ${mode === 'wishlist' ? 'in my wishlist' : 'anywhere'} —</option>
          ${sourceGenres.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}
        </select>
      </div>
      <button class="btn" id="drawBtn">Give me a book ❦</button>
    </section>

    <section class="cards" id="cards">
      ${currentDraw.length === 0 ? `
        <div class="empty-state">
          <div class="ornament">❦</div>
          <div class="empty-state-title">Awaiting your choice</div>
          <div class="empty-state-text">Select a temperament above and draw three books.</div>
        </div>
      ` : currentDraw.map(b => renderBookCard(b)).join('')}
    </section>
  `;
}

function attachOracleCategoriesEvents() {
  // Mode toggle
  document.querySelectorAll('[data-oracle-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const newMode = btn.dataset.oracleMode;
      if (newMode === state.oracleMode) return;
      state.oracleMode = newMode;
      currentDraw = []; // reset draw on mode change
      saveState();
      render();
    });
  });

  document.getElementById('drawBtn').addEventListener('click', async () => {
    const genre = document.getElementById('genre').value;
    const mode = state.oracleMode || 'wishlist';

    if (mode === 'ai') {
      // AI mode: ask Claude for 3 books that may go beyond the wishlist
      await drawAIRecommendations(genre);
    } else {
      // Wishlist mode: draw from state.wishlist
      const pool = genre === 'all'
        ? (state.wishlist || [])
        : (state.wishlist || []).filter(b => b.g === genre);
      const inUse = new Set([...state.readNext, ...state.library].map(b => bookKey(b)));
      const available = pool.filter(b => !inUse.has(bookKey(b)));
      if (available.length === 0) {
        showToast("Nothing left to draw in that category. Try another, or switch to AI mode.", true);
        return;
      }
      const shuffled = [...available].sort(() => Math.random() - 0.5);
      currentDraw = shuffled.slice(0, Math.min(3, shuffled.length));
      document.getElementById('cards').innerHTML = currentDraw.map(b => renderBookCard(b)).join('');
      attachCardEvents();
      loadCoversForVisibleCards();
    }
  });
  attachCardEvents();
  loadCoversForVisibleCards();
}

async function drawAIRecommendations(genre) {
  const cardsEl = document.getElementById('cards');
  if (cardsEl) {
    cardsEl.innerHTML = `
      <div class="loading" style="grid-column: 1 / -1;">
        <div class="loading-spinner"></div>
        <div class="loading-text">The oracle is divining…</div>
      </div>
    `;
  }

  const profileLevel = state.profile.readingLevel || 3;
  const libContext = state.library.slice(-15).map(b => `- ${b.t} by ${b.a}`).join('\n') || '(none)';
  const wishContext = (state.wishlist || []).slice(0, 30).map(b => `- ${b.t}`).join('\n') || '(none)';
  const exclude = [...state.readNext, ...state.library, ...(state.wishlist || [])]
    .map(b => `"${b.t}"`).join(', ');

  const genreHint = genre === 'all'
    ? "Any genre that suits the reader."
    : `Genre/category: ${genre}.`;

  const prompt = `Recommend 3 books for a reader at reading level ${profileLevel}/5 (1=casual, 5=experimental).
${genreHint}

Books they've read recently:
${libContext}

Books currently on their wishlist (to give you a sense of taste — feel free to go beyond these):
${wishContext}

Do NOT recommend any book in this list (already known to them): ${exclude}

Return ONLY valid JSON in this format:
{"books":[{"title":"...","author":"...","genre":"...","complexity":1-5,"depth":1-5,"description":"one-sentence description"}]}`;

  const response = await callClaude(prompt,
    "You are a literary curator. Recommend books accurately. Always return valid JSON."
  );

  let books = null;
  if (response) {
    const parsed = parseJSONResponse(response);
    if (parsed && parsed.books && Array.isArray(parsed.books)) {
      books = parsed.books.map(b => ({
        t: b.title, a: b.author, g: b.genre || (genre !== 'all' ? genre : 'Recommended'),
        c: b.complexity, p: b.depth, d: b.description,
        aiSuggested: true,
      })).filter(b => b.t && b.a);
    }
  }

  if (!books || books.length === 0) {
    showToast("Couldn't reach the AI. Falling back to your wishlist.", true);
    // Fall back to wishlist draw
    const pool = genre === 'all' ? (state.wishlist || []) : (state.wishlist || []).filter(b => b.g === genre);
    const inUse = new Set([...state.readNext, ...state.library].map(b => bookKey(b)));
    const available = pool.filter(b => !inUse.has(bookKey(b)));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    currentDraw = shuffled.slice(0, Math.min(3, shuffled.length));
  } else {
    currentDraw = books;
  }

  if (cardsEl) {
    cardsEl.innerHTML = currentDraw.length > 0
      ? currentDraw.map(b => renderBookCard(b)).join('')
      : `<div class="empty-state" style="grid-column: 1 / -1;">
           <div class="ornament">❦</div>
           <div class="empty-state-title">No suggestions</div>
           <div class="empty-state-text">Try a different category or switch back to wishlist mode.</div>
         </div>`;
    attachCardEvents();
    loadCoversForVisibleCards();
  }
}

// ============================================================
// ORACLE — SIMILAR (based on other books)
// ============================================================
let similarSelection = []; // up to 3 books
let similarResults = null; // {books: [...], source: 'ai'|'fallback'}
let similarLoading = false;

function renderOracleSimilar() {
  const mode = state.oracleMode || 'wishlist';
  // The "seed" picker shows books the user has read or has wishlisted (their taste)
  // The "results" pool depends on mode
  const querySource = state.library.length > 0
    ? [...state.library, ...(state.wishlist || [])].slice(0, 80)
    : (state.wishlist || []).slice(0, 80);
  return `
    <div class="breadcrumb">
      <a data-go="dashboard">Dashboard</a> · <a data-go="oracle">Oracle</a> · Similar Books
    </div>
    <div class="page-header">
      <div class="page-eyebrow">Based on other books</div>
      <h1 class="page-title">Pick <span class="accent">1–3 books</span> you've loved</h1>
      <p class="page-subtitle">${mode === 'wishlist' ? "We'll find kindred books from your wishlist." : "We'll ask the AI to suggest kindred books (may go beyond your wishlist)."}</p>
    </div>

    <div class="oracle-mode-toggle">
      <span class="oracle-mode-label">Source:</span>
      <div class="toggle-group">
        <button class="toggle-btn ${mode === 'wishlist' ? 'active' : ''}" data-oracle-mode="wishlist">
          ❦ My wishlist
          <span class="toggle-sub">tag-matched, instant</span>
        </button>
        <button class="toggle-btn ${mode === 'ai' ? 'active' : ''}" data-oracle-mode="ai">
          ✦ AI recommends
          <span class="toggle-sub">may go beyond wishlist</span>
        </button>
      </div>
    </div>

    <div class="selection-tray" id="selection-tray">
      ${similarSelection.length === 0
        ? `<div class="tray-empty">Select up to 3 books below…</div>`
        : similarSelection.map((b, i) => `
            <div class="tray-chip">
              <span class="chip-title">${escapeHtml(b.t)}</span>
              <button class="chip-remove" data-remove-sel="${i}">×</button>
            </div>
          `).join('')
      }
    </div>

    <div class="search-box">
      <input type="text" class="search-input" id="book-search" placeholder="Search books to add…">
    </div>

    <div style="display: flex; justify-content: center; margin-bottom: 2rem;">
      <button class="btn" id="findSimilarBtn" ${similarSelection.length === 0 || similarLoading ? 'disabled' : ''}>
        ${similarLoading ? 'Divining…' : 'Find similar books ❦'}
      </button>
    </div>

    <div id="similar-results">
      ${similarLoading
        ? `<div class="loading">
            <div class="loading-spinner"></div>
            <div class="loading-text">Consulting the oracle…</div>
          </div>`
        : similarResults
          ? `<h2 style="font-family: 'Cormorant Garamond', serif; font-style: italic; margin-bottom: 1.5rem; color: var(--paper);">
              Found <span style="color: var(--gilt)">${similarResults.books.length}</span> kindred books
              <span style="font-size: 0.85rem; color: var(--paper-aged); opacity: 0.6; font-style: normal; font-family: 'Special Elite', monospace; letter-spacing: 0.1em; margin-left: 0.7rem;">
                ${similarResults.source === 'ai' ? '· AI-divined' : '· tag-matched from wishlist'}
              </span>
             </h2>
             <div class="cards">${similarResults.books.map(b => renderBookCard(b, similarResults.reasons?.[b.t])).join('')}</div>`
          : ''
      }
    </div>

    <h2 style="font-family: 'Cormorant Garamond', serif; font-style: italic; margin: 2rem 0 1rem; color: var(--paper);">
      ${state.library.length > 0 ? 'From your library and wishlist' : 'From your wishlist'}
    </h2>
    <div class="cards" id="picker-cards">
      ${querySource.map(b => renderSelectableCard(b)).join('')}
    </div>
  `;
}

function renderSelectableCard(b) {
  const isSel = similarSelection.some(s => bookKey(s) === bookKey(b));
  return `
    <div class="card selectable ${isSel ? 'selected' : ''}" data-select-key="${bookKey(b)}">
      <div class="cover">${buildPlaceholder(b.t, b.a)}</div>
      <div class="card-title">${escapeHtml(b.t)}</div>
      <div class="card-author">${escapeHtml(b.a)}</div>
      ${b.g ? `<div class="card-tag">${escapeHtml(b.g)}</div>` : ''}
    </div>
  `;
}

function attachOracleSimilarEvents() {
  // Mode toggle
  document.querySelectorAll('[data-oracle-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const newMode = btn.dataset.oracleMode;
      if (newMode === state.oracleMode) return;
      state.oracleMode = newMode;
      similarResults = null; // discard old results when switching mode
      saveState();
      render();
    });
  });

  // selection picker
  function rebindPicker() {
    document.querySelectorAll('[data-select-key]').forEach(el => {
      el.addEventListener('click', () => {
        const k = el.dataset.selectKey;
        const allKnown = [...state.library, ...(state.wishlist || []), ...ALL_BOOKS];
        const book = allKnown.find(b => bookKey(b) === k);
        if (!book) return;
        const idx = similarSelection.findIndex(s => bookKey(s) === k);
        if (idx >= 0) {
          similarSelection.splice(idx, 1);
        } else {
          if (similarSelection.length >= 3) {
            showToast("Pick up to 3 books", true);
            return;
          }
          similarSelection.push(book);
        }
        render();
      });
    });
  }
  rebindPicker();

  document.querySelectorAll('[data-remove-sel]').forEach(btn => {
    btn.addEventListener('click', () => {
      similarSelection.splice(parseInt(btn.dataset.removeSel, 10), 1);
      render();
    });
  });

  // search filter
  const search = document.getElementById('book-search');
  if (search) {
    search.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const sourceBooks = state.library.length > 0
        ? [...state.library, ...(state.wishlist || [])].filter((b, i, arr) =>
            arr.findIndex(x => bookKey(x) === bookKey(b)) === i)
        : (state.wishlist || []);
      const filtered = q === '' ? sourceBooks.slice(0, 80) :
        sourceBooks.filter(b => b.t.toLowerCase().includes(q) || (b.a||'').toLowerCase().includes(q)).slice(0, 80);
      document.getElementById('picker-cards').innerHTML = filtered.map(b => renderSelectableCard(b)).join('');
      rebindPicker();
    });
  }

  // find similar
  const findBtn = document.getElementById('findSimilarBtn');
  if (findBtn) findBtn.addEventListener('click', findSimilar);

  attachCardEvents();
  loadCoversForVisibleCards();
}

async function findSimilar() {
  if (similarSelection.length === 0) return;
  similarLoading = true;
  similarResults = null;
  render();

  const mode = state.oracleMode || 'wishlist';
  const wishlistPool = (state.wishlist || []).filter(b =>
    !similarSelection.some(s => bookKey(s) === bookKey(b))
  );

  if (mode === 'wishlist') {
    // Wishlist-only mode: skip AI, fast tag-matching
    similarResults = fallbackSimilar(similarSelection, wishlistPool);
    similarLoading = false;
    render();
    return;
  }

  // AI mode: ask Claude for open-ended suggestions
  const exclude = [...state.readNext, ...state.library, ...(state.wishlist || []), ...similarSelection]
    .map(b => `"${b.t}"`).join(', ');

  const seedBooks = similarSelection.map(b =>
    `- "${b.t}" by ${b.a}${b.g ? ` (${b.g})` : ''}${b.d ? `: ${b.d}` : ''}`
  ).join('\n');

  const prompt = `A reader loves these books:
${seedBooks}

Recommend 5 OTHER books they would love — books with similar tone, themes, prose style, or atmosphere. You are NOT limited to any catalog; recommend the best matches in world literature.

Do NOT recommend any of these (already known to reader): ${exclude}

Return ONLY valid JSON in this exact format:
{"books":[{"title":"...","author":"...","genre":"...","complexity":1-5,"depth":1-5,"description":"one-sentence description","reason":"one-sentence kinship to the seed books"}]}`;

  const response = await callClaude(prompt,
    "You are a literary expert recommending books based on a reader's tastes. Recommend accurately. Always return valid JSON."
  );

  let aiResults = null;
  if (response) {
    const parsed = parseJSONResponse(response);
    if (parsed && parsed.books && Array.isArray(parsed.books)) {
      const books = parsed.books.map(b => ({
        t: b.title, a: b.author, g: b.genre || 'Recommended',
        c: b.complexity, p: b.depth, d: b.description,
        aiSuggested: true,
      })).filter(b => b.t && b.a);
      const reasons = {};
      parsed.books.forEach(b => { if (b.reason) reasons[b.title] = b.reason; });
      if (books.length >= 3) {
        aiResults = { books, reasons, source: 'ai' };
      }
    }
  }

  if (aiResults) {
    similarResults = aiResults;
  } else {
    // AI failed → fallback to wishlist tag matching
    showToast("Couldn't reach the AI. Showing wishlist matches instead.", true);
    similarResults = fallbackSimilar(similarSelection, wishlistPool);
  }

  similarLoading = false;
  render();
}

function buildSimilarPrompt(selection, candidates) {
  const seedBooks = selection.map(b =>
    `- "${b.t}" by ${b.a}${b.g ? ` (${b.g})` : ''}${b.d ? `: ${b.d}` : ''}`
  ).join('\n');

  // limit candidate list size to keep prompt reasonable
  const sampled = candidates.slice(0, 200);
  const candList = sampled.map(b =>
    `${b.t} | ${b.a} | ${b.g}`
  ).join('\n');

  return `A reader loves these books:
${seedBooks}

From the following list of available books, pick the 5 BEST matches — books with similar tone, themes, prose style, or atmosphere. Not just same genre — actual kindred spirits.

Available books (title | author | genre):
${candList}

Return ONLY valid JSON in this exact format with no other text:
{"matches":[{"title":"exact title from list","reason":"one short sentence explaining the kinship"}]}`;
}

function fallbackSimilar(selection, candidates) {
  // score by: same genre +3, complexity within 1 +2, depth within 1 +1
  const scored = candidates.map(c => {
    let score = 0;
    for (const s of selection) {
      if (s.g && c.g === s.g) score += 3;
      if (s.c && c.c && Math.abs(c.c - s.c) <= 1) score += 2;
      if (s.p && c.p && Math.abs(c.p - s.p) <= 1) score += 1;
    }
    return { book: c, score };
  });
  scored.sort((a,b) => b.score - a.score);
  return {
    books: scored.slice(0, 5).map(s => s.book),
    reasons: {},
    source: 'fallback'
  };
}

// ============================================================
// SHARED — BOOK CARD
// ============================================================
function renderBookCard(b, reason) {
  const inLib = isInLibrary(b);
  const inNext = isInReadNext(b);
  const btnLabel = inLib ? '✓ In Library' : inNext ? '✓ Claimed' : 'Read this one next';
  const btnClass = inLib ? 'in-library' : inNext ? 'picked' : '';
  const disabled = inLib || inNext;

  return `
    <div class="card" data-card-key="${bookKey(b)}">
      <div class="cover" data-cover-key="${bookKey(b)}" data-title="${escapeHtml(b.t)}" data-author="${escapeHtml(b.a)}">
        ${buildPlaceholder(b.t, b.a)}
      </div>
      ${b.g ? `<div class="card-tag">${escapeHtml(b.g)}</div>` : ''}
      <div class="card-meta">
        ${b.c ? `<span>prose ${'●'.repeat(b.c)}${'○'.repeat(5 - b.c)}</span>` : ''}
        ${b.p ? `<span>depth ${'●'.repeat(b.p)}${'○'.repeat(5 - b.p)}</span>` : ''}
      </div>
      <div class="card-title">${escapeHtml(b.t)}</div>
      <div class="card-author">${escapeHtml(b.a)}</div>
      <div class="card-desc">${escapeHtml(b.d || '')}${reason ? `<br><br><em style="color: var(--gilt); font-size: 0.85rem;">— ${escapeHtml(reason)}</em>` : ''}</div>
      <button class="pick-btn ${btnClass}" ${disabled ? 'disabled' : ''} data-pick-key="${bookKey(b)}">${btnLabel}</button>
    </div>
  `;
}

function attachCardEvents() {
  document.querySelectorAll('[data-pick-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.pickKey;
      const allKnown = [
        ...ALL_BOOKS,
        ...state.library,
        ...state.readNext,
        ...(state.wishlist || []),
        ...currentDraw, // AI-suggested books live here
        ...(similarResults?.books || []),
      ];
      const book = allKnown.find(b => bookKey(b) === k);
      if (!book) return;
      addToReadNext(book);
      // refresh state of just this card
      btn.textContent = '✓ Claimed';
      btn.classList.add('picked');
      btn.disabled = true;
      // refresh nav counts
      const nav = document.querySelector('.topnav');
      if (nav) nav.outerHTML = renderNav();
    });
  });
}

function loadCoversForVisibleCards() {
  document.querySelectorAll('[data-cover-key]').forEach(coverEl => {
    const title = coverEl.dataset.title;
    const author = coverEl.dataset.author;
    fetchCoverURL(title, author).then(url => {
      if (!url) return;
      const realImg = document.createElement('img');
      realImg.alt = title;
      realImg.style.position = 'absolute';
      realImg.style.top = '0';
      realImg.style.left = '0';
      realImg.onload = () => {
        coverEl.classList.add('has-real-cover');
        realImg.classList.add('loaded');
      };
      realImg.src = url;
      coverEl.appendChild(realImg);
    });
  });
}

// ============================================================
// READING PLAN — CREATE
// ============================================================
let planForm = { type: null, target: null, timeline: 6 };

function renderPlanCreate() {
  // Build list of known series from all sources
  const knownSeries = {};
  const allBookSources = [...ALL_BOOKS, ...(state.wishlist || []), ...state.library];
  for (const b of allBookSources) {
    if (b.s && b.s.name) {
      if (!knownSeries[b.s.name]) knownSeries[b.s.name] = { name: b.s.name, count: 0 };
      knownSeries[b.s.name].count++;
    }
  }
  // Also include series we've enriched from OL
  for (const k in enrichCache) {
    const v = enrichCache[k];
    if (v.series && v.series.name && !knownSeries[v.series.name]) {
      knownSeries[v.series.name] = { name: v.series.name, count: 1, fromOL: true };
    }
  }
  const seriesList = Object.values(knownSeries).sort((a, b) => a.name.localeCompare(b.name));

  return `
    <div class="breadcrumb"><a data-go="dashboard">Dashboard</a> · Create Reading Plan</div>
    <div class="page-header">
      <div class="page-eyebrow">Create a reading plan</div>
      <h1 class="page-title">Where do you want to <span class="accent">go</span>?</h1>
      <p class="page-subtitle">We'll build a paced, curated path from where you are to where you're headed.</p>
    </div>

    <div class="onboarding-card" style="max-width: 720px; margin: 0 auto;">
      <div class="onb-eyebrow">1 · Plan type</div>
      <h2 class="onb-title" style="font-size: 1.6rem; margin-bottom: 1.5rem;">What's the goal?</h2>
      <div class="choice-grid">
        <button class="choice ${planForm.type === 'level' ? 'selected' : ''}" data-plan-type="level">
          <div class="choice-title">Reach a reading level</div>
          <div class="choice-sub">Build prose-complexity gradually. Good if you want to read more challenging fiction without bouncing off the deep end.</div>
        </button>
        <button class="choice ${planForm.type === 'experience' ? 'selected' : ''}" data-plan-type="experience">
          <div class="choice-title">Get experienced in a genre</div>
          <div class="choice-sub">A curated tour through a topic — folk horror, gothic, Latin American lit — that takes you from foundational to advanced reads.</div>
        </button>
        <button class="choice ${planForm.type === 'series' ? 'selected' : ''}" data-plan-type="series">
          <div class="choice-title">Finish a series</div>
          <div class="choice-sub">Read every book in a series, in order, picking up where you left off. We'll fetch the series from Open Library if needed.</div>
        </button>
      </div>

      ${planForm.type === 'level' ? `
        <div class="onb-eyebrow" style="margin-top: 2rem;">2 · Target level</div>
        <h2 class="onb-title" style="font-size: 1.6rem; margin-bottom: 1.5rem;">Aim for:</h2>
        <div class="choice-grid">
          ${[3,4,5].filter(l => l > (state.profile.readingLevel || 1)).map(l => `
            <button class="choice ${planForm.target === l ? 'selected' : ''}" data-plan-target="${l}">
              <div class="choice-title">Level ${l} — ${['','','','Devoted','Literary','Voracious'][l]}</div>
              <div class="choice-sub">${l === 3 ? 'Open to weird, dark, and demanding fiction.' : l === 4 ? 'Faulkner, Han Kang, Toni Morrison.' : 'Donoso, Lispector, prose that breaks itself open.'}</div>
            </button>
          `).join('')}
        </div>
      ` : ''}

      ${planForm.type === 'experience' ? `
        <div class="onb-eyebrow" style="margin-top: 2rem;">2 · Which genre?</div>
        <h2 class="onb-title" style="font-size: 1.6rem; margin-bottom: 1.5rem;">Explore:</h2>
        <select id="plan-genre" style="margin-bottom: 1rem;">
          <option value="">— Choose a genre —</option>
          ${GENRES.map(g => `<option value="${escapeHtml(g)}" ${planForm.target === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}
        </select>
      ` : ''}

      ${planForm.type === 'series' ? `
        <div class="onb-eyebrow" style="margin-top: 2rem;">2 · Which series?</div>
        <h2 class="onb-title" style="font-size: 1.6rem; margin-bottom: 1.5rem;">Pick a series ${seriesList.length > 0 ? 'we know about' : 'or search Open Library'}:</h2>
        ${seriesList.length > 0 ? `
          <div class="choice-grid">
            ${seriesList.map(s => `
              <button class="choice ${planForm.target === s.name ? 'selected' : ''}" data-plan-target="${escapeHtml(s.name)}">
                <div class="choice-title">${escapeHtml(s.name)}</div>
                <div class="choice-sub">${s.count} ${s.count === 1 ? 'book' : 'books'} known${s.fromOL ? ' · via Open Library' : ''}</div>
              </button>
            `).join('')}
          </div>
        ` : ''}
        <div class="onb-eyebrow" style="margin-top: 1.5rem;">Or search by series name</div>
        <div style="display: flex; gap: 0.6rem; margin-top: 0.5rem;">
          <input type="text" class="search-input" id="series-search-input"
                 placeholder='e.g. "The Stormlight Archive"'
                 style="flex: 1;"
                 value="${typeof planForm.target === 'string' && !seriesList.some(s => s.name === planForm.target) ? escapeHtml(planForm.target) : ''}">
          <button class="btn btn-gilt" id="series-search-btn">Search ❦</button>
        </div>
        <div id="series-search-result" style="margin-top: 1rem;"></div>
      ` : ''}

      ${(planForm.type === 'level' && planForm.target) || (planForm.type === 'experience' && planForm.target) ? `
        <div class="onb-eyebrow" style="margin-top: 2rem;">3 · Timeline</div>
        <h2 class="onb-title" style="font-size: 1.6rem; margin-bottom: 1.5rem;">Over how many months?</h2>
        <div class="choice-grid" style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));">
          ${[3, 6, 9, 12].map(m => `
            <button class="choice ${planForm.timeline === m ? 'selected' : ''}" data-plan-timeline="${m}" style="text-align: center;">
              <div class="choice-title">${m}</div>
              <div class="choice-sub">months</div>
            </button>
          `).join('')}
        </div>
      ` : ''}

      ${planForm.type === 'series' && planForm.target ? `
        <p style="color: var(--paper-aged); opacity: 0.7; margin-top: 1rem; font-style: italic;">
          Series plans use the actual book count as the timeline. We'll pace one book per month.
        </p>
      ` : ''}

      <div class="onb-actions">
        <button class="btn btn-ghost" data-go="dashboard">← Back</button>
        <button class="btn" id="generate-plan-btn" ${
          !planForm.type ||
          !planForm.target ||
          (planForm.type !== 'series' && !planForm.timeline)
          ? 'disabled' : ''
        }>
          Generate plan ❦
        </button>
      </div>
    </div>
  `;
}

function attachPlanCreateEvents() {
  document.querySelectorAll('[data-plan-type]').forEach(b => {
    b.addEventListener('click', () => {
      planForm.type = b.dataset.planType;
      planForm.target = null;
      render();
    });
  });
  document.querySelectorAll('[data-plan-target]').forEach(b => {
    b.addEventListener('click', () => {
      const raw = b.dataset.planTarget;
      // For 'level' the target is an int; for 'experience'/'series' it's a string
      const parsed = parseInt(raw, 10);
      planForm.target = (planForm.type === 'level' && !isNaN(parsed)) ? parsed : raw;
      render();
    });
  });
  const genreSel = document.getElementById('plan-genre');
  if (genreSel) {
    genreSel.addEventListener('change', () => {
      planForm.target = genreSel.value || null;
      render();
    });
  }
  document.querySelectorAll('[data-plan-timeline]').forEach(b => {
    b.addEventListener('click', () => {
      planForm.timeline = parseInt(b.dataset.planTimeline, 10);
      render();
    });
  });

  // Series search
  const seriesSearchBtn = document.getElementById('series-search-btn');
  if (seriesSearchBtn) {
    seriesSearchBtn.addEventListener('click', async () => {
      const input = document.getElementById('series-search-input');
      const q = input.value.trim();
      if (!q) return;
      const resultEl = document.getElementById('series-search-result');
      resultEl.innerHTML = `
        <div class="loading" style="padding: 1.5rem;">
          <div class="loading-spinner" style="width: 24px; height: 24px;"></div>
          <div class="loading-text" style="font-size: 0.9rem;">Searching Open Library…</div>
        </div>
      `;
      // Force a re-fetch
      delete seriesBooksCache[q];
      const books = await fetchSeriesBooks(q);
      if (books.length === 0) {
        resultEl.innerHTML = `
          <div style="padding: 1rem; color: var(--paper-aged); opacity: 0.7; font-style: italic;">
            No matches for "${escapeHtml(q)}" on Open Library. Try a different name or spelling.
          </div>
        `;
      } else {
        // The series name reported by OL may differ from query — use OL's version
        const actualName = books[0].s.name;
        planForm.target = actualName;
        resultEl.innerHTML = `
          <div style="padding: 1rem; background: rgba(176, 140, 63, 0.08); border: 1px solid rgba(176, 140, 63, 0.3); border-radius: 2px;">
            <div style="font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 1.1rem; color: var(--paper); margin-bottom: 0.4rem;">
              Found <strong>${books.length}</strong> books in <em>${escapeHtml(actualName)}</em>
            </div>
            <div style="font-size: 0.85rem; color: var(--paper-aged); opacity: 0.7;">
              ${books.slice(0, 5).map(b => escapeHtml(b.t)).join(' · ')}${books.length > 5 ? ' …' : ''}
            </div>
          </div>
        `;
        // Re-render so the generate button activates
        setTimeout(() => render(), 100);
      }
    });
    // Enter key triggers search
    const input = document.getElementById('series-search-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          seriesSearchBtn.click();
        }
      });
    }
  }

  const gen = document.getElementById('generate-plan-btn');
  if (gen) gen.addEventListener('click', generatePlan);
}

async function generatePlan() {
  go('plan-view', { generating: true });
}

// ============================================================
// READING PLAN — VIEW
// ============================================================

function renderPlanView() {
  // if generating, kick off
  if (state.routeParams.generating) {
    setTimeout(doGeneratePlan, 50);
    return `
      <div class="breadcrumb"><a data-go="dashboard">Dashboard</a> · Your Reading Plan</div>
      <div class="loading">
        <div class="loading-spinner"></div>
        <div class="loading-text">The oracle is composing your path…<br><span style="font-size: 0.9rem; opacity: 0.6;">This may take a moment.</span></div>
      </div>
    `;
  }

  const plan = state.currentPlan;
  if (!plan) {
    return `
      <div class="breadcrumb"><a data-go="dashboard">Dashboard</a> · Your Reading Plan</div>
      <div class="empty-state">
        <div class="ornament">❦</div>
        <div class="empty-state-title">No active plan</div>
        <div class="empty-state-text">Create one from the dashboard.</div>
        <div style="margin-top: 1.5rem;"><button class="btn" data-go="plan-create">Create a plan</button></div>
      </div>
    `;
  }

  return `
    <div class="breadcrumb"><a data-go="dashboard">Dashboard</a> · Reading Plan</div>
    <div class="page-header">
      <div class="page-eyebrow">Your Reading Plan</div>
      <h1 class="page-title">${escapeHtml(plan.title)}</h1>
      <p class="page-subtitle">${escapeHtml(plan.intro || '')}</p>
    </div>

    <div style="margin-bottom: 2rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
      <button class="btn btn-gilt" id="add-plan-to-queue">Add all to Read Next</button>
      <button class="btn btn-ghost" data-go="plan-create">Create a different plan</button>
      <button class="btn btn-ghost" id="delete-plan">Delete this plan</button>
    </div>

    <div>
      ${plan.books.map((b, i) => {
        const found = findBookByTitle(b.title || b.t) || { t: b.title || b.t, a: b.author || b.a, d: b.description || '' };
        // Use page count from plan itself (set when plan was built) if not in catalog
        const pages = b.pp || found.pp || null;
        return `
          <div class="plan-step">
            <div class="plan-month">Month ${b.month || (i+1)}</div>
            <div>
              <div class="plan-book">${escapeHtml(found.t)}</div>
              <div class="plan-author">${escapeHtml(found.a)}${pages ? ` · <span style="color: var(--paper-aged); opacity: 0.7; font-size: 0.9rem;">~${pages} pages</span>` : ''}</div>
              <div class="plan-reason">${escapeHtml(b.reason || found.d || '')}</div>
              <div style="margin-top: 0.8rem; display: flex; gap: 0.4rem; flex-wrap: wrap;">
                ${isInLibrary(found) ? `<span class="level-pill" style="background: var(--moss); color: var(--paper); border-color: var(--moss);">✓ Read</span>` :
                  isInReadNext(found) ? `<span class="level-pill">✓ Queued</span>` :
                    `<button class="li-action" data-pick-plan-key="${bookKey(found)}">+ Add to Read Next</button>
                     <button class="li-action success" data-mark-plan-key="${bookKey(found)}">✓ Mark as Read</button>`
                }
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function doGeneratePlan() {
  const profile = state.profile;
  const libraryContext = state.library.slice(-30).map(b => `- ${b.t} by ${b.a}`).join('\n') || '(none)';

  // Special case: series plan is deterministic, no LLM call needed
  if (planForm.type === 'series') {
    const plan = await buildSeriesPlan(planForm.target);
    plan.type = 'series';
    state.currentPlan = plan;
    state.routeParams = {};
    saveState();
    render();
    return;
  }

  let prompt;
  if (planForm.type === 'level') {
    prompt = `A reader at level ${profile.readingLevel || 1}/5 wants to reach level ${planForm.target}/5 over ${planForm.timeline} months.

Reading levels are based on prose complexity:
1 = casual/page-turners
2 = mid-difficulty
3 = literary
4 = challenging (Faulkner, Han Kang)
5 = experimental (Donoso, Lispector)

Books they've read recently:
${libraryContext}

Available books from their wishlist (title | author | genre | prose complexity 1-5):
${ALL_BOOKS.map(b => `${b.t} | ${b.a} | ${b.g} | c=${b.c}`).join('\n')}

Build a ${planForm.timeline}-month plan that gradually escalates from level ${profile.readingLevel || 1} to level ${planForm.target}. One book per month. Each step should be a meaningful but achievable jump.

Return ONLY valid JSON in this exact format:
{
  "title": "short evocative title for this plan",
  "intro": "one sentence explaining the journey",
  "books": [
    {"month": 1, "title": "exact title from list", "reason": "why this book at this stage"},
    ...
  ]
}`;
  } else {
    prompt = `A reader at level ${profile.readingLevel || 1}/5 wants to get deeply experienced in the genre: "${planForm.target}". Timeline: ${planForm.timeline} months.

Books they've read recently:
${libraryContext}

Available books from their wishlist matching this genre (title | author | prose complexity 1-5 | genre depth 1-5 | description):
${ALL_BOOKS.filter(b => b.g === planForm.target).map(b => `${b.t} | ${b.a} | c=${b.c} | p=${b.p} | ${b.d || ''}`).join('\n')}

Also available from related genres:
${ALL_BOOKS.filter(b => b.g !== planForm.target).slice(0, 30).map(b => `${b.t} | ${b.a} | ${b.g}`).join('\n')}

Build a ${planForm.timeline}-month tour of this genre. Start with the most accessible foundational works and progress to deeper, more challenging, or more representative texts. One book per month.

Return ONLY valid JSON in this exact format:
{
  "title": "short evocative title for this plan",
  "intro": "one sentence explaining the journey",
  "books": [
    {"month": 1, "title": "exact title from list", "reason": "why this book at this stage"},
    ...
  ]
}`;
  }

  const response = await callClaude(prompt,
    "You are a literary curator building personalized reading plans. Always return valid JSON."
  );

  let plan = null;
  if (response) {
    plan = parseJSONResponse(response);
  }

  if (!plan || !plan.books || plan.books.length === 0) {
    // fallback: build a simple plan from the data
    plan = buildFallbackPlan();
  }

  // ensure book count matches timeline
  plan.books = plan.books.slice(0, planForm.timeline);
  plan.timeline = planForm.timeline;
  plan.type = planForm.type;

  state.currentPlan = plan;
  state.routeParams = {};
  saveState();
  render();
}

function buildFallbackPlan() {
  let pool;
  let title, intro;

  if (planForm.type === 'level') {
    const start = state.profile.readingLevel || 1;
    const end = planForm.target;
    title = `From level ${start} to level ${end}`;
    intro = `A ${planForm.timeline}-month progression through gradually deeper prose.`;
    // sort by complexity, pick a gradient
    const sorted = [...ALL_BOOKS].sort((a,b) => (a.c||3) - (b.c||3));
    const steps = [];
    for (let i = 0; i < planForm.timeline; i++) {
      const targetC = start + ((end - start) * (i / (planForm.timeline - 1)));
      const candidates = sorted.filter(b =>
        Math.abs((b.c||3) - targetC) <= 0.7 &&
        !steps.some(s => s.t === b.t) &&
        !isInLibrary(b)
      );
      const picked = candidates[Math.floor(Math.random() * Math.min(candidates.length, 5))];
      if (picked) steps.push({ ...picked, month: i+1, reason: `A measured step toward level ${end} prose.` });
    }
    return { title, intro, books: steps.map(s => ({ month: s.month, title: s.t, author: s.a, reason: s.reason })) };
  } else {
    title = `An immersion in ${planForm.target}`;
    intro = `A guided ${planForm.timeline}-month path through the genre.`;
    pool = ALL_BOOKS.filter(b => b.g === planForm.target).sort((a,b) => (a.c||3) - (b.c||3));
    const steps = pool.slice(0, planForm.timeline).map((b, i) => ({
      month: i+1, title: b.t, author: b.a,
      reason: i === 0 ? 'An accessible foundation for the genre.' :
              i === pool.length - 1 ? 'A defining, demanding work.' :
              'A deeper step into the genre\'s core themes.'
    }));
    return { title, intro, books: steps };
  }
}

async function buildSeriesPlan(seriesName) {
  // Pull books from our catalog AND fetch any we don't yet have from Open Library
  let entries = findSeriesEntries(seriesName);
  const olBooks = await fetchSeriesBooks(seriesName);

  // Merge OL results in (prefer catalog versions when both exist)
  const have = new Set(entries.map(bookKey));
  for (const ob of olBooks) {
    if (!have.has(bookKey(ob))) {
      entries.push(ob);
      have.add(bookKey(ob));
    }
  }

  // Sort by position
  entries.sort((a, b) => {
    const an = a.s?.n || 999;
    const bn = b.s?.n || 999;
    return an - bn;
  });

  // Filter out books already read
  const unread = entries.filter(b => !isInLibrary(b));
  const readCount = entries.length - unread.length;

  const totalPages = unread.reduce((sum, b) => sum + (b.pp || 0), 0);
  const pagesNote = totalPages > 0 ? ` Roughly ${totalPages.toLocaleString()} pages of reading ahead.` : '';

  const books = unread.map((b, i) => ({
    month: i + 1,
    title: b.t,
    author: b.a,
    pp: b.pp || null,
    reason: b.s?.n
      ? `Book ${b.s.n} in ${seriesName}.`
      : `Continues the ${seriesName} series.`
  }));

  return {
    title: `Finish ${seriesName}`,
    intro: readCount > 0
      ? `You've already read ${readCount} ${readCount === 1 ? 'book' : 'books'} in this series. ${books.length} to go.${pagesNote}`
      : `The full ${seriesName} series, in order.${pagesNote}`,
    books,
    timeline: books.length,
    seriesName,
  };
}

function attachPlanViewEvents() {
  const addAll = document.getElementById('add-plan-to-queue');
  if (addAll) {
    addAll.addEventListener('click', () => {
      let added = 0;
      for (const b of state.currentPlan.books) {
        const found = findBookByTitle(b.title || b.t);
        if (found && !isInLibrary(found) && !isInReadNext(found)) {
          state.readNext.push(found);
          added++;
        }
      }
      saveState();
      showToast(`Added ${added} books to Read Next`);
      render();
    });
  }

  const del = document.getElementById('delete-plan');
  if (del) {
    del.addEventListener('click', () => {
      if (confirm('Delete this reading plan?')) {
        state.currentPlan = null;
        saveState();
        go('dashboard');
      }
    });
  }

  document.querySelectorAll('[data-pick-plan-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.pickPlanKey;
      // Look across catalog, wishlist, library, and the plan itself (for OL-sourced books)
      const sources = [
        ...ALL_BOOKS,
        ...(state.wishlist || []),
        ...state.library,
        ...(state.currentPlan?.books || []).map(b => ({ t: b.title || b.t, a: b.author || b.a, pp: b.pp })),
      ];
      const book = sources.find(b => bookKey(b) === k);
      if (book) {
        addToReadNext(book);
        render();
      }
    });
  });
  document.querySelectorAll('[data-mark-plan-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.markPlanKey;
      const sources = [
        ...ALL_BOOKS,
        ...(state.wishlist || []),
        ...state.library,
        ...(state.currentPlan?.books || []).map(b => ({ t: b.title || b.t, a: b.author || b.a, pp: b.pp })),
      ];
      const book = sources.find(b => bookKey(b) === k);
      if (book) {
        markAsRead(book);
        render();
      }
    });
  });
}

// ============================================================
// READ NEXT LIST
// ============================================================
function renderReadNextList() {
  return `
    <div class="breadcrumb"><a data-go="dashboard">Dashboard</a> · Read Next</div>
    <div class="page-header">
      <div class="page-eyebrow">Queue</div>
      <h1 class="page-title">To Read <span class="accent">Next</span></h1>
      <p class="page-subtitle">${state.readNext.length} books waiting.</p>
    </div>
    ${state.readNext.length === 0 ? `
      <div class="empty-state">
        <div class="ornament">❦</div>
        <div class="empty-state-title">Nothing queued yet</div>
        <div class="empty-state-text">Use the Oracle to draw books from the vault.</div>
        <div style="margin-top: 1.5rem;"><button class="btn" data-go="oracle">Open the Oracle</button></div>
      </div>
    ` : state.readNext.map((b, i) => `
      <div class="list-item">
        <div class="li-num">${String(i+1).padStart(2,'0')}.</div>
        <div class="li-content">
          <div class="li-title">${escapeHtml(b.t)}</div>
          <div class="li-author">${escapeHtml(b.a)}${b.g ? ` · <span style="color: var(--gilt);">${escapeHtml(b.g)}</span>` : ''}</div>
        </div>
        <div class="li-actions">
          <button class="li-action success" data-mark-read-key="${bookKey(b)}">✓ Read</button>
          <button class="li-action danger" data-remove-next-key="${bookKey(b)}">Remove</button>
        </div>
      </div>
    `).join('')}
  `;
}

function attachReadNextEvents() {
  document.querySelectorAll('[data-mark-read-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.markReadKey;
      const book = state.readNext.find(b => bookKey(b) === k);
      if (book) markAsRead(book);
      render();
    });
  });
  document.querySelectorAll('[data-remove-next-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.removeNextKey;
      const book = state.readNext.find(b => bookKey(b) === k);
      if (book) removeFromReadNext(book);
      render();
    });
  });
}

// ============================================================
// LIBRARY LIST
// ============================================================
function renderLibraryList() {
  // group by genre for nice display
  const grouped = {};
  for (const b of state.library) {
    const g = b.g || 'Imported';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(b);
  }
  const genreKeys = Object.keys(grouped).sort();

  return `
    <div class="breadcrumb"><a data-go="dashboard">Dashboard</a> · Library</div>
    <div class="page-header">
      <div class="page-eyebrow">Library</div>
      <h1 class="page-title">Books I've <span class="accent">Read</span></h1>
      <p class="page-subtitle">${state.library.length} books across ${genreKeys.length} categories.</p>
    </div>

    ${state.library.length === 0 ? `
      <div class="empty-state">
        <div class="ornament">📚</div>
        <div class="empty-state-title">Empty library</div>
        <div class="empty-state-text">As you mark books as read, they'll appear here and fill your shelves on the dashboard.</div>
      </div>
    ` : genreKeys.map(g => `
      <div class="list-section">
        <h2>${escapeHtml(g)} <span class="count">· ${grouped[g].length}</span></h2>
        ${grouped[g].map(b => `
          <div class="list-item">
            <div class="li-num">${b.rating ? '★'.repeat(b.rating) : '❦'}</div>
            <div class="li-content" data-open-book="${bookKey(b)}" style="cursor: pointer;">
              <div class="li-title">${escapeHtml(b.t)}</div>
              <div class="li-author">${escapeHtml(b.a)}${b.fromGoodreads ? ' · <span style="color: var(--gilt); opacity: 0.7;">from Goodreads</span>' : ''}</div>
            </div>
            <div class="li-actions">
              <button class="li-action danger" data-remove-lib-key="${bookKey(b)}">Remove</button>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('')}
  `;
}

function attachLibraryEvents() {
  document.querySelectorAll('[data-remove-lib-key]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = btn.dataset.removeLibKey;
      const book = state.library.find(b => bookKey(b) === k);
      if (book && confirm(`Remove "${book.t}" from your library?`)) {
        removeFromLibrary(book);
        render();
      }
    });
  });
  document.querySelectorAll('[data-open-book]').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.openBook;
      const book = state.library.find(b => bookKey(b) === k);
      if (book) openBookModal(book);
    });
  });
}

// ============================================================
// WISHLIST PAGE
// ============================================================
let wishlistFilter = { genre: 'all', search: '' };
let manualAddForm = { open: false, t: '', a: '', g: '', d: '', amazonUrl: '' };

function renderWishlistPage() {
  const wl = state.wishlist || [];

  // Apply filters
  let filtered = wl;
  if (wishlistFilter.genre !== 'all') {
    filtered = filtered.filter(b => b.g === wishlistFilter.genre);
  }
  if (wishlistFilter.search) {
    const q = wishlistFilter.search.toLowerCase();
    filtered = filtered.filter(b =>
      b.t.toLowerCase().includes(q) || (b.a || '').toLowerCase().includes(q)
    );
  }

  // Group filtered by genre
  const grouped = {};
  for (const b of filtered) {
    const g = b.g || 'Uncategorized';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(b);
  }
  const genreKeys = Object.keys(grouped).sort();
  const allGenres = [...new Set(wl.map(b => b.g).filter(Boolean))].sort();

  return `
    <div class="breadcrumb"><a data-go="dashboard">Dashboard</a> · Wishlist</div>
    <div class="page-header">
      <div class="page-eyebrow">Wishlist</div>
      <h1 class="page-title">Books I <span class="accent">want to read</span></h1>
      <p class="page-subtitle">${wl.length} books on the shelf. Pulled from your initial catalog plus anything you've added.</p>
    </div>

    <div class="wishlist-toolbar">
      <div class="wishlist-filters">
        <input type="text"
               class="search-input"
               id="wishlist-search"
               placeholder="Search title or author…"
               value="${escapeHtml(wishlistFilter.search)}"
               style="max-width: 280px;">
        <select id="wishlist-genre-filter" style="max-width: 240px;">
          <option value="all">— All categories —</option>
          ${allGenres.map(g => `<option value="${escapeHtml(g)}" ${wishlistFilter.genre === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-gilt" id="wishlist-add-btn">+ Add a book</button>
    </div>

    ${manualAddForm.open ? renderManualAddForm() : ''}

    ${wl.length === 0 ? `
      <div class="empty-state">
        <div class="ornament">❦</div>
        <div class="empty-state-title">Your wishlist is empty</div>
        <div class="empty-state-text">Add books manually with the button above, or use the Oracle to discover new ones.</div>
      </div>
    ` : filtered.length === 0 ? `
      <div class="empty-state">
        <div class="ornament">❦</div>
        <div class="empty-state-title">No books match</div>
        <div class="empty-state-text">Try clearing your filters.</div>
      </div>
    ` : genreKeys.map(g => `
      <div class="list-section">
        <h2>${escapeHtml(g)} <span class="count">· ${grouped[g].length}</span></h2>
        ${grouped[g].map(b => {
          const inNext = isInReadNext(b);
          return `
            <div class="list-item">
              <div class="li-num">${b.manuallyAdded ? '✎' : '❦'}</div>
              <div class="li-content" data-open-wishlist="${bookKey(b)}" style="cursor: pointer;">
                <div class="li-title">${escapeHtml(b.t)}</div>
                <div class="li-author">${escapeHtml(b.a)}${b.manuallyAdded ? ' · <span style="color: var(--gilt); opacity: 0.7;">added by you</span>' : ''}${inNext ? ' · <span style="color: var(--gilt-bright);">in Read Next</span>' : ''}</div>
              </div>
              <div class="li-actions">
                ${inNext
                  ? `<span class="li-action" style="opacity: 0.5; cursor: default;">✓ Queued</span>`
                  : `<button class="li-action success" data-wishlist-next-key="${bookKey(b)}">+ Read Next</button>`
                }
                <button class="li-action danger" data-wishlist-remove-key="${bookKey(b)}">Remove</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `).join('')}
  `;
}

function renderManualAddForm() {
  // Use existing genres + Other so users can categorize
  const genres = [...new Set([...GENRES, ...(state.wishlist || []).map(b => b.g).filter(Boolean)])].sort();
  return `
    <div class="manual-add-form">
      <div class="manual-add-header">
        <h3>Add a book to your wishlist</h3>
        <button class="manual-add-close" id="manual-add-cancel">×</button>
      </div>
      <div class="manual-add-grid">
        <div class="field">
          <label for="ma-title">Title *</label>
          <input type="text" class="search-input" id="ma-title" placeholder="The book's title" value="${escapeHtml(manualAddForm.t)}">
        </div>
        <div class="field">
          <label for="ma-author">Author *</label>
          <input type="text" class="search-input" id="ma-author" placeholder="Author name" value="${escapeHtml(manualAddForm.a)}">
        </div>
        <div class="field">
          <label for="ma-genre">Category</label>
          <select id="ma-genre">
            <option value="">— Choose a category —</option>
            ${genres.map(g => `<option value="${escapeHtml(g)}" ${manualAddForm.g === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="ma-amazon">Amazon URL <span class="field-optional">(optional)</span></label>
          <input type="text" class="search-input" id="ma-amazon" placeholder="https://www.amazon.com/… — stored as a 'view on Amazon' link" value="${escapeHtml(manualAddForm.amazonUrl)}">
        </div>
        <div class="field field-full">
          <label for="ma-desc">Description <span class="field-optional">(optional)</span></label>
          <textarea id="ma-desc" placeholder="A line or two about the book — what it's about, why you want to read it.">${escapeHtml(manualAddForm.d)}</textarea>
        </div>
      </div>
      <div class="manual-add-actions">
        <span class="manual-add-note">Cover image will be fetched automatically from the title + author when possible.</span>
        <button class="btn btn-ghost" id="manual-add-cancel-btn">Cancel</button>
        <button class="btn" id="manual-add-submit">Add to wishlist ❦</button>
      </div>
    </div>
  `;
}

function attachWishlistEvents() {
  // Search filter
  const search = document.getElementById('wishlist-search');
  if (search) {
    let to;
    search.addEventListener('input', (e) => {
      clearTimeout(to);
      to = setTimeout(() => {
        wishlistFilter.search = e.target.value;
        // re-render only the page content (preserve focus)
        const content = document.getElementById('page-content');
        if (content) {
          content.innerHTML = renderWishlistPage();
          attachWishlistEvents();
          // restore focus
          const newSearch = document.getElementById('wishlist-search');
          if (newSearch) {
            newSearch.focus();
            newSearch.setSelectionRange(newSearch.value.length, newSearch.value.length);
          }
        }
      }, 200);
    });
  }

  // Genre filter
  const genreSel = document.getElementById('wishlist-genre-filter');
  if (genreSel) {
    genreSel.addEventListener('change', () => {
      wishlistFilter.genre = genreSel.value;
      const content = document.getElementById('page-content');
      if (content) {
        content.innerHTML = renderWishlistPage();
        attachWishlistEvents();
      }
    });
  }

  // Add book button
  const addBtn = document.getElementById('wishlist-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      manualAddForm.open = !manualAddForm.open;
      const content = document.getElementById('page-content');
      if (content) {
        content.innerHTML = renderWishlistPage();
        attachWishlistEvents();
        if (manualAddForm.open) {
          // scroll to form and focus first field
          setTimeout(() => {
            const titleField = document.getElementById('ma-title');
            if (titleField) {
              titleField.focus();
              titleField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 50);
        }
      }
    });
  }

  // Manual add form events
  const cancelBtn1 = document.getElementById('manual-add-cancel');
  const cancelBtn2 = document.getElementById('manual-add-cancel-btn');
  [cancelBtn1, cancelBtn2].forEach(b => {
    if (b) b.addEventListener('click', () => {
      manualAddForm = { open: false, t: '', a: '', g: '', d: '', amazonUrl: '' };
      const content = document.getElementById('page-content');
      if (content) {
        content.innerHTML = renderWishlistPage();
        attachWishlistEvents();
      }
    });
  });

  // Track form input changes (so re-renders preserve state)
  ['ma-title', 'ma-author', 'ma-genre', 'ma-desc', 'ma-amazon'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        const map = { 'ma-title': 't', 'ma-author': 'a', 'ma-genre': 'g', 'ma-desc': 'd', 'ma-amazon': 'amazonUrl' };
        manualAddForm[map[id]] = el.value;
      });
    }
  });

  // Submit
  const submitBtn = document.getElementById('manual-add-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      // sync form values from DOM
      const t = (document.getElementById('ma-title').value || '').trim();
      const a = (document.getElementById('ma-author').value || '').trim();
      const g = document.getElementById('ma-genre').value || 'Uncategorized';
      const d = (document.getElementById('ma-desc').value || '').trim();
      const amazonUrl = (document.getElementById('ma-amazon').value || '').trim();

      if (!t || !a) {
        showToast('Title and author are required', true);
        return;
      }

      const book = {
        t, a, g,
        d: d || null,
        amazonUrl: amazonUrl || null,
        manuallyAdded: true,
        addedAt: new Date().toISOString(),
      };

      if (isInWishlist(book)) {
        showToast(`"${t}" is already in your wishlist`, true);
        return;
      }
      if (isInLibrary(book)) {
        showToast(`"${t}" is already in your library`, true);
        return;
      }

      addToWishlist(book);
      manualAddForm = { open: false, t: '', a: '', g: '', d: '', amazonUrl: '' };
      render();
    });
  }

  // Add to Read Next
  document.querySelectorAll('[data-wishlist-next-key]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = btn.dataset.wishlistNextKey;
      const book = state.wishlist.find(b => bookKey(b) === k);
      if (book) {
        addToReadNext(book);
        const content = document.getElementById('page-content');
        if (content) {
          content.innerHTML = renderWishlistPage();
          attachWishlistEvents();
        }
        const nav = document.querySelector('.topnav');
        if (nav) nav.outerHTML = renderNav();
      }
    });
  });

  // Remove from wishlist
  document.querySelectorAll('[data-wishlist-remove-key]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = btn.dataset.wishlistRemoveKey;
      const book = state.wishlist.find(b => bookKey(b) === k);
      if (book && confirm(`Remove "${book.t}" from your wishlist?`)) {
        removeFromWishlist(book);
        render();
      }
    });
  });

  // Open book modal on click
  document.querySelectorAll('[data-open-wishlist]').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.openWishlist;
      const book = state.wishlist.find(b => bookKey(b) === k);
      if (book) openBookModal(book);
    });
  });
}

// ============================================================
// PROFILE
// ============================================================
function renderProfile() {
  const levelNames = { 1: 'Casual companion', 2: 'Steady reader', 3: 'Devoted reader', 4: 'Literary appetite', 5: 'Voracious + experimental' };
  const goalNames = {
    'level-up': 'Level up my reading',
    'explore': 'Get into a new topic or genre',
    'random': 'Just give me something to read',
  };
  return `
    <div class="breadcrumb"><a data-go="dashboard">Dashboard</a> · Profile</div>
    <div class="page-header">
      <div class="page-eyebrow">Profile</div>
      <h1 class="page-title">Your <span class="accent">reader</span> profile</h1>
    </div>

    <div class="onboarding-card" style="max-width: 720px;">
      <h2 style="font-family: 'Cormorant Garamond', serif; font-style: italic; margin-bottom: 1rem; color: var(--paper);">Reading level</h2>
      <p style="color: var(--paper-aged); margin-bottom: 1rem;">${levelNames[state.profile.readingLevel] || 'Not set'}</p>

      <h2 style="font-family: 'Cormorant Garamond', serif; font-style: italic; margin: 1.5rem 0 1rem; color: var(--paper);">Goal</h2>
      <p style="color: var(--paper-aged); margin-bottom: 1rem;">${goalNames[state.profile.goal] || 'Not set'}</p>

      <h2 style="font-family: 'Cormorant Garamond', serif; font-style: italic; margin: 1.5rem 0 1rem; color: var(--paper);">Library</h2>
      <p style="color: var(--paper-aged); margin-bottom: 1.5rem;">
        ${state.library.length} books read · ${state.readNext.length} books queued
        ${state.profile.goodreadsImported ? '<br><span style="color: var(--gilt);">✓ Goodreads imported</span>' : ''}
      </p>

      <div style="border-top: 1px solid rgba(176, 140, 63, 0.2); padding-top: 1.5rem; margin-top: 2rem;">
        <button class="btn btn-ghost" id="reset-profile-btn">Reset profile & start over</button>
      </div>
    </div>
  `;
}

function attachProfileEvents() {
  const reset = document.getElementById('reset-profile-btn');
  if (reset) {
    reset.addEventListener('click', () => {
      if (confirm('This will erase your profile, library, queue, and reading plan. Continue?')) {
        resetState();
      }
    });
  }
}

// ============================================================
// BOOT
// ============================================================
seedWishlistIfNeeded(); // handle migration from older state versions
render();
