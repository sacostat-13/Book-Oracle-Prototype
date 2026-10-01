// wikidataYear.mjs — Wikidata's P577 ("publication date") for a title + author.
//
// The third source in publicationYearBackfill.mjs, consulted only when
// Hardcover and OpenLibrary do not already agree. Same search strategy and the
// same corroboration bar as originalLanguageBackfill.mjs's Wikidata section
// (read that file's long comment for the why), cut down to what a year needs:
//
//   - search: wbsearchentities (en) ∪ CirrusSearch on "title author"
//   - edition items (P31 = Q3331189) are FOLLOWED to their work via P629; an
//     edition's P577 is that printing's date, the exact error this column
//     exists to avoid
//   - a candidate must pass titleMatches() against its label/aliases AND
//     authorMatches() against its P50 / P170 / P2093 names
//   - P577 must be at year precision or finer; the EARLIEST claim wins (works
//     carry one P577 per first publication in different countries)
//
// Returns { year, qid } | { year: null, stage } | FAILED.

import { titleMatches, authorMatches } from '../../src/lib/titleMatch.js';
import { wikidataYear } from './publicationYear.mjs';

const WD_API = 'https://www.wikidata.org/w/api.php';
const NAME_LANGS = 'en|es|pt|fr|de|it';
const EDITION_CLASS = 'Q3331189';
export const FAILED = Symbol('wikidata-failed');

export function makeWikidataYear({ userAgent, throttle, sleep, log = () => {} }) {
  const authorNameCache = new Map();
  let consecutiveFailures = 0;

  async function getJson(url, attempt = 1) {
    await throttle();
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent } });
      if (resp.status === 429 || resp.status === 503) {
        if (attempt <= 3) { await sleep(15_000 * attempt); return getJson(url, attempt + 1); }
        return fail(`HTTP ${resp.status} after 3 attempts`);
      }
      if (resp.status === 403) return fail('HTTP 403 — Wikidata wants a descriptive User-Agent');
      if (!resp.ok) return fail(`HTTP ${resp.status}`);
      const body = await resp.json();
      // MediaWiki answers 200 with {"error": …} for a bad parameter. That is a
      // failed call, not "Wikidata has never heard of this book".
      if (body?.error) return fail(`API error ${body.error.code}: ${body.error.info || ''}`);
      consecutiveFailures = 0;
      return body;
    } catch (e) {
      if (attempt <= 3) { await sleep(2000 * attempt); return getJson(url, attempt + 1); }
      return fail(`network: ${e.message}`);
    }
  }
  function fail(detail) {
    log(`wikidata: ${detail}`);
    if (++consecutiveFailures >= 12) throw new Error(`Wikidata returned 12 consecutive failures — aborting. Last: ${detail}`);
    return FAILED;
  }

  const claimQids = (ent, p) => (ent?.claims?.[p] || []).map((c) => c?.mainsnak?.datavalue?.value?.id).filter(Boolean);
  const claimStrings = (ent, p) => (ent?.claims?.[p] || []).map((c) => c?.mainsnak?.datavalue?.value).filter((v) => typeof v === 'string');
  const texts = (obj) => Object.values(obj || {}).flatMap((x) => (Array.isArray(x) ? x : [x])).map((x) => (typeof x === 'string' ? x : x?.value)).filter(Boolean);

  async function fetchEntities(qids, props) {
    const out = new Map();
    for (let i = 0; i < qids.length; i += 50) {
      const batch = qids.slice(i, i + 50);
      const data = await getJson(`${WD_API}?action=wbgetentities&ids=${batch.join('|')}&props=${props}&languages=${NAME_LANGS}&format=json&formatversion=2`);
      if (data === FAILED || !data?.entities) continue;
      for (const q of batch) if (data.entities[q] && !data.entities[q].missing) out.set(q, data.entities[q]);
    }
    return out;
  }

  async function authorNames(qids) {
    const want = [...new Set(qids)].filter((q) => !authorNameCache.has(q));
    if (want.length) {
      const ents = await fetchEntities(want, 'labels|aliases');
      for (const q of want) {
        const e = ents.get(q);
        authorNameCache.set(q, e ? [...texts(e.labels), ...texts(e.aliases)] : []);
      }
    }
    return qids.flatMap((q) => authorNameCache.get(q) || []);
  }

  return async function lookup(title, author) {
    const qids = new Set();
    let anyOk = false;
    const s1 = await getJson(`${WD_API}?action=wbsearchentities&search=${encodeURIComponent(title)}&language=en&uselang=en&type=item&limit=8&format=json&formatversion=2`);
    if (s1 !== FAILED) { anyOk = true; for (const s of s1?.search || []) if (s.id) qids.add(s.id); }
    const s2 = await getJson(`${WD_API}?action=query&list=search&srsearch=${encodeURIComponent(`${title} ${author}`)}&srnamespace=0&srlimit=8&format=json&formatversion=2`);
    if (s2 !== FAILED) { anyOk = true; for (const s of s2?.query?.search || []) if (/^Q\d+$/.test(s.title || '')) qids.add(s.title); }
    if (!anyOk) return FAILED;
    if (!qids.size) return { year: null, stage: 'no-search-hits' };

    let ents = await fetchEntities([...qids].slice(0, 14), 'claims|labels|aliases');
    // Editions → works.
    const workQids = [...ents.values()].filter((e) => claimQids(e, 'P31').includes(EDITION_CLASS)).flatMap((e) => claimQids(e, 'P629'));
    if (workQids.length) {
      const works = await fetchEntities([...new Set(workQids)].filter((q) => !ents.has(q)), 'claims|labels|aliases');
      const next = new Map();
      for (const [q, e] of ents) {
        if (!claimQids(e, 'P31').includes(EDITION_CLASS)) { next.set(q, e); continue; }
        for (const wq of claimQids(e, 'P629')) { const w = ents.get(wq) || works.get(wq); if (w) next.set(wq, w); }
      }
      ents = next;
    }

    let best = null;
    let stage = 'no-title-match';
    for (const [qid, e] of ents) {
      const labels = [...texts(e.labels), ...texts(e.aliases)];
      if (!labels.some((l) => titleMatches(title, l))) continue;
      stage = 'no-author-match';
      const names = [
        ...(await authorNames([...claimQids(e, 'P50'), ...claimQids(e, 'P170')])),
        ...claimStrings(e, 'P2093'),
      ];
      if (!names.length || !authorMatches(author, names)) continue;
      stage = 'no-p577';
      const years = (e.claims?.P577 || []).map((c) => wikidataYear(c?.mainsnak?.datavalue?.value)).filter((y) => y != null);
      if (!years.length) continue;
      const y = Math.min(...years);
      if (best == null || y < best.year) best = { year: y, qid };
    }
    return best || { year: null, stage };
  };
}
