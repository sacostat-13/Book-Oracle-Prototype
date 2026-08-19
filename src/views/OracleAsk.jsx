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
import { logRecommendations, attachRecommendationIds } from '../lib/oracleProvenance';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { OracleQuotaWall } from '../components/OracleQuotaBadge';
import { useT, useTNode, useI18n, langDirective } from '../lib/I18nContext';
import BookCard from '../components/BookCard';
import { buildTasteProfile, describeTasteProfile, MATCH_SCORING_INSTRUCTIONS } from '../lib/matchHelpers';
import { buildExcludeHint, buildShelfSignature, filterAlreadyKnown, REASON_INSTRUCTIONS, REPRESENTATION_INSTRUCTIONS } from '../lib/oraclePrompt';
import { saveDraw, loadDraw } from '../lib/oracleDrawCache';

const QUERY_MAX = 280;

// Ask for more than we show. The denylist in the prompt is a bounded hint, so
// the real dedupe runs client-side against the whole shelf afterwards and needs
// something to cut into — a reader with a big library can knock out three of
// six. Output tokens are cheap next to the input we stopped sending.
const ASK_REQUEST = 6;
const ASK_COUNT = 3;

export default function OracleAsk({ onOpenBook }) {
  const { state, showToast } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();
  const { lang } = useI18n();
  const { quota, handleQuotaError, onCallSucceeded, confirmOracleCall } = useOracleQuota();

  // v0.63.3: query and results both restore from the session cache, so a reload
  // or a trip to a book page and back does not read as a spent Oracle call
  // gone missing. The question is restored too — results with no visible
  // question read as though they arrived from nowhere.
  const cached = loadDraw('ask');
  const [query, setQuery]     = useState(() => cached?.query || '');
  const [results, setResults] = useState(() => (cached?.books ? { books: cached.books } : null));
  const [loading, setLoading] = useState(false);

  const favGenres = state.profile?.favoriteGenres || [];
  const mood      = state.profile?.currentMood || [];
  const hasPersonalization = favGenres.length > 0 || mood.length > 0;
  const quotaEmpty = quota && !quota.unlimited && quota.calls_remaining === 0;
  const tasteProfile = buildTasteProfile(state.library, state.genresByBookId, state.profile);

  async function ask() {
    const trimmed = query.trim();
    if (!trimmed || loading || quotaEmpty) return;
    // v0.58: ask before spending. Returns true immediately for anyone who has
    // seen the disclosure and is not on their last call, so this is a no-op in
    // the common case — no spinner is shown until the answer is yes.
    if (!(await confirmOracleCall('ask'))) return;
    setLoading(true);
    setResults(null);

    // v0.63.3 — THE 413 FIX, ported from OracleCategories (v0.63).
    //
    // This line used to be unbounded: every title the reader had ever touched,
    // interpolated into the prompt on every ask. At ~1,500 titles that is ~45k
    // characters wrapped around a ~2k prompt, and claude.js rejects anything
    // over MAX_PROMPT_CHARS (50_000) with a 413 before Anthropic ever sees it.
    // The reader with the richest taste profile was the one who could not use
    // the feature. v0.63 fixed exactly this in By genres and, because the fix
    // was written inside that component, left it standing here.
    //
    // The denylist is now a bounded HINT that steers the model away from the
    // obvious; the guarantee lives in filterAlreadyKnown() below, which is
    // exact, local, free, and applied to the full shelf.
    const known = [...state.readNext, ...state.library, ...state.wishlist];
    const exclude = buildExcludeHint(known);

    // v0.50: the taste summary now carries favorite genres, mood, stated
    // reading level AND goal — the old direct genre/mood lines duplicated it.
    const tasteSummary = describeTasteProfile(tasteProfile);
    const personalization = [
      tasteSummary || null,
      favGenres.length > 0 ? `Lean toward the reader's favorite genres when a good option exists, but don't force it.` : null,
    ].filter(Boolean).join(' ');

    // v0.63.3: Ask previously sent the taste profile and nothing else — averages
    // per genre, with not one actual book named. That is enough to pick well
    // and not enough to say why: a reason can only point at something the model
    // was told. ~1kB buys named books, star ratings and shelf sizes.
    const shelf = buildShelfSignature(state);

    const prompt = `${personalization ? personalization + '\n\n' : ''}${shelf}

A reader asks: "${trimmed}"

Recommend ${ASK_REQUEST} books that best answer this request. You are NOT limited to any catalog; recommend the best matches in world literature.

Avoid recommending books they already know. Here is a sample of what is already on their shelves (not exhaustive): ${exclude}

Return ONLY valid JSON in this exact format:
{"books":[{"title":"...","author":"...","genre":"...","complexity":1-5,"depth":1-5,"description":"one-sentence description","reason":"one sentence on why THIS reader would enjoy it right now","match":0-100}]}`;

    try {
      const raw = await callClaude(
        prompt,
        `You are a literary oracle taking a free-form request from a reader and recommending books that answer it. Recommend accurately. Always return valid JSON. ${langDirective(lang)} Any natural-language field in the JSON (description, reason, genre label) MUST be in that language; titles and author names stay in their original language.\n${MATCH_SCORING_INSTRUCTIONS}\n${REASON_INSTRUCTIONS}\n${REPRESENTATION_INSTRUCTIONS}`,
        { source: 'ask' } // v0.58: history label (schema_v44)
      );
      const parsed = parseJSONResponse(raw);
      if (parsed?.books && Array.isArray(parsed.books) && parsed.books.length > 0) {
        // v0.63.3: `why` rides on the book object rather than in a title-keyed
        // side map. The map broke silently whenever the model echoed a title
        // with different punctuation than it returned in `title`, and it could
        // not survive the filter/slice below or reach logRecommendations.
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
        ).slice(0, ASK_COUNT);

        // v0.63.3: the client-side filter can empty a non-empty response — a
        // reader with a large shelf may already own everything the model
        // returned. Without this the page rendered "Found 0 books" under a
        // heading promising results, which reads as a failure the reader
        // caused. The quota call is spent either way; say so honestly.
        if (books.length === 0) {
          showToast(t('oracle.askError'), true);
          return;
        }

        // v0.58 provenance: log what was OFFERED, before knowing what is
        // taken. Awaited so the ids can be attached to the very objects being
        // rendered — it is one round trip against a call that already cost
        // several seconds, and it never throws (see oracleProvenance.js).
        const ids = await logRecommendations('ask', books);
        const withIds = attachRecommendationIds(books, ids);
        setResults({ books: withIds });
        saveDraw('ask', { query: trimmed, books: withIds });
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
                  reason={b.why}
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
