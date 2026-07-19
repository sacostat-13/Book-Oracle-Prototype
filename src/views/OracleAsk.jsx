// src/views/OracleAsk.jsx — v0.42-ish: third Oracle mode, free-text request.
// Shares the same claude.js proxy / quota bucket as By Genres and Based on
// Other Books — this is just a different prompt shape, not a separate
// billing path. Injects the reader's onboarding genres/mood as context
// alongside their free-text request, and nudges them to fill those in if
// they haven't (that's the whole value-add over a plain "ask anything" box).

import { useState } from 'react';
import BookLoader from '../components/BookLoader';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey } from '../lib/bookHelpers';
import { callClaude, parseJSONResponse, QuotaExceededError } from '../lib/claudeApi';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { OracleQuotaWall } from '../components/OracleQuotaBadge';
import { useT, useTNode, useI18n, langDirective } from '../lib/I18nContext';
import BookCard from '../components/BookCard';
import { buildTasteProfile, describeTasteProfile, MATCH_SCORING_INSTRUCTIONS } from '../lib/matchHelpers';

const QUERY_MAX = 280;

export default function OracleAsk({ onOpenBook }) {
  const { state, showToast } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();
  const { lang } = useI18n();
  const { quota, handleQuotaError, onCallSucceeded } = useOracleQuota();

  const [query, setQuery]     = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const favGenres = state.profile?.favoriteGenres || [];
  const mood      = state.profile?.currentMood || [];
  const hasPersonalization = favGenres.length > 0 || mood.length > 0;
  const quotaEmpty = quota && !quota.unlimited && quota.calls_remaining === 0;
  const tasteProfile = buildTasteProfile(state.library, state.genresByBookId, state.profile);

  async function ask() {
    const trimmed = query.trim();
    if (!trimmed || loading || quotaEmpty) return;
    setLoading(true);
    setResults(null);

    const exclude = [...state.readNext, ...state.library, ...state.wishlist]
      .map((b) => `"${b.t}"`)
      .join(', ');

    // v0.50: the taste summary now carries favorite genres, mood, stated
    // reading level AND goal — the old direct genre/mood lines duplicated it.
    const tasteSummary = describeTasteProfile(tasteProfile);
    const personalization = [
      tasteSummary || null,
      favGenres.length > 0 ? `Lean toward the reader's favorite genres when a good option exists, but don't force it.` : null,
    ].filter(Boolean).join(' ');

    const prompt = `${personalization ? personalization + '\n\n' : ''}A reader asks: "${trimmed}"

Recommend 3 books that best answer this request. You are NOT limited to any catalog; recommend the best matches in world literature.

Do NOT recommend any of these (already known to reader): ${exclude}

Return ONLY valid JSON in this exact format:
{"books":[{"title":"...","author":"...","genre":"...","complexity":1-5,"depth":1-5,"description":"one-sentence description","reason":"one-sentence reason this answers the request","match":0-100}]}`;

    try {
      const raw = await callClaude(
        prompt,
        `You are a literary oracle taking a free-form request from a reader and recommending books that answer it. Recommend accurately. Always return valid JSON. ${langDirective(lang)} Any natural-language field in the JSON (description, reason, genre label) MUST be in that language; titles and author names stay in their original language.\n${MATCH_SCORING_INSTRUCTIONS}`
      );
      const parsed = parseJSONResponse(raw);
      if (parsed?.books && Array.isArray(parsed.books) && parsed.books.length > 0) {
        const books = parsed.books
          .map((b) => ({
            t: b.title, a: b.author, g: b.genre || 'Recommended',
            c: b.complexity, p: b.depth, d: b.description, aiSuggested: true,
            match: Number.isFinite(b.match) ? Math.max(0, Math.min(100, Math.round(b.match))) : undefined,
          }))
          .filter((b) => b.t && b.a);
        const reasons = {};
        parsed.books.forEach((b) => { if (b.reason) reasons[b.title] = b.reason; });
        setResults({ books, reasons });
        onCallSucceeded?.();
      } else {
        showToast(t('oracle.askError'), true);
      }
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        handleQuotaError(e);
      } else {
        showToast(t('oracle.askError'), true);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>{t('oracle.breadcrumbDashboard')}</a> ·{' '}
        <a onClick={() => go('oracle')}>{t('oracle.forkEyebrow')}</a> · {t('oracle.askEyebrow')}
      </div>
      <div className="page-head">
        <div className="page-head__eyebrow">{t('oracle.askEyebrow')}</div>
        <h1 className="page-head__title">{tNode('oracle.askPageTitle')}</h1>
        <p className="page-head__lead">{t('oracle.askSubtitle')}</p>
      </div>

      {!hasPersonalization && (
        <div className="oracle-ask-nudge">
          <span className="oracle-ask-nudge__text">{t('oracle.askNudgeText')}</span>
          <button className="btn-tertiary btn--sm" onClick={() => go('profile')}>
            {t('oracle.askNudgeCta')}
          </button>
        </div>
      )}

      <div className="oracle-ask-box">
        <textarea
          className="oracle-ask-input"
          rows={3}
          placeholder={t('oracle.askPlaceholder')}
          value={query}
          maxLength={QUERY_MAX}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); }}
        />
        <div className="oracle-ask-box__foot">
          <span className="oracle-ask-box__count">{query.length} / {QUERY_MAX}</span>
        </div>
      </div>

      <div className="oracle-results-head">
        <button className="btn-primary" onClick={ask} disabled={!query.trim() || loading || quotaEmpty}>
          {loading ? t('oracle.askAsking') : t('oracle.askButton')}
        </button>
        {quotaEmpty && <OracleQuotaWall />}
      </div>

      <div>
        {loading ? (
          <BookLoader text={t('oracle.askAsking')} />
        ) : results ? (
          <>
            <h2 className="oracle-results-title">
              {tNode('oracle.askResultsTitle', { count: results.books.length })}
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
    </>
  );
}
