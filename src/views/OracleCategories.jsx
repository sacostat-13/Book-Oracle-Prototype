import { useState, useMemo, useEffect } from 'react';
import BookLoader from '../components/BookLoader';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { ALL_BOOKS, bookKey } from '../lib/bookHelpers';
import { callClaude, parseJSONResponse, QuotaExceededError } from '../lib/claudeApi';
import { logRecommendations, attachRecommendationIds } from '../lib/oracleProvenance';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { OracleQuotaBadge, OracleQuotaWall } from '../components/OracleQuotaBadge';
import { useT, useI18n, langDirective } from '../lib/I18nContext';
import BookCard from '../components/BookCard';
import GenreSelect from '../components/GenreSelect';
import { buildTasteProfile, describeTasteProfile, computeLocalMatch, MATCH_SCORING_INSTRUCTIONS } from '../lib/matchHelpers';

// v0.15 phase 2.6: copy pass — "categories" → "genres" throughout.
// The Temperament dropdown now draws from Oracle genres (genresByBookId)
// for wishlist/vault modes, falling back to b.g for uncategorized books.
// Route name (oracle-categories) is kept for URL stability.

// v0.63 — prompt budget.
//
// claude.js rejects anything over MAX_PROMPT_CHARS (50_000) with a 413. The
// rest of this prompt — taste profile, recent reads, wishlist sample — runs
// about 2.5k characters, so 6k for the denylist sample leaves an order of
// magnitude of headroom and still carries several hundred titles. Sized to be
// obviously safe rather than maximally full: the list is a hint now, and
// doubling it would not make the recommendations better.
const EXCLUDE_CHAR_BUDGET = 6000;

// Ask for more than we show, because client-side filtering removes some.
// 8-for-3 survives the model returning five books the reader already owns,
// which happens on a well-stocked shelf. Output tokens are cheap next to the
// input we just stopped sending.
const AI_DRAW_REQUEST = 8;
const AI_DRAW_COUNT = 3;

// Recency-first: a book added last week is far likelier to be re-suggested
// than one read in 2011, so if the budget only fits part of the shelf it
// should fit the part that matters. `known` arrives as
// [...readNext, ...library, ...wishlist]; readNext is the most immediate
// signal, so it is preserved at the head.
function buildExcludeHint(known) {
  const seen = new Set();
  const parts = [];
  let used = 0;

  for (const b of known) {
    const title = (b?.t || '').trim();
    if (!title) continue;
    const key = normalizeTitle(title);
    if (seen.has(key)) continue;   // the old list shipped duplicates too
    seen.add(key);

    const piece = `"${title}"`;
    const cost = piece.length + 2; // ", "
    if (used + cost > EXCLUDE_CHAR_BUDGET) break;
    parts.push(piece);
    used += cost;
  }

  return parts.join(', ') || '(nothing yet)';
}

