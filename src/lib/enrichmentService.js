// OpenLibrary enrichment (series + page count). Cached in localStorage — this
// is per-device cache data, no reason to put it in Supabase.
import { cleanTitle, cleanAuthor } from './bookHelpers';

const ENRICH_CACHE_KEY = 'wishlist_oracle_ol_enrich_v1';

function loadEnrichCache() {
  try {
    const raw = localStorage.getItem(ENRICH_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveEnrichCache(cache) {
  try {
    localStorage.setItem(ENRICH_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

let enrichCache = loadEnrichCache();

export function parseSeriesString(s) {
  if (!s || typeof s !== 'string') return null;
  const patterns = [
    /^(.+?)\s*#\s*(\d+(?:\.\d+)?)\s*$/i,
    /^(.+?)\s*,\s*Book\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*$/i,
    /^(.+?)\s*\((\d+)\)\s*$/,
    /^(.+?)\s+Book\s+(\d+)\s*$/i,
    /^(.+?)\s+(\d+(?:\.\d+)?)\s*$/,
  ];
  const wordToNum = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  for (const p of patterns) {
    const m = s.match(p);
    if (m) {
      const name = m[1].trim();
      let n = m[2];
      n = wordToNum[n?.toLowerCase()] || parseFloat(n);
      if (isNaN(n)) n = null;
      if (name.length >= 3) return { name, n };
    }
  }
  return { name: s.trim(), n: null };
}

export async function enrichBookFromOpenLibrary(title, author) {
  const key = `${title}|${author}`;
  if (enrichCache[key]) return enrichCache[key];

  const miss = (extra = {}) => {
    enrichCache[key] = {
      series: null,
      pages: null,
      miss: true,
      fetchedAt: new Date().toISOString(),
      ...extra,
    };
    saveEnrichCache(enrichCache);
    return enrichCache[key];
  };

  try {
    const q = `title=${encodeURIComponent(cleanTitle(title))}&author=${encodeURIComponent(cleanAuthor(author))}&limit=3&fields=title,author_name,series,number_of_pages_median,first_publish_year`;
    const resp = await fetch(`https://openlibrary.org/search.json?${q}`);
    if (!resp.ok) return miss();
    const data = await resp.json();
    if (!data.docs || data.docs.length === 0) return miss();

    const targetTitle = cleanTitle(title).toLowerCase();
    const targetAuthor = cleanAuthor(author).toLowerCase();
    const best =
      data.docs.find(
        (d) =>
          d.title?.toLowerCase().includes(targetTitle) &&
          (d.author_name || []).some((a) => a.toLowerCase().includes(targetAuthor))
      ) || data.docs[0];

    let series = null;
    if (best.series && best.series.length > 0) {
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
  } catch {
    return miss();
  }
}

const seriesBooksCache = {};

export async function fetchSeriesBooks(seriesName) {
  if (!seriesName) return [];
  if (seriesBooksCache[seriesName]) return seriesBooksCache[seriesName];

  try {
    const q = `q=${encodeURIComponent(`series:"${seriesName}"`)}&limit=30&fields=title,author_name,series,number_of_pages_median,first_publish_year,cover_i`;
    const resp = await fetch(`https://openlibrary.org/search.json?${q}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    if (!data.docs) return [];

    const matches = [];
    const seenKeys = new Set();
    const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
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

    matches.sort((a, b) => (a.s.n || 999) - (b.s.n || 999));
    seriesBooksCache[seriesName] = matches;
    return matches;
  } catch {
    return [];
  }
}
