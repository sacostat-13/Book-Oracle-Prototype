import { useState, useMemo } from 'react';
import BookLoader from '../components/BookLoader';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { ALL_BOOKS, bookKey } from '../lib/bookHelpers';
import { callClaude, parseJSONResponse, QuotaExceededError } from '../lib/claudeApi';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { OracleQuotaWall } from '../components/OracleQuotaBadge';
import { useT, useI18n, langDirective } from '../lib/I18nContext';
import BookCard from '../components/BookCard';
import BookCover from '../components/BookCover';

function fallbackSimilar(selection, candidates) {
  const scored = candidates.map((c) => {
    let score = 0;
    for (const s of selection) {
      if (s.g && c.g === s.g) score += 3;
      if (s.c && c.c && Math.abs(c.c - s.c) <= 1) score += 2;
      if (s.p && c.p && Math.abs(c.p - s.p) <= 1) score += 1;
    }
    return { book: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return {
    books: scored.slice(0, 5).map((s) => s.book),
    reasons: {},
    source: 'fallback',
  };
}

function SelectableCard({ book, selected, onClick }) {
  return (
    <div className={`book-tile${selected ? ' selected' : ''}`} onClick={onClick}>
      <div className="book-tile__cover">
        <BookCover title={book.t} author={book.a} coverUrl={book.coverUrl} />
      </div>
      <div className="book-tile__title">{book.t}</div>
      <div className="book-tile__author">{book.a}</div>
      {book.g && <span className="chip">{book.g}</span>}
    </div>
  );
}

export default function OracleSimilar({ onOpenBook }) {
  const { state, setOracleMode, showToast } = useData();
  const { go } = useRouter();
  const t = useT();
  const { lang } = useI18n();
  const { quota, handleQuotaError, onCallSucceeded } = useOracleQuota();
  const [selection, setSelection] = useState([]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const mode = state.oracleMode || 'wishlist';

  const querySource = useMemo(() => {
    const base = state.library.length > 0
      ? [...state.library, ...state.wishlist]
      : state.wishlist;
    // dedupe by key
    const seen = new Set();
    return base.filter((b) => {
      const k = bookKey(b);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [state.library, state.wishlist]);

  const filteredPicker = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return querySource.slice(0, 80);
    return querySource
      .filter((b) => b.t.toLowerCase().includes(q) || (b.a || '').toLowerCase().includes(q))
      .slice(0, 80);
  }, [querySource, search]);

  function toggleSelect(book) {
    const k = bookKey(book);
    const idx = selection.findIndex((s) => bookKey(s) === k);
    if (idx >= 0) {
      setSelection(selection.filter((_, i) => i !== idx));
    } else {
      if (selection.length >= 3) {
        showToast('Pick up to 3 books', true);
        return;
      }
      setSelection([...selection, book]);
    }
  }

  function setMode(newMode) {
    if (newMode === mode) return;
    setOracleMode(newMode);
    setResults(null);
  }

  async function findSimilar() {
    if (selection.length === 0) return;
    setLoading(true);
    setResults(null);

    const wishlistPool = state.wishlist.filter(
      (b) => !selection.some((s) => bookKey(s) === bookKey(b))
    );

    if (mode === 'wishlist') {
      setResults(fallbackSimilar(selection, wishlistPool));
      setLoading(false);
      return;
    }

    // AI mode
    const exclude = [...state.readNext, ...state.library, ...state.wishlist, ...selection]
      .map((b) => `"${b.t}"`)
      .join(', ');
    const seedBooks = selection
      .map((b) => `- "${b.t}" by ${b.a}${b.g ? ` (${b.g})` : ''}${b.d ? `: ${b.d}` : ''}`)
      .join('\n');

    const prompt = `A reader loves these books:
${seedBooks}

Recommend 5 OTHER books they would love — books with similar tone, themes, prose style, or atmosphere. You are NOT limited to any catalog; recommend the best matches in world literature.

Do NOT recommend any of these (already known to reader): ${exclude}

Return ONLY valid JSON in this exact format:
{"books":[{"title":"...","author":"...","genre":"...","complexity":1-5,"depth":1-5,"description":"one-sentence description","reason":"one-sentence kinship to the seed books"}]}`;

    const response = await callClaude(
      prompt,
      `You are a literary expert recommending books based on a reader's tastes. Recommend accurately. Always return valid JSON. ${langDirective(lang)} Any natural-language field in the JSON (description, reason, genre label) MUST be in that language; titles and author names stay in their original language.`
    );

    let aiResults = null;
    if (response) {
      const parsed = parseJSONResponse(response);
      if (parsed?.books && Array.isArray(parsed.books)) {
        const books = parsed.books
          .map((b) => ({
            t: b.title, a: b.author, g: b.genre || 'Recommended',
            c: b.complexity, p: b.depth, d: b.description, aiSuggested: true,
          }))
          .filter((b) => b.t && b.a);
        const reasons = {};
        parsed.books.forEach((b) => { if (b.reason) reasons[b.title] = b.reason; });
        if (books.length >= 3) {
          aiResults = { books, reasons, source: 'ai' };
        }
      }
    }

    if (aiResults) {
      setResults(aiResults);
    } else {
      showToast("Couldn't reach the AI. Showing wishlist matches instead.", true);
      setResults(fallbackSimilar(selection, wishlistPool));
    }
    setLoading(false);
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · <a onClick={() => go('oracle')}>Oracle</a> · Similar Books
      </div>
      <div className="page-head">
        <div className="page-head__eyebrow">Based on other books</div>
        <h1 className="page-head__title">Pick <span className="accent">1–3 books</span> you've loved</h1>
        <p className="page-head__lead">
          {mode === 'wishlist'
            ? "We'll find kindred books from your wishlist."
            : "We'll ask the AI to suggest kindred books (may go beyond your wishlist)."}
        </p>
      </div>

      <div className="source-tabs">
        <span className="source-tabs__label">Source:</span>
        <button className={`source-tab${mode === 'wishlist' ? ' active' : ''}`} onClick={() => setMode('wishlist')}>
          <div className="source-tab__head">
            <span className="source-tab__glyph">❦</span>
            <span className="source-tab__title">My wishlist</span>
          </div>
          <div className="source-tab__sub">tag-matched, instant</div>
        </button>
        <button className={`source-tab${mode === 'ai' ? ' active' : ''}`} onClick={() => setMode('ai')}>
          <div className="source-tab__head">
            <span className="source-tab__glyph">✦</span>
            <span className="source-tab__title">AI recommends</span>
          </div>
          <div className="source-tab__sub">may go beyond wishlist</div>
        </button>
      </div>

      <div className="selection-tray">
        {selection.length === 0 ? (
          <div className="tray-empty">Select up to 3 books below…</div>
        ) : (
          selection.map((b, i) => (
            <div className="tray-chip" key={`${bookKey(b)}-${i}`}>
              <span className="chip-title">{b.t}</span>
              <button className="chip-remove" onClick={() => setSelection(selection.filter((_, idx) => idx !== i))}>×</button>
            </div>
          ))
        )}
      </div>

      <div className="search">
        <svg className="search__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input
          type="text"
          className="search__input"
          placeholder="Search books to add…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="oracle-results-head">
        <button className="btn-primary" onClick={findSimilar} disabled={selection.length === 0 || loading || (mode === 'ai' && quota && quota.calls_remaining === 0)}>
          {loading ? t('oracle.similarDivining') : t('oracle.similarFind')}
        </button>
        {mode === 'ai' && quota && quota.calls_remaining === 0 && (
          <OracleQuotaWall />
        )}
      </div>

      <div>
        {loading ? (
          <BookLoader text="Consulting the oracle…" />
        ) : results ? (
          <>
            <h2 className="oracle-results-title">
              Found <em>{results.books.length}</em> kindred books
              <span className="oracle-results-sub">
                {results.source === 'ai' ? '· AI-divined' : '· tag-matched from wishlist'}
              </span>
            </h2>
            <div className="oracle-results-grid">
              {results.books.map((b, i) => (
                <BookCard
                  key={`${bookKey(b)}-${i}`}
                  book={b}
                  reason={results.reasons?.[b.t]}
                  onClick={() => onOpenBook?.(b)}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      <h2 className="legal-section__title">
        {state.library.length > 0 ? 'From your library and wishlist' : 'From your wishlist'}
      </h2>
      <div className="book-tile-grid">
        {filteredPicker.map((b, i) => (
          <SelectableCard
            key={`${bookKey(b)}-${i}`}
            book={b}
            selected={selection.some((s) => bookKey(s) === bookKey(b))}
            onClick={() => toggleSelect(b)}
          />
        ))}
      </div>
    </>
  );
}