// Loose enough to catch edition/spacing/punctuation drift between what the
// model returns and what is on the shelf, strict enough not to collapse
// genuinely different books. Deliberately NOT exported: `bookKey` remains the
// canonical identity everywhere else, and a second notion of "same book"
// leaking out of this file is how identity bugs start.
function normalizeTitle(t) {
  return (t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents: "Pedro Páramo" === "Pedro Paramo"
    .replace(/\s*\([^)]*\)\s*$/, '')   // drop a trailing "(Series, #3)"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export default function OracleCategories({ onOpenBook }) {
  const { state, setOracleMode, showToast, vault, loadVault } = useData();
  const { go } = useRouter();
  const t = useT();
  const { lang } = useI18n();
  const { quota, handleQuotaError, onCallSucceeded, confirmOracleCall } = useOracleQuota();
  const [genre, setGenre] = useState('all');
  const [draw, setDraw] = useState([]);
  const [loading, setLoading] = useState(false);

  const mode = state.oracleMode || 'wishlist';
  const { genresByBookId } = state;

  const tasteProfile = useMemo(
    () => buildTasteProfile(state.library, genresByBookId, state.profile),
    [state.library, genresByBookId, state.profile]
  );

  // Attaches a local (zero-LLM) match % to each book, omitting it entirely
  // when there's no usable signal — never show a fabricated number.
  function withLocalMatch(books) {
    return books.map((b) => {
      const match = computeLocalMatch(b, tasteProfile, genresByBookId);
      return match != null ? { ...b, match } : b;
    });
  }

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
  //
  // Deriving the list from the SOURCE is right for the two catalog modes and
  // wrong for AI. Wishlist and Vault can only ever hand back a book they hold,
  // so offering a genre with nothing behind it would just produce "Nothing left
  // to draw in that genre". AI mode has no such constraint — its own tab says
  // "may go beyond catalogs" — but it was being fed `sourceBooks = ALL_BOOKS`,
  // the ~280-title bundled catalog, so the dropdown showed only the handful of
  // genres that bundle happens to cover. That is the reported bug: genres that
  // exist in public.genres, are offered at onboarding, and are perfectly
  // askable of Claude were simply missing from the picker.
  //
  // So: AI mode gets the full canonical taxonomy, the catalog modes keep the
  // source-derived list.
  const catalogGenres = useMemo(() => {
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

  // The same list Onboarding, Profile and PlanCreate offer, so a reader who
  // picked "Folk Horror" as a favourite genre can also ask the Oracle for one.
  // Falls back to the catalog-derived list when the taxonomy has not loaded —
  // an empty picker is worse than a short one.
  const taxonomyGenres = useMemo(() => {
    const rows = state.genres || [];
    if (rows.length === 0) return null;
    return rows
      .map((g) => ({
        norm: g.normalizedName || g.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
        name: g.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state.genres]);

  const sourceGenres = (mode === 'ai' && taxonomyGenres) ? taxonomyGenres : catalogGenres;

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
      setDraw(withLocalMatch(shuffled.slice(0, Math.min(3, shuffled.length))));
      return;
    }

    // AI mode
    // v0.58: gate here rather than at the top of handleDraw — the wishlist and
    // vault modes above return without ever reaching Anthropic.
    if (!(await confirmOracleCall('categories'))) return;
    setLoading(true);
    setDraw([]);
    try {
      const profileLevel = state.profile.readingLevel || 3;
      const libContext = state.library.slice(-15).map((b) => `- ${b.t} by ${b.a}`).join('\n') || '(none)';
      const wishContext = state.wishlist.slice(0, 30).map((b) => `- ${b.t}`).join('\n') || '(none)';

      // v0.63 — THIS IS THE FIX FOR "Prompt too long" (413 from claude.js,
      // MAX_PROMPT_CHARS = 50_000).
      //
      // The old line was:
      //   [...readNext, ...library, ...wishlist].map(b => `"${b.t}"`).join(', ')
      //
      // Unbounded. A reader with a large wishlist — which is the whole point of
      // the app, and which the v0.44 Vault upgrade actively encourages — sent
      // every title they had ever touched on every draw. At ~1,500 titles that
      // is ~45k characters of denylist wrapped around a ~2k prompt, and the
      // function rejected it before Anthropic ever saw it. The reader with the
      // richest taste profile was the one who could not use the feature.
      //
      // Two things were wrong, not one:
      //
      //   1. Size. Obvious in hindsight, invisible in testing, because it
      //      degrades with library size rather than failing outright.
      //   2. Method. A 1,500-item denylist does not reliably work even when it
      //      fits. Attention over a comma-separated wall of titles is not exact
      //      matching, and we were paying input tokens for a filter that we can
      //      run locally, for free, with perfect accuracy.
      //
      // So the denylist becomes a HINT — a bounded sample that steers the model
      // away from the obvious — and the real filtering moves client-side, after
      // the response, where `bookKey` already gives us exact dedupe. We ask for
      // more books than we need so that filtering has something to cut into.
      const known = [...state.readNext, ...state.library, ...state.wishlist];
      const exclude = buildExcludeHint(known);

      // Use the display name of the selected genre for the AI prompt
      const selectedGenreName = sourceGenres.find((g) => g.norm === genre)?.name;
      const genreHint = genre === 'all'
        ? 'Any genre that suits the reader.'
        : `Genre: ${selectedGenreName || genre}.`;

      const prompt = `Recommend ${AI_DRAW_REQUEST} books for a reader at reading level ${profileLevel}/5 (1=casual, 5=experimental).
${genreHint}

Books they've read recently:
${libContext}

Books currently on their wishlist (to give you a sense of taste — feel free to go beyond these):
${wishContext}

${describeTasteProfile(tasteProfile)}

Avoid recommending books they already know. Here is a sample of what is already on their shelves (not exhaustive): ${exclude}

Return ONLY valid JSON in this format:
{"books":[{"title":"...","author":"...","genre":"...","complexity":1-5,"depth":1-5,"description":"one-sentence description","match":0-100}]}`;

      let response = null;
      try {
        response = await callClaude(
          prompt,
          `You are a literary curator. Recommend books accurately. Always return valid JSON. ${langDirective(lang)} Any natural-language field in the JSON (description, genre label) MUST be in that language; titles and author names stay in their original language.\n${MATCH_SCORING_INSTRUCTIONS}`,
          { source: 'categories' } // v0.58: history label (schema_v44)
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
          // The denylist in the prompt is now a bounded sample, so the real
          // guarantee that we never recommend a book the reader already has
          // lives HERE — exact, local, free, and applied to the full set rather
          // than to whatever fitted in the character budget.
          const knownKeys = new Set(known.map(bookKey));
          const knownTitles = new Set(known.map((b) => normalizeTitle(b.t)));

          books = parsed.books
            .map((b) => ({
              t: b.title, a: b.author,
              g: b.genre || (genre !== 'all' ? selectedGenreName : 'Recommended'),
              c: b.complexity, p: b.depth, d: b.description,
              aiSuggested: true,
              match: Number.isFinite(b.match) ? Math.max(0, Math.min(100, Math.round(b.match))) : undefined,
            }))
            .filter((b) => b.t && b.a)
            // bookKey is title+author, so it misses the case where the model
            // returns a different edition's author string for a book already on
            // the shelf ("Jim  Butcher" vs "Jim Butcher"). Title alone is the
            // safety net: a false positive costs one suggestion out of the
            // AI_DRAW_REQUEST we asked for, a false negative shows the reader a
            // book they have already read, which is the failure they notice.
            .filter((b) => !knownKeys.has(bookKey(b)) && !knownTitles.has(normalizeTitle(b.t)))
            .slice(0, AI_DRAW_COUNT);

          // v0.58 provenance. Inside the AI branch only: the Vault and
          // wishlist fallbacks below are local draws, and logging them would
          // credit the Oracle with picks it did not make.
          if (books.length > 0) {
            const ids = await logRecommendations('categories', books);
            books = attachRecommendationIds(books, ids);
          }
        }
      }

      if (!books || books.length === 0) {
        // Fall back to Vault first, then wishlist.
        //
        // The genre filter is dropped if it empties the fallback. Since the AI
        // picker now offers the whole taxonomy rather than only what the
        // bundled catalog covers, a reader can legitimately ask for a genre no
        // local book carries — and then this branch, which exists to salvage a
        // failed call, would salvage nothing and show an empty grid under a
        // toast promising a fallback.
        const v = vault || (await loadVault());
        const drawFrom = (rows) => {
          const shuffled = [...rows].sort(() => Math.random() - 0.5);
          setDraw(withLocalMatch(shuffled.slice(0, Math.min(3, shuffled.length))));
        };
        const usable = (rows) => rows.filter((b) => !inUse.has(bookKey(b)));

        const vaultPool = usable(v.filter(bookMatchesGenre));
        const wishPool = usable(state.wishlist.filter(bookMatchesGenre));

        if (vaultPool.length > 0) {
          showToast("Couldn't reach the AI. Drawing from the Vault instead.", true);
          drawFrom(vaultPool);
        } else if (wishPool.length > 0) {
          showToast("Couldn't reach the AI. Falling back to your wishlist.", true);
          drawFrom(wishPool);
        } else {
          const anyVault = usable(v);
          showToast(
            "Couldn't reach the AI, and nothing local matches that genre. Drawing from the Vault instead.",
            true
          );
          drawFrom(anyVault.length > 0 ? anyVault : usable(state.wishlist));
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
      <div className="page-head">
        <div className="page-head__eyebrow">By genres</div>
        <h1 className="page-head__title">Choose a <span className="accent">temperament</span></h1>
        <p className="page-head__lead">
          Three books drawn fresh, {sourceDesc}.
        </p>
      </div>

      <div className="source-tabs">
        <span className="source-tabs__label">Source:</span>
        <button className={`source-tab${mode === 'wishlist' ? ' active' : ''}`} onClick={() => setMode('wishlist')}>
          <div className="source-tab__head">
            <span className="source-tab__glyph">❦</span>
            <span className="source-tab__title">My wishlist</span>
          </div>
          <div className="source-tab__sub">{state.wishlist.length} books</div>
        </button>
        <button className={`source-tab${mode === 'vault' ? ' active' : ''}`} onClick={() => setMode('vault')}>
          <div className="source-tab__head">
            <span className="source-tab__glyph">☩</span>
            <span className="source-tab__title">The Vault</span>
          </div>
          <div className="source-tab__sub">{vault ? `${vault.length} curated` : 'curated catalog'}</div>
        </button>
        <button className={`source-tab${mode === 'ai' ? ' active' : ''}`} onClick={() => setMode('ai')}>
          <div className="source-tab__head">
            <span className="source-tab__glyph">✦</span>
            <span className="source-tab__title">AI recommends</span>
          </div>
          <div className="source-tab__sub">may go beyond catalogs</div>
        </button>
      </div>

      <section className="controls">
        <div className="field">
          <label>Temperament</label>
          {/* v0.63: was a native <select>. With the taxonomy at 136 entries the
              browser drew its option list pinned to the top of the window,
              detached from the field — an OS-level popup no CSS here could
              reposition. GenreSelect is an ordinary anchored dropdown, and
              being searchable is the larger win: 136 alphabetical options is
              not a list anyone should have to scroll. */}
          <GenreSelect
            value={genre}
            onChange={setGenre}
            options={sourceGenres}
            allLabel={`— All books ${sourceDesc} —`}
            placeholder={t('oracle.categoriesSearchGenres')}
          />
        </div>
        <button className="btn-primary" onClick={handleDraw} disabled={loading || (mode === 'ai' && quotaExhausted)}>
          {loading ? t('oracle.categoriesDrawing') : t('oracle.categoriesDraw')}
        </button>
        {mode === 'ai' && quotaExhausted && (
          <div className="lv-load-more">
            <OracleQuotaWall />
          </div>
        )}
      </section>

      <section className="oracle-results-grid">
        {loading ? (
          <BookLoader text="The oracle is divining…" />
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
