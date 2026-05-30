import { useState, useMemo, useEffect } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { ALL_BOOKS, bookKey } from '../lib/bookHelpers';
import { callClaude, parseJSONResponse } from '../lib/claudeApi';
import BookCard from '../components/BookCard';

export default function OracleCategories({ onOpenBook }) {
  const { state, setOracleMode, showToast, vault, loadVault } = useData();
  const { go } = useRouter();
  const [genre, setGenre] = useState('all');
  const [draw, setDraw] = useState([]);
  const [loading, setLoading] = useState(false);

  const mode = state.oracleMode || 'wishlist';

  // Lazily load the Vault when user picks vault mode
  useEffect(() => {
    if (mode === 'vault' && !vault) loadVault();
  }, [mode, vault, loadVault]);

  const sourceBooks = useMemo(() => {
    if (mode === 'wishlist') return state.wishlist;
    if (mode === 'vault') return vault || [];
    return ALL_BOOKS;
  }, [mode, state.wishlist, vault]);

  const sourceGenres = useMemo(
    () => [...new Set(sourceBooks.map((b) => b.g).filter(Boolean))].sort(),
    [sourceBooks]
  );

  function setMode(newMode) {
    if (newMode === mode) return;
    setOracleMode(newMode);
    setDraw([]);
  }

  async function handleDraw() {
    const inUse = new Set([...state.readNext, ...state.library].map(bookKey));

    if (mode === 'wishlist' || mode === 'vault') {
      const source = mode === 'wishlist' ? state.wishlist : (vault || []);
      const pool = genre === 'all' ? source : source.filter((b) => b.g === genre);
      const available = pool.filter((b) => !inUse.has(bookKey(b)));
      if (available.length === 0) {
        showToast(`Nothing left to draw in that category from ${mode === 'wishlist' ? 'your wishlist' : 'the Vault'}.`, true);
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
      const genreHint = genre === 'all' ? 'Any genre that suits the reader.' : `Genre/category: ${genre}.`;

      const prompt = `Recommend 3 books for a reader at reading level ${profileLevel}/5 (1=casual, 5=experimental).
${genreHint}

Books they've read recently:
${libContext}

Books currently on their wishlist (to give you a sense of taste — feel free to go beyond these):
${wishContext}

Do NOT recommend any book in this list (already known to them): ${exclude}

Return ONLY valid JSON in this format:
{"books":[{"title":"...","author":"...","genre":"...","complexity":1-5,"depth":1-5,"description":"one-sentence description"}]}`;

      const response = await callClaude(
        prompt,
        'You are a literary curator. Recommend books accurately. Always return valid JSON.'
      );

      let books = null;
      if (response) {
        const parsed = parseJSONResponse(response);
        if (parsed?.books && Array.isArray(parsed.books)) {
          books = parsed.books
            .map((b) => ({
              t: b.title, a: b.author,
              g: b.genre || (genre !== 'all' ? genre : 'Recommended'),
              c: b.complexity, p: b.depth, d: b.description,
              aiSuggested: true,
            }))
            .filter((b) => b.t && b.a);
        }
      }

      if (!books || books.length === 0) {
        // Fall back to Vault first, then wishlist
        const v = vault || (await loadVault());
        const vaultPool = (genre === 'all' ? v : v.filter((b) => b.g === genre)).filter((b) => !inUse.has(bookKey(b)));
        if (vaultPool.length > 0) {
          showToast("Couldn't reach the AI. Drawing from the Vault instead.", true);
          const shuffled = [...vaultPool].sort(() => Math.random() - 0.5);
          setDraw(shuffled.slice(0, Math.min(3, shuffled.length)));
        } else {
          showToast("Couldn't reach the AI. Falling back to your wishlist.", true);
          const pool = genre === 'all' ? state.wishlist : state.wishlist.filter((b) => b.g === genre);
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

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · <a onClick={() => go('oracle')}>Oracle</a> · By Categories
      </div>
      <div className="page-header">
        <div className="page-eyebrow">By categories</div>
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
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <button className="btn" onClick={handleDraw} disabled={loading}>
          {loading ? 'Divining…' : 'Give me a book ❦'}
        </button>
      </section>

      <section className="cards">
        {loading ? (
          <div className="loading" style={{ gridColumn: '1 / -1' }}>
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
