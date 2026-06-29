import { useState, useMemo, useEffect } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { ALL_BOOKS, bookKey } from '../lib/bookHelpers';
import { callClaude, parseJSONResponse, QuotaExceededError } from '../lib/claudeApi';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { OracleQuotaBadge, OracleQuotaWall } from '../components/OracleQuotaBadge';
import { useT, useI18n, langDirective } from '../lib/I18nContext';
import BookCard from '../components/BookCard';

// v0.15 phase 2.6: copy pass — "categories" → "genres" throughout.
// The Temperament dropdown now draws from Oracle genres (genresByBookId)
// for wishlist/vault modes, falling back to b.g for uncategorized books.
// Route name (oracle-categories) is kept for URL stability.

export default function OracleCategories({ onOpenBook }) {
  const { state, setOracleMode, showToast, vault, loadVault } = useData();
  const { go } = useRouter();
  const t = useT();
  const { lang } = useI18n();
  const { quota, handleQuotaError, onCallSucceeded } = useOracleQuota();
  const [genre, setGenre] = useState('all');
  const [draw, setDraw] = useState([]);
  const [loading, setLoading] = useState(false);

  const mode = state.oracleMode || 'wishlist';
  const { genresByBookId } = state;

  // Lazily load the Vault when user picks vault mode
  useEffect(() => {
    if (mode === 'vault' && !vault) loadVault();
  }, [mode, vault, loadVault]);

  const sourceBooks = useMemo(() => {
    if (mode === 'wishlist') return state.wishlist;
    if (mode === 'vault') return vault || [];
    return ALL_BOOKS;
  }, [mode, state.wishlist, vault]);

  // v0.15: build genre options from Oracle genresByBookId first,
  // falling back to b.g for books not yet categorized.
  const sourceGenres = useMemo(() => {
    const seen = new Map(); // normalizedName → display name
    for (const b of sourceBooks) {
      const genres = genresByBookId[b.bookId] || [];
      if (genres.length > 0) {
        for (const g of genres) {
          if (!seen.has(g.normalizedName)) seen.set(g.normalizedName, g.name);
        }
      } else if (b.g) {
        // fallback for uncategorized books
        const norm = b.g.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!seen.has(norm)) seen.set(norm, b.g);
      }
    }
    return Array.from(seen.entries())
      .map(([norm, name]) => ({ norm, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sourceBooks, genresByBookId]);

  function setMode(newMode) {
    if (newMode === mode) return;
    setOracleMode(newMode);
    setDraw([]);
    setGenre('all');
  }

  // Check if a book matches the selected genre filter.
  function bookMatchesGenre(b) {
    if (genre === 'all') return true;
    const genres = genresByBookId[b.bookId] || [];
    if (genres.length > 0) {
      return genres.some((g) => g.normalizedName === genre);
    }
    // fallback: match against b.g
    const norm = (b.g || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return norm === genre;
  }

  async function handleDraw() {
    const inUse = new Set([...state.readNext, ...state.library].map(bookKey));

    if (mode === 'wishlist' || mode === 'vault') {
      const source = mode === 'wishlist' ? state.wishlist : (vault || []);
      const pool = source.filter(bookMatchesGenre);
      const available = pool.filter((b) => !inUse.has(bookKey(b)));
      if (available.length === 0) {
        showToast(`Nothing left to draw in that genre from ${mode === 'wishlist' ? 'your wishlist' : 'the Vault'}.`, true);
        return;
      }
      const shuffled = [...available].sort(() => Math.random() - 0.5);
      setDraw(shuffled.slice(0, Math.min(3, shuffled.length)));
      return;
    }

    // AI mode
    setLoading(true);
    setDraw([]);
    try {
      const profileLevel = state.profile.readingLevel || 3;
      const libContext = state.library.slice(-15).map((b) => `- ${b.t} by ${b.a}`).join('\n') || '(none)';
      const wishContext = state.wishlist.slice(0, 30).map((b) => `- ${b.t}`).join('\n') || '(none)';
      const exclude = [...state.readNext, ...state.library, ...state.wishlist].map((b) => `"${b.t}"`).join(', ');

      // Use the display name of the selected genre for the AI prompt
      const selectedGenreName = sourceGenres.find((g) => g.norm === genre)?.name;
      const genreHint = genre === 'all'
        ? 'Any genre that suits the reader.'
        : `Genre: ${selectedGenreName || genre}.`;

      const prompt = `Recommend 3 books for a reader at reading level ${profileLevel}/5 (1=casual, 5=experimental).
${genreHint}

Books they've read recently:
${libContext}

Books currently on their wishlist (to give you a sense of taste — feel free to go beyond these):
${wishContext}

Do NOT recommend any book in this list (already known to them): ${exclude}

Return ONLY valid JSON in this format:
{"books":[{"title":"...","author":"...","genre":"...","complexity":1-5,"depth":1-5,"description":"one-sentence description"}]}`;

      let response = null;
      try {
        response = await callClaude(
          prompt,
          `You are a literary curator. Recommend books accurately. Always return valid JSON. ${langDirective(lang)} Any natural-language field in the JSON (description, genre label) MUST be in that language; titles and author names stay in their original language.`
        );
        onCallSucceeded();
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          handleQuotaError(err);
          setLoading(false);
          return;
        }
        throw err;
      }

      let books = null;
      if (response) {
        const parsed = parseJSONResponse(response);
        if (parsed?.books && Array.isArray(parsed.books)) {
          books = parsed.books
            .map((b) => ({
              t: b.title, a: b.author,
              g: b.genre || (genre !== 'all' ? selectedGenreName : 'Recommended'),
              c: b.complexity, p: b.depth, d: b.description,
              aiSuggested: true,
            }))
            .filter((b) => b.t && b.a);
        }
      }

      if (!books || books.length === 0) {
        // Fall back to Vault first, then wishlist
        const v = vault || (await loadVault());
        const vaultPool = v.filter(bookMatchesGenre).filter((b) => !inUse.has(bookKey(b)));
        if (vaultPool.length > 0) {
          showToast("Couldn't reach the AI. Drawing from the Vault instead.", true);
          const shuffled = [...vaultPool].sort(() => Math.random() - 0.5);
          setDraw(shuffled.slice(0, Math.min(3, shuffled.length)));
        } else {
          showToast("Couldn't reach the AI. Falling back to your wishlist.", true);
          const pool = state.wishlist.filter(bookMatchesGenre);
          const available = pool.filter((b) => !inUse.has(bookKey(b)));
          const shuffled = [...available].sort(() => Math.random() - 0.5);
          setDraw(shuffled.slice(0, Math.min(3, shuffled.length)));
        }
      } else {
        setDraw(books);
      }
    } finally {
      setLoading(false);
    }
  }

  const sourceDesc = {
    wishlist: 'from your wishlist',
    vault: 'from the Vault',
    ai: 'from anywhere (AI)',
  }[mode];

  const quotaExhausted = quota && quota.calls_remaining === 0;

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · <a onClick={() => go('oracle')}>Oracle</a> · By Genres
      </div>
      <div className="page-header">
        <div className="page-eyebrow">By genres</div>
        <h1 className="page-title">Choose a <span className="accent">temperament</span></h1>
        <p className="page-subtitle">
          Three books drawn fresh, {sourceDesc}.
        </p>
      </div>

      <div className="oracle-mode-toggle">
        <span className="oracle-mode-label">Source:</span>
        <div className="toggle-group">
          <button className={`toggle-btn ${mode === 'wishlist' ? 'active' : ''}`} onClick={() => setMode('wishlist')}>
            ❦ My wishlist
            <span className="toggle-sub">{state.wishlist.length} books</span>
          </button>
          <button className={`toggle-btn ${mode === 'vault' ? 'active' : ''}`} onClick={() => setMode('vault')}>
            ☩ The Vault
            <span className="toggle-sub">{vault ? `${vault.length} curated` : 'curated catalog'}</span>
          </button>
          <button className={`toggle-btn ${mode === 'ai' ? 'active' : ''}`} onClick={() => setMode('ai')}>
            ✦ AI recommends
            <span className="toggle-sub">may go beyond catalogs</span>
          </button>
        </div>
      </div>

      <section className="controls">
        <div className="field">
          <label>Temperament</label>
          <select value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="all">— All books {sourceDesc} —</option>
            {sourceGenres.map((g) => (
              <option key={g.norm} value={g.norm}>☩ {g.name}</option>
            ))}
          </select>
        </div>
        <button className="btn" onClick={handleDraw} disabled={loading || (mode === 'ai' && quotaExhausted)}>
          {loading ? t('oracle.categoriesDrawing') : t('oracle.categoriesDraw')}
        </button>
        {mode === 'ai' && quotaExhausted && (
          <div className="lv-load-more">
            <OracleQuotaWall />
          </div>
        )}
      </section>

      <section className="cards">
        {loading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
            <div className="loading-text">The oracle is divining…</div>
          </div>
        ) : draw.length === 0 ? (
          <div className="empty-state">
            <div className="ornament">❦</div>
            <div className="empty-state-title">Awaiting your choice</div>
            <div className="empty-state-text">Select a temperament above and draw three books.</div>
          </div>
        ) : (
          draw.map((b, i) => <BookCard key={`${bookKey(b)}-${i}`} book={b} onClick={() => onOpenBook?.(b)} />)
        )}
      </section>
    </>
  );
}
