import { useState, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { ALL_BOOKS, bookKey, PALETTES, ORNAMENTS, hashStr } from '../lib/bookHelpers';
import { callClaude, parseJSONResponse, QuotaExceededError } from '../lib/claudeApi';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { OracleQuotaWall } from '../components/OracleQuotaBadge';
import { useT, useI18n, langDirective } from '../lib/I18nContext';
import BookCard from '../components/BookCard';

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
  const palette = PALETTES[hashStr(book.t) % PALETTES.length];
  const orn = ORNAMENTS[hashStr(book.a || '') % ORNAMENTS.length];
  return (
    <div className={`card selectable ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="cover">
        <div className="placeholder" style={{ background: palette.bg }}>
          <div className="ph-ornament" style={{ color: palette.accent }}>{orn}</div>
          <div className="ph-title">{book.t}</div>
          <div className="ph-author" style={{ color: palette.accent }}>{book.a || ''}</div>
          <div className="ph-ornament" style={{ color: palette.accent }}>{orn}</div>
        </div>
      </div>
      <div className="card-title">{book.t}</div>
      <div className="card-author">{book.a}</div>
      {book.g && <div className="card-tag">{book.g}</div>}
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
      <div className="page-header">
        <div className="page-eyebrow">Based on other books</div>
        <h1 className="page-title">Pick <span className="accent">1–3 books</span> you've loved</h1>
        <p className="page-subtitle">
          {mode === 'wishlist'
            ? "We'll find kindred books from your wishlist."
            : "We'll ask the AI to suggest kindred books (may go beyond your wishlist)."}
        </p>
      </div>

      <div className="oracle-mode-toggle">
        <span className="oracle-mode-label">Source:</span>
        <div className="toggle-group">
          <button className={`toggle-btn ${mode === 'wishlist' ? 'active' : ''}`} onClick={() => setMode('wishlist')}>
            ❦ My wishlist
            <span className="toggle-sub">tag-matched, instant</span>
          </button>
          <button className={`toggle-btn ${mode === 'ai' ? 'active' : ''}`} onClick={() => setMode('ai')}>
            ✦ AI recommends
            <span className="toggle-sub">may go beyond wishlist</span>
          </button>
        </div>
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

      <div className="search-box">
        <input
          type="text"
          className="search-input"
          placeholder="Search books to add…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
        <button className="btn" onClick={findSimilar} disabled={selection.length === 0 || loading || (mode === 'ai' && quota && !quota.unlimited && quota.calls_remaining === 0)}>
          {loading ? t('oracle.similarDivining') : t('oracle.similarFind')}
        </button>
        {mode === 'ai' && quota && !quota.unlimited && quota.calls_remaining === 0 && (
          <OracleQuotaWall />
        )}
      </div>

      <div>
        {loading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
            <div className="loading-text">Consulting the oracle…</div>
          </div>
        ) : results ? (
          <>
            <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: '1.5rem', color: 'var(--paper)' }}>
              Found <span style={{ color: 'var(--gilt)' }}>{results.books.length}</span> kindred books
              <span style={{ fontSize: '0.85rem', color: 'var(--paper-aged)', opacity: 0.6, fontStyle: 'normal', fontFamily: "'Special Elite', monospace", letterSpacing: '0.1em', marginLeft: '0.7rem' }}>
                {results.source === 'ai' ? '· AI-divined' : '· tag-matched from wishlist'}
              </span>
            </h2>
            <div className="cards">
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

      <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', margin: '2rem 0 1rem', color: 'var(--paper)' }}>
        {state.library.length > 0 ? 'From your library and wishlist' : 'From your wishlist'}
      </h2>
      <div className="cards">
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
