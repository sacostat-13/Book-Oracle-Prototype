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
import { bookKey } from '../lib/bookHelpers';
import { hardcoverSearchMulti } from '../lib/hardcoverService';
import { callClaude, parseJSONResponse, QuotaExceededError } from '../lib/claudeApi';
import BookCover from './BookCover';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

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
    const raw = await callClaude(prompt, systemPrompt);
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

    const newHits = hcHits.filter((b) => !localKeys.has(bookKey(b)));

    // 3. Claude fallback — only if Hardcover returned nothing at all
    if (hcHits.length === 0 && q.length >= 4) {
      let claudeHit = null;
      try {
        claudeHit = await claudeBookFallback(q);
      } catch { /* ignore */ }
      if (searchIdRef.current !== id) return;
      if (claudeHit && !localKeys.has(bookKey(claudeHit))) {
        newHits.push({ ...claudeHit, _fromClaude: true });
      }
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
      // Preview book — pass through App state
      onPreviewBook(book);
      go('book-page', {
        preview: 'true',
        from: 'search',
        fromLabel: t('navSearch.fromSearch'),
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
