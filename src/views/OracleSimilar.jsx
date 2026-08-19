import { useState, useMemo } from 'react';
import BookLoader from '../components/BookLoader';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { ALL_BOOKS, bookKey } from '../lib/bookHelpers';
import { callClaude, parseJSONResponse, QuotaExceededError } from '../lib/claudeApi';
import { logRecommendations, attachRecommendationIds } from '../lib/oracleProvenance';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { OracleQuotaWall } from '../components/OracleQuotaBadge';
import { useT, useI18n, langDirective } from '../lib/I18nContext';
import BookCard from '../components/BookCard';
import BookCover from '../components/BookCover';
import { buildTasteProfile, describeTasteProfile, MATCH_SCORING_INSTRUCTIONS } from '../lib/matchHelpers';
import { buildExcludeHint, buildShelfSignature, filterAlreadyKnown, REASON_INSTRUCTIONS, REPRESENTATION_INSTRUCTIONS } from '../lib/oraclePrompt';
import { saveDraw, loadDraw } from '../lib/oracleDrawCache';

// Max possible raw score per seed book (3 for genre + 2 for complexity + 1 for
// depth — see the scoring loop below), used to normalize into a 0-100 match %.
const MAX_SCORE_PER_SEED = 6;

// Ask for more than we show — the real dedupe against the whole shelf runs
// client-side after the response and needs something to cut into.
const SIMILAR_REQUEST = 8;
const SIMILAR_COUNT = 5;

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
  const maxPossible = selection.length * MAX_SCORE_PER_SEED;
  return {
    // This score is a genuine computation against the SEED books you picked
    // (not your overall taste profile) — "similar to these" is the whole
    // point of this mode, so that's the more correct basis here.
    books: scored.slice(0, 5).map((s) => ({
      ...s.book,
      match: maxPossible > 0 ? Math.round((s.score / maxPossible) * 100) : undefined,
    })),
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
  const { quota, handleQuotaError, onCallSucceeded, confirmOracleCall } = useOracleQuota();
  // v0.63.3: seed selection and results from the session cache. The seed books
  // come back too — a kinship result with no visible seeds is unreadable, since
  // "similar to WHAT" is the entire frame of this page.
  const cached = loadDraw('similar');
  const [selection, setSelection] = useState(() => cached?.selection || []);
  const [results, setResults] = useState(() => (cached?.results || null));
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // Single funnel for results, so nothing updates the grid without also
  // updating what a reload restores.
  function showResults(next, seeds = selection) {
    setResults(next);
    saveDraw('similar', { selection: seeds, results: next });
  }

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
    showResults(null);
  }

  async function findSimilar() {
    if (selection.length === 0) return;
    // v0.58: only the AI mode spends a call — wishlist mode is a local match,
    // so the gate is asked for here, before the spinner, but only on the AI
    // path. Confirming a charge for work that is free would train people to
    // click through the dialog without reading it.
    if (mode !== 'wishlist' && !(await confirmOracleCall('similar'))) return;
    setLoading(true);
    showResults(null);

    const wishlistPool = state.wishlist.filter(
      (b) => !selection.some((s) => bookKey(s) === bookKey(b))
    );

    if (mode === 'wishlist') {
      showResults(fallbackSimilar(selection, wishlistPool));
      setLoading(false);
      return;
    }

    // AI mode
    // v0.63.3 — THE 413 FIX, ported from OracleCategories (v0.63).
    //
    // Unbounded: every title the reader had ever touched, on every search. At
    // ~1,500 titles that is ~45k characters around a ~2k prompt, and claude.js
    // rejects anything over MAX_PROMPT_CHARS (50_000) with a 413 before
    // Anthropic sees it. v0.63 fixed this in By genres; the fix lived inside
    // that component, so this copy stayed broken.
    //
    // Bounded HINT in the prompt, exact guarantee in filterAlreadyKnown()
    // below. The seeds stay in `known` — recommending a book back to the
    // reader who just named it as a favourite is the one result this page
    // must never produce.
    const known = [...state.readNext, ...state.library, ...state.wishlist, ...selection];
    const exclude = buildExcludeHint(known);
    const seedBooks = selection
      .map((b) => `- "${b.t}" by ${b.a}${b.g ? ` (${b.g})` : ''}${b.d ? `: ${b.d}` : ''}`)
      .join('\n');
    const tasteProfile = buildTasteProfile(state.library, state.genresByBookId, state.profile);
    const tasteSummary = describeTasteProfile(tasteProfile);
    // v0.63.3: named books and ratings alongside the averages, so "kinship" can
    // be argued from something the reader recognises rather than asserted.
    const shelf = buildShelfSignature(state);

    const prompt = `A reader loves these books:
${seedBooks}

${tasteSummary ? tasteSummary + '\n\n' : ''}${shelf}

Recommend ${SIMILAR_REQUEST} OTHER books they would love — books with similar tone, themes, prose style, or atmosphere. You are NOT limited to any catalog; recommend the best matches in world literature.

Avoid recommending books they already know. Here is a sample of what is already on their shelves (not exhaustive): ${exclude}

Return ONLY valid JSON in this exact format:
{"books":[{"title":"...","author":"...","genre":"...","complexity":1-5,"depth":1-5,"description":"one-sentence description","reason":"one sentence on its kinship to the seed books, in this reader's terms","match":0-100}]}`;

    const response = await callClaude(
      prompt,
      `You are a literary expert recommending books based on a reader's tastes. Recommend accurately. Always return valid JSON. ${langDirective(lang)} Any natural-language field in the JSON (description, reason, genre label) MUST be in that language; titles and author names stay in their original language.\n${MATCH_SCORING_INSTRUCTIONS}\n${REASON_INSTRUCTIONS}\n${REPRESENTATION_INSTRUCTIONS}`,
      { source: 'similar' } // v0.58: history label (schema_v44)
    );

    let aiResults = null;
    if (response) {
      const parsed = parseJSONResponse(response);
      if (parsed?.books && Array.isArray(parsed.books)) {
        // v0.63.3: `why` rides on the book object rather than in a title-keyed
        // side map, which broke whenever the model's `title` and the rendered
        // title disagreed on punctuation, and could not reach the filter,
        // the slice, or logRecommendations.
        const books = filterAlreadyKnown(
          parsed.books
            .map((b) => ({
              t: b.title, a: b.author, g: b.genre || 'Recommended',
              c: b.complexity, p: b.depth, d: b.description, aiSuggested: true,
              why: b.reason || undefined,
              match: Number.isFinite(b.match) ? Math.max(0, Math.min(100, Math.round(b.match))) : undefined,
            }))
            .filter((b) => b.t && b.a),
          known
        ).slice(0, SIMILAR_COUNT);
        // Below three survivors the wishlist fallback is the better answer —
        // unchanged from v0.58, but it now measures what is left AFTER the
        // shelf filter rather than before it.
        if (books.length >= 3) {
          // v0.58 provenance. Only the AI branch logs — the wishlist fallback
          // below is a local match, not an Oracle recommendation, and counting
          // it would inflate the accept rate with books the Oracle never chose.
          const ids = await logRecommendations('similar', books);
          aiResults = { books: attachRecommendationIds(books, ids), source: 'ai' };
        }
      }
    }

    if (aiResults) {
      showResults(aiResults);
    } else {
      showToast("Couldn't reach the AI. Showing wishlist matches instead.", true);
      showResults(fallbackSimilar(selection, wishlistPool));
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
                  reason={b.why}
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
