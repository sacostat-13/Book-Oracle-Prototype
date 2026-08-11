// NavSearch.jsx — v0.19
// Global predictive search bar. Replaces the nav-search-placeholder div.
//
// Two-tier results (seamless, no visible tier labels):
//   1. Local — instant match from wishlist + library + readNext in memory.
//              Result carries a status badge ("In wishlist", "Read", etc.)
//   2. Hardcover — debounced search (300ms) for books not in the local collection.
//   3. Claude fallback — only if Hardcover returns zero hits, Claude generates
//      a book object from its training knowledge.
//
// Selecting any result:
//   - Sets the result as the App-level previewBook (passed down as prop)
//   - Navigates to 'book-page' with preview=true
//   - If the book is already in the collection, navigates via bookKey instead
//
// The book page handles saving when the user taps Add to Wishlist / Mark as Read.
// Viewing alone silently upserts the book with status='discovered'.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { bookKey, buildBookPageParams } from '../lib/bookHelpers';
import { hardcoverSearchMulti } from '../lib/hardcoverService';
import { googleBooksSearchMulti, titleMatchScore } from '../lib/googleBooksService';
import { callClaude, parseJSONResponse, QuotaExceededError } from '../lib/claudeApi';
import BookCover from './BookCover';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

// Extra pause (on top of the debounce) before the Claude book-identification
// tier fires — so it doesn't run on every intermediate keystroke while the user
// is still typing a long title. ~300ms debounce + this ≈ 0.8s of stillness.
const CLAUDE_TIER_DELAY_MS = 500;

// Session cache of Claude search identifications, keyed by normalized query.
// Stores the outcome (book or null) so repeat/near-repeat searches never re-hit
// the (paid) Claude tier. Discovered books also upsert to the shared catalog, so
// most repeats resolve via Hardcover/local before ever reaching this.
const claudeSearchCache = new Map();
const CLAUDE_CACHE_MAX = 200;
const normQuery = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// A Hardcover hit counts as a "strong" match only if it shares at least this
// share of the query's distinctive words. Hardcover's fuzzy search happily
// returns near-misses (e.g. "Antes que Morras" for "Morras Malditas"); those
// shouldn't suppress the Google Books / Claude fallbacks.
//
// 0.67, not 0.5: a two-word query like "morras malditas" has only two
// distinctive tokens, so a 0.5 bar was cleared by "Antes que Morras" matching
// just ONE of them ("morras") — masking the miss. At 0.67 a two-token query
// effectively needs both words to match, while longer queries still tolerate
// one missing word.
const STRONG_MATCH = 0.67;

// Claude fallback: ask Claude to identify the book and return structured data.
async function claudeBookFallback(query) {
  try {
    const prompt = `A user searched for: "${query}"
Identify the most likely book this refers to. Return ONLY valid JSON, no markdown, no preamble:
{
  "t": "exact title",
  "a": "author full name",
  "d": "2-3 sentence description",
  "g": "primary genre",
  "s": { "name": "series name if part of one, else null", "n": 1, "total": null }
}
If s is not applicable, set it to null. If you cannot confidently identify a book, return null.`;
    const systemPrompt = 'You are a book identification assistant. Return only valid JSON with no markdown fences.';
    // feature:'search' → server routes this to the free Haiku tier and does NOT
    // charge the user's Oracle quota (see netlify/functions/claude.js).
    const raw = await callClaude(prompt, systemPrompt, { feature: 'search', maxTokens: 300 });
    const parsed = parseJSONResponse(raw);
    if (!parsed || !parsed.t || !parsed.a) return null;
    return { ...parsed, fromClaude: true, needsReview: true };
  } catch (err) {
    if (err instanceof QuotaExceededError) return null; // silently skip — search just shows no AI result
    return null;
  }
}

