import { useState, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey, findBookByTitle } from '../lib/bookHelpers';
import { fetchSeriesBooks } from '../lib/enrichmentService';
import { callClaude, parseJSONResponse } from '../lib/claudeApi';
import { useI18n, langDirective } from '../lib/I18nContext';

const LEVEL_NAMES = ['', '', '', 'Devoted', 'Literary', 'Voracious'];
const LEVEL_BLURB = {
  3: 'Open to weird, dark, and demanding fiction.',
  4: 'Faulkner, Han Kang, Toni Morrison.',
  5: 'Donoso, Lispector, prose that breaks itself open.',
};

export default function PlanCreate() {
  const { state, setCurrentPlan, showToast, vault, loadVault } = useData();
  const { go, route } = useRouter();
  const t = useT();
  const [type, setType] = useState(null);
  const [target, setTarget] = useState(route.params?.seriesName || null);
  const [timeline, setTimeline] = useState(6);
  const [seriesSearch, setSeriesSearch] = useState('');
  const [seriesSearchResult, setSeriesSearchResult] = useState(null);
  const [seriesSearchLoading, setSeriesSearchLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Build series lists from the user's own collection only.
  // in-progress: at least one read, series not complete
  // wishlisted: none read yet, has books in wishlist/readNext
  const { inProgressSeries, wishlistedSeries } = useMemo(() => {
    const seriesMap = {};
    for (const b of [...state.wishlist, ...state.readNext, ...state.library]) {
      if (!b.s?.name) continue;
      const n = b.s.name;
      if (!seriesMap[n]) seriesMap[n] = { name: n, total: b.s.total || null, readCount: 0, totalKnown: 0, latestReadAt: null };
      seriesMap[n].totalKnown++;
      const isRead = state.library.some((l) => bookKey(l) === bookKey(b));
      if (isRead) {
        seriesMap[n].readCount++;
        const readAt = b.dateRead || b.read_at;
        if (readAt && (!seriesMap[n].latestReadAt || readAt > seriesMap[n].latestReadAt))
          seriesMap[n].latestReadAt = readAt;
      }
    }
    const all = Object.values(seriesMap);
    const inProgress = all
      .filter((s) => s.readCount > 0 && (s.total == null || s.readCount < s.total))
      .sort((a, b) => (b.latestReadAt || '') > (a.latestReadAt || '') ? 1 : -1);
    const wishlisted = all
      .filter((s) => s.readCount === 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { inProgressSeries: inProgress, wishlistedSeries: wishlisted };
  }, [state.wishlist, state.readNext, state.library]);
  const knownSeries = [...inProgressSeries, ...wishlistedSeries];

  // If we arrived with seriesName param, auto-select type=series
  useState(() => {
    if (route.params?.seriesName && !type) setType('series');
  }, []);

  async function doSeriesSearch() {
    const q = seriesSearch.trim();
    if (!q) return;
    setSeriesSearchLoading(true);
    setSeriesSearchResult(null);
    const books = await fetchSeriesBooks(q);
    setSeriesSearchLoading(false);
    if (books.length === 0) {
      setSeriesSearchResult({ found: false, q });
    } else {
      const actualName = books[0].s.name;
      setTarget(actualName);
      setSeriesSearchResult({ found: true, name: actualName, books });
    }
  }

  async function buildSeriesPlan(seriesName) {
    const sources = [...(vault || []), ...state.wishlist, ...state.library, ...state.readNext];
    const seen = new Set();
    let entries = [];
    for (const b of sources) {
      if (!b.s || b.s.name !== seriesName) continue;
      const k = bookKey(b);
      if (seen.has(k)) continue;
      seen.add(k);
      entries.push(b);
    }
    const olBooks = await fetchSeriesBooks(seriesName);
    for (const ob of olBooks) {
      if (!entries.some((e) => bookKey(e) === bookKey(ob))) entries.push(ob);
    }
    entries.sort((a, b) => (a.s?.n || 999) - (b.s?.n || 999));
    const unread = entries.filter((b) => !state.library.some((l) => bookKey(l) === bookKey(b)));
    const readCount = entries.length - unread.length;
    const totalPages = unread.reduce((s, b) => s + (b.pp || 0), 0);
    const pagesNote = totalPages > 0 ? ` Roughly ${totalPages.toLocaleString()} pages of reading ahead.` : '';
    const books = unread.map((b, i) => ({
      month: i + 1,
      title: b.t,
      author: b.a,
      pp: b.pp || null,
      reason: b.s?.n ? `Book ${b.s.n} in ${seriesName}.` : `Continues the ${seriesName} series.`,
    }));
    return {
      title: `Finish ${seriesName}`,
      intro: readCount > 0
        ? `You've already read ${readCount} ${readCount === 1 ? 'book' : 'books'} in this series. ${books.length} to go.${pagesNote}`
        : `The full ${seriesName} series, in order.${pagesNote}`,
      books,
      timeline: books.length,
      seriesName,
      type: 'series',
    };
  }

  function buildFallbackPlan(poolBooks) {
    // poolBooks is the candidate pool — prefer Vault (curated), fall back to
    // bundled ALL_BOOKS for guest sessions or if Vault hasn't loaded.
    const candidates = poolBooks && poolBooks.length > 0 ? poolBooks : (vault || []);

    if (type === 'level') {
      const start = state.profile.readingLevel || 1;
      const end = target;
      const sorted = [...candidates].sort((a, b) => (a.c || 3) - (b.c || 3));
      const steps = [];
      for (let i = 0; i < timeline; i++) {
        const targetC = start + ((end - start) * (i / Math.max(1, timeline - 1)));
        const cands = sorted.filter(
          (b) => Math.abs((b.c || 3) - targetC) <= 0.7 &&
                 !steps.some((s) => s.t === b.t) &&
                 !state.library.some((l) => bookKey(l) === bookKey(b))
        );
        const picked = cands[Math.floor(Math.random() * Math.min(cands.length, 5))];
        if (picked) steps.push({ ...picked, month: i + 1, reason: `A measured step toward level ${end} prose.` });
      }
      return {
        title: `From level ${start} to level ${end}`,
        intro: `A ${timeline}-month progression through gradually deeper prose.`,
        books: steps.map((s) => ({ month: s.month, title: s.t, author: s.a, reason: s.reason })),
        timeline,
        type: 'level',
      };
    }
    const pool = candidates.filter((b) => b.g === target).sort((a, b) => (a.c || 3) - (b.c || 3));
    const steps = pool.slice(0, timeline).map((b, i) => ({
      month: i + 1,
      title: b.t,
      author: b.a,
      reason: i === 0 ? 'An accessible foundation for the genre.' :
              i === pool.length - 1 ? 'A defining, demanding work.' :
              "A deeper step into the genre's core themes.",
    }));
    return {
      title: `An immersion in ${target}`,
      intro: `A guided ${timeline}-month path through the genre.`,
      books: steps,
      timeline,
      type: 'experience',
    };
  }

  async function generate() {
    setGenerating(true);

    try {
      if (type === 'series') {
        const plan = await buildSeriesPlan(target);
        await setCurrentPlan(plan);
        go('plan-view');
        return;
      }

      // Prefer the Vault (curated catalog from DB) over the bundled ALL_BOOKS
      // for the AI prompt context. This keeps the curated set as the source
      // of truth even as the bundled file ages.
      const catalogSource = vault && vault.length > 0 ? vault : ((await loadVault()) || []);

      const libraryContext = state.library.slice(-30).map((b) => `- ${b.t} by ${b.a}`).join('\n') || '(none)';
      let prompt;
      if (type === 'level') {
        prompt = `A reader at level ${state.profile.readingLevel || 1}/5 wants to reach level ${target}/5 over ${timeline} months.

Reading levels are based on prose complexity:
1 = casual/page-turners
2 = mid-difficulty
3 = literary
4 = challenging (Faulkner, Han Kang)
5 = experimental (Donoso, Lispector)

Books they've read recently:
${libraryContext}

Available books from the curated catalog (title | author | genre | prose complexity 1-5):
${catalogSource.map((b) => `${b.t} | ${b.a} | ${b.g} | c=${b.c}`).join('\n')}

Build a ${timeline}-month plan that gradually escalates from level ${state.profile.readingLevel || 1} to level ${target}. One book per month. Each step should be a meaningful but achievable jump.

Return ONLY valid JSON in this exact format:
{
  "title": "short evocative title for this plan",
  "intro": "one sentence explaining the journey",
  "books": [
    {"month": 1, "title": "exact title from list", "reason": "why this book at this stage"}
  ]
}`;
      } else {
        // Filter catalog by Oracle genre (genresByBookId) first, fall back to b.g for untagged books.
        const { genresByBookId } = state;
        const matchingBooks = catalogSource.filter((b) => {
          const genres = genresByBookId[b.bookId] || [];
          if (genres.length > 0) return genres.some((g) => g.name === target);
          return b.g === target; // legacy fallback
        });

        const matchingList = matchingBooks
          .map((b) => `${b.t} | ${b.a} | c=${b.c || '?'} | p=${b.p || '?'} | ${b.d || ''}`)
          .join('\n');

        const relatedList = catalogSource
          .filter((b) => {
            const genres = genresByBookId[b.bookId] || [];
            return genres.length > 0
              ? genres.every((g) => g.name !== target)
              : b.g !== target;
          })
          .slice(0, 30)
          .map((b) => `${b.t} | ${b.a} | ${b.g || 'unknown'}`)
          .join('\n');

        const catalogNote = matchingBooks.length > 0
          ? `Available books from the curated catalog matching this genre (title | author | prose complexity 1-5 | genre depth 1-5 | description):\n${matchingList}\n\nAlso available from related genres:\n${relatedList}`
          : `The curated catalog does not contain books tagged as "${target}". You MUST recommend books from outside the catalog that genuinely belong to this genre. Do NOT fall back to gothic, horror, or unrelated genres just because they appear in the catalog below.\n\nCatalog shown for context only (do not use these for the plan):\n${relatedList}`;

        prompt = `A reader at level ${state.profile.readingLevel || 1}/5 wants to get deeply experienced in the genre: "${target}". Timeline: ${timeline} months.

Books they've read recently:
${libraryContext}

${catalogNote}

Build a ${timeline}-month tour of this genre. Start with the most accessible foundational works and progress to deeper, more challenging, or more representative texts. One book per month. Every recommended book MUST belong to the "${target}" genre.

Return ONLY valid JSON in this exact format:
{
  "title": "short evocative title for this plan",
  "intro": "one sentence explaining the journey",
  "books": [
    {"month": 1, "title": "exact title", "author": "author name", "reason": "why this book at this stage"}
  ]
}`;
      }

      const response = await callClaude(
        prompt,
        `You are a literary curator building personalized reading plans. Always return valid JSON. ${langDirective(lang)} Any natural-language field in the JSON (title, intro, reason) MUST be in that language; book titles and author names stay in their original language.`
      );
      let plan = response ? parseJSONResponse(response) : null;
      if (!plan?.books?.length) {
        showToast("Couldn't reach the AI. Built a fallback plan from the Vault.", true);
        plan = buildFallbackPlan(catalogSource);
      }
      plan.books = plan.books.slice(0, timeline);
      plan.timeline = timeline;
      plan.type = type;
      await setCurrentPlan(plan);
      go('plan-view');
    } finally {
      setGenerating(false);
    }
  }

  if (generating) {
    return (
      <>
        <div className="breadcrumb">
          <a onClick={() => go('dashboard')}>{t('plans.breadcrumb')}</a> · {t('plans.yourPlanBreadcrumb')}
        </div>
        <div className="loading">
          <div className="loading-spinner"></div>
          <div className="loading-text">
            The oracle is composing your path…<br />
            <span style={{ fontSize: '0.9rem', opacity: 0.6 }}>This may take a moment.</span>
          </div>
        </div>
      </>
    );
  }

  const canGenerate = type && target && (type === 'series' || timeline);
  const userLevel = state.profile.readingLevel || 1;

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>{t('plans.breadcrumb')}</a> · {t('plans.createPlanBreadcrumb')}
      </div>
      <div className="page-header">
        <div className="page-eyebrow">Create a reading plan</div>
        <h1 className="page-title">Where do you want to <span className="accent">go</span>?</h1>
        <p className="page-subtitle">We'll build a paced, curated path from where you are to where you're headed.</p>
      </div>

      <div className="onboarding-card" style={{ maxWidth: '720px', margin: '0 auto' }}>
        <div className="onb-eyebrow">1 · Plan type</div>
        <h2 className="onb-title" style={{ fontSize: '1.6rem', marginBottom: '1.5rem' }}>What's the goal?</h2>
        <div className="choice-grid">
          {[
            { v: 'level', title: 'Reach a reading level', sub: 'Build prose-complexity gradually. Good if you want to read more challenging fiction without bouncing off the deep end.' },
            { v: 'experience', title: 'Get experienced in a genre', sub: 'A curated tour through a topic — folk horror, gothic, Latin American lit — that takes you from foundational to advanced reads.' },
            { v: 'series', title: 'Finish a series', sub: "Read every book in a series, in order, picking up where you left off. We'll fetch the series from Open Library if needed." },
          ].map((t) => (
            <button
              key={t.v}
              className={`choice ${type === t.v ? 'selected' : ''}`}
              onClick={() => { setType(t.v); setTarget(null); }}
            >
              <div className="choice-title">{t.title}</div>
              <div className="choice-sub">{t.sub}</div>
            </button>
          ))}
        </div>

        {type === 'level' && (
          <>
            <div className="onb-eyebrow" style={{ marginTop: '2rem' }}>2 · Target level</div>
            <h2 className="onb-title" style={{ fontSize: '1.6rem', marginBottom: '1.5rem' }}>Aim for:</h2>
            <div className="choice-grid">
              {[3, 4, 5].filter((l) => l > userLevel).map((l) => (
                <button
                  key={l}
                  className={`choice ${target === l ? 'selected' : ''}`}
                  onClick={() => setTarget(l)}
                >
                  <div className="choice-title">Level {l} — {LEVEL_NAMES[l]}</div>
                  <div className="choice-sub">{LEVEL_BLURB[l]}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {type === 'experience' && (
          <>
            <div className="onb-eyebrow" style={{ marginTop: '2rem' }}>2 · Which genre?</div>
            <h2 className="onb-title" style={{ fontSize: '1.6rem', marginBottom: '1.5rem' }}>Explore:</h2>
            <select value={target || ''} onChange={(e) => setTarget(e.target.value || null)} style={{ marginBottom: '1rem' }}>
              <option value="">— Choose a genre —</option>
              {(state.genres || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((g) => (
                <option key={g.id} value={g.name} title={g.description || undefined}>{g.name}</option>
              ))}
            </select>
            {target && (() => {
              const g = (state.genres || []).find((x) => x.name === target);
              return g?.description ? (
                <p style={{ fontStyle: 'italic', color: 'var(--paper-aged)', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                  {g.description}
                </p>
              ) : null;
            })()}
          </>
        )}

        {type === 'series' && (
          <>
            <div className="onb-eyebrow" style={{ marginTop: '2rem' }}>2 · Which series?</div>
            <h2 className="onb-title" style={{ fontSize: '1.6rem', marginBottom: '1.5rem' }}>
              {inProgressSeries.length > 0 ? 'Continue a series, or search for a new one:' : 'Search for a series to finish:'}
            </h2>
            {inProgressSeries.length > 0 && (
              <>
                <div className="onb-eyebrow" style={{ marginBottom: '0.6rem', marginTop: '0.5rem' }}>In progress</div>
                <div className="choice-grid">
                  {inProgressSeries.map((s) => (
                    <button
                      key={s.name}
                      className={`choice ${target === s.name ? 'selected' : ''}`}
                      onClick={() => setTarget(s.name)}
                    >
                      <div className="choice-title">{s.name}</div>
                      <div className="choice-sub">{s.readCount} of {s.total || s.totalKnown} read</div>
                    </button>
                  ))}
                </div>
              </>
            )}
            {wishlistedSeries.length > 0 && (
              <>
                <div className="onb-eyebrow" style={{ marginTop: '1.25rem', marginBottom: '0.6rem' }}>On your wishlist</div>
                <div className="choice-grid">
                  {wishlistedSeries.map((s) => (
                    <button
                      key={s.name}
                      className={`choice ${target === s.name ? 'selected' : ''}`}
                      onClick={() => setTarget(s.name)}
                    >
                      <div className="choice-title">{s.name}</div>
                      <div className="choice-sub">{s.totalKnown} {s.totalKnown === 1 ? 'book' : 'books'} on your list</div>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="onb-eyebrow" style={{ marginTop: '1.5rem' }}>Or search by series name</div>
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem' }}>
              <input
                type="text"
                className="search-input"
                placeholder='e.g. "The Stormlight Archive"'
                style={{ flex: 1 }}
                value={seriesSearch}
                onChange={(e) => setSeriesSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doSeriesSearch()}
              />
              <button className="btn btn-gilt" onClick={doSeriesSearch}>Search ❦</button>
            </div>
            <div style={{ marginTop: '1rem' }}>
              {seriesSearchLoading && (
                <div className="loading" style={{ padding: '1.5rem' }}>
                  <div className="loading-spinner" style={{ width: '24px', height: '24px' }}></div>
                  <div className="loading-text" style={{ fontSize: '0.9rem' }}>Searching Open Library…</div>
                </div>
              )}
              {seriesSearchResult?.found === false && (
                <div style={{ padding: '1rem', color: 'var(--paper-aged)', opacity: 0.7, fontStyle: 'italic' }}>
                  No matches for "{seriesSearchResult.q}" on Open Library. Try a different name or spelling.
                </div>
              )}
              {seriesSearchResult?.found && (
                <div style={{ padding: '1rem', background: 'rgba(176, 140, 63, 0.08)', border: '1px solid rgba(176, 140, 63, 0.3)', borderRadius: '2px' }}>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1.1rem', color: 'var(--paper)', marginBottom: '0.4rem' }}>
                    Found <strong>{seriesSearchResult.books.length}</strong> books in <em>{seriesSearchResult.name}</em>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--paper-aged)', opacity: 0.7 }}>
                    {seriesSearchResult.books.slice(0, 5).map((b) => b.t).join(' · ')}
                    {seriesSearchResult.books.length > 5 ? ' …' : ''}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {((type === 'level' && target) || (type === 'experience' && target)) && (
          <>
            <div className="onb-eyebrow" style={{ marginTop: '2rem' }}>3 · Timeline</div>
            <h2 className="onb-title" style={{ fontSize: '1.6rem', marginBottom: '1.5rem' }}>Over how many months?</h2>
            <div className="choice-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
              {[3, 6, 9, 12].map((m) => (
                <button
                  key={m}
                  className={`choice ${timeline === m ? 'selected' : ''}`}
                  onClick={() => setTimeline(m)}
                  style={{ textAlign: 'center' }}
                >
                  <div className="choice-title">{m}</div>
                  <div className="choice-sub">months</div>
                </button>
              ))}
            </div>
          </>
        )}

        {type === 'series' && target && (
          <p style={{ color: 'var(--paper-aged)', opacity: 0.7, marginTop: '1rem', fontStyle: 'italic' }}>
            Series plans use the actual book count as the timeline. We'll pace one book per month.
          </p>
        )}

        <div className="onb-actions">
          <button className="btn btn-ghost" onClick={() => go('dashboard')}>← Back</button>
          <button className="btn" disabled={!canGenerate} onClick={generate}>
            Generate plan ❦
          </button>
        </div>
      </div>
    </>
  );
}