export default function NavSearch({ onPreviewBook }) {
  const { state } = useData();
  const { go } = useRouter();
  const t = useT();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const debounceRef = useRef(null);
  const searchIdRef = useRef(0);

  // All books currently in the user's collection (all three lists)
  const collectionBooks = useMemo(() => [
    ...state.wishlist,
    ...state.library,
    ...state.readNext,
  ], [state.wishlist, state.library, state.readNext]);

  // Collection status label for a book
  function collectionStatus(b) {
    const k = bookKey(b);
    if (state.library.some((x) => bookKey(x) === k)) return t('navSearch.statusRead');
    if (state.readNext.some((x) => bookKey(x) === k)) return t('navSearch.statusQueued');
    if (state.wishlist.some((x) => bookKey(x) === k)) return t('navSearch.statusWishlist');
    return null;
  }

  const search = useCallback(async (q) => {
    if (q.length < MIN_QUERY_LEN) {
      setResults([]);
      setLoading(false);
      return;
    }

    // Increment search ID — used to discard stale responses
    const id = ++searchIdRef.current;

    // 1. Instant local match
    const ql = q.toLowerCase();
    const localHits = collectionBooks
      .filter((b) => b.t?.toLowerCase().includes(ql) || b.a?.toLowerCase().includes(ql))
      .slice(0, 4)
      .map((b) => ({ ...b, _inCollection: true, _status: collectionStatus(b) }));

    // Dedupe keys so local hits don't reappear in Hardcover results
    const localKeys = new Set(localHits.map((b) => bookKey(b)));

    setResults(localHits);
    setLoading(true);

    // 2. Hardcover search (debounced by caller)
    let hcHits = [];
    try {
      hcHits = await hardcoverSearchMulti(q, 6);
    } catch {
      hcHits = [];
    }
    if (searchIdRef.current !== id) return; // stale

    let newHits = hcHits.filter((b) => !localKeys.has(bookKey(b)));

    // Did Hardcover actually find THIS book, or just fuzzy near-misses?
    // "Antes que Morras" for "Morras Malditas" is a hit but not a real match.
    const hasStrongHc = hcHits.some((b) => titleMatchScore(q, b.t || '') >= STRONG_MATCH);

    // Fallbacks run whenever Hardcover has no strong match. Their validated
    // results lead the list, ABOVE Hardcover's weak near-misses.
    if (!hasStrongHc) {
      const lang = (document.documentElement.lang || 'en').startsWith('es') ? 'es' : 'en';
      const existingKeys = new Set([...localKeys, ...newHits.map((b) => bookKey(b))]);
      const fallbackHits = [];

      // 3. Google Books — deterministic, NO Claude tokens. Covers Spanish /
      //    Latin American titles the English-weighted Hardcover index misses.
      let gbHits = [];
      try {
        gbHits = await googleBooksSearchMulti(q, lang, 6);
      } catch { /* ignore */ }
      if (searchIdRef.current !== id) return;
      for (const b of gbHits) {
        const key = bookKey(b);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        fallbackHits.push({ ...b, _fromGoogleBooks: true });
      }

      // 4. Claude — last resort, only if Google Books found nothing. Free tier
      //    (Haiku, not charged against Oracle quota). Cached per query, and
      //    gated behind an extra pause so it doesn't fire mid-typing.
      if (fallbackHits.length === 0 && q.length >= 4) {
        const cacheKey = normQuery(q);
        if (claudeSearchCache.has(cacheKey)) {
          const cached = claudeSearchCache.get(cacheKey);
          if (cached && !existingKeys.has(bookKey(cached))) {
            fallbackHits.push({ ...cached, _fromClaude: true });
          }
        } else {
          // Wait for the user to settle; if they kept typing, a newer search
          // owns the result and we bail without spending a Claude call.
          await new Promise((r) => setTimeout(r, CLAUDE_TIER_DELAY_MS));
          if (searchIdRef.current !== id) return;
          let claudeHit = null;
          try {
            claudeHit = await claudeBookFallback(q);
          } catch { /* ignore */ }
          if (searchIdRef.current !== id) return;
          // Cache the outcome (including null) so repeats don't re-hit Claude.
          if (claudeSearchCache.size >= CLAUDE_CACHE_MAX) claudeSearchCache.clear();
          claudeSearchCache.set(cacheKey, claudeHit || null);
          if (claudeHit && !existingKeys.has(bookKey(claudeHit))) {
            fallbackHits.push({ ...claudeHit, _fromClaude: true });
          }
        }
      }

      // Validated fallback matches lead; weak Hardcover near-misses fall below.
      newHits = [...fallbackHits, ...newHits];
    }

    setResults([...localHits, ...newHits]);
    setLoading(false);
  }, [collectionBooks, state.library, state.readNext, state.wishlist, t]);

  // Debounce input changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < MIN_QUERY_LEN) {
      setResults([]);
      setLoading(false);
      setActiveIdx(-1);
      return;
    }
    debounceRef.current = setTimeout(() => search(query), DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [query, search]);

  // Click outside to close
  useEffect(() => {
    function onClickOutside(e) {
      if (
        inputRef.current && !inputRef.current.contains(e.target) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function selectResult(book) {
    setOpen(false);
    setQuery('');
    setResults([]);
    inputRef.current?.blur();

    if (book._inCollection) {
      // Already in collection — navigate via bookKey
      go('book-page', {
        bookKey: bookKey(book),
        from: 'search',
        fromLabel: t('navSearch.fromSearch'),
      });
    } else {
      // Preview book — pass through App state.
      //
      // v0.62.2: this used to omit bookKey entirely, on the reasoning that
      // BookPage resolves a preview from previewBookRef and never needs it.
      // True for rendering, false for the URL: 'book-page' is the dynamic route
      // /book/:bookKey, so buildPath() found a missing segment param, returned
      // null, and RouterProvider skipped pushState. The view changed and the
      // address bar did not — open five books from search in a row and the URL
      // still said '/'. Back, refresh, copy-link and share were all broken for
      // every book found through search that wasn't already in the collection.
      //
      // buildBookPageParams also carries the `snap` payload, which is what
      // makes such a URL survive a reload or a paste into another tab — its own
      // doc comment describes exactly this failure. previewBookRef still wins
      // in-session (BookPage checks preview first), so nothing about the
      // immediate render changes.
      onPreviewBook(book);
      go('book-page', {
        ...buildBookPageParams(book, 'search', t('navSearch.fromSearch')),
        preview: 'true',
      });
    }
  }

  function onKeyDown(e) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      selectResult(results[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showDropdown = open && (results.length > 0 || loading);

  return (
    <div className="nav-search">
      <div className="nav-search-input-wrap">
        <input
          ref={inputRef}
          className="nav-search-input"
          type="search"
          autoComplete="off"
          spellCheck="false"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIdx(-1); }}
          onFocus={() => { if (query.length >= MIN_QUERY_LEN) setOpen(true); }}
          onKeyDown={onKeyDown}
          aria-label={t('search.ariaLabel')}
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          role="combobox"
        />
        {loading && <span className="nav-search-spinner" aria-hidden="true" />}
      </div>

      {showDropdown && (
        <ul
          ref={dropdownRef}
          className="nav-search-dropdown"
          role="listbox"
          aria-label={t('navSearch.resultsAriaLabel')}
        >
          {results.map((book, idx) => {
            const isActive = idx === activeIdx;
            const status = book._status || (book._inCollection ? collectionStatus(book) : null);
            return (
              <li
                key={`${bookKey(book)}-${idx}`}
                className={`nav-search-result${isActive ? ' active' : ''}`}
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => selectResult(book)}
              >
                <div className="nav-search-result-cover">
                  <BookCover title={book.t} author={book.a} coverUrl={book.coverUrl} />
                </div>
                <div className="nav-search-result-info">
                  <div className="nav-search-result-title">{book.t}</div>
                  <div className="nav-search-result-author">{book.a}</div>
                  {book.s?.name && (
                    <div className="nav-search-result-series">{book.s.name}</div>
                  )}
                </div>
                {status && (
                  <span className="nav-search-result-badge">{status}</span>
                )}
                {book._fromClaude && (
                  <span className="nav-search-result-badge nav-search-result-badge--oracle">Oracle</span>
                )}
              </li>
            );
          })}
          {loading && results.length === 0 && (
            <li className="nav-search-loading" aria-live="polite">
              {t('navSearch.loadingText')}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
