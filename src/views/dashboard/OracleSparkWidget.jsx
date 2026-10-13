// src/views/dashboard/OracleSparkWidget.jsx — "Give me a book": one Oracle pick from the wishlist.

import { useState } from 'react';
import { useOracleQuota } from '../../contexts/OracleQuotaContext';
import { callClaude } from '../../lib/oracle/claudeApi';
import { openBookTab } from '../../lib/book/bookHelpers';
import { sample } from '../../lib/util/random';
import { goalDirective, describeTasteProfile } from '../../lib/oracle/tastePrompt';
import { OracleQuotaBadge } from '../../components/OracleQuotaBadge';
import { logRecommendations } from '../../lib/oracle/oracleProvenance';
import CoverThumb from '../../components/CoverThumb';
import { IconSparkle, WidgetShell } from './WidgetShell';

// ─── Oracle Spark ─────────────────────────────────────────────────────────────
export default function OracleSparkWidget({ wishlist, go, t, profile, tasteProfile }) {
  const { quota, refresh: refreshQuota, confirmOracleCall } = useOracleQuota();
  const [state, setState] = useState('idle');
  const [result, setResult] = useState(null);

  const hasWishlist = (wishlist || []).length > 0;
  const quotaEmpty = !quota?.unlimited && quota?.calls_remaining === 0;

  async function draw() {
    if (!hasWishlist || quotaEmpty) return;
    // v0.58: the Spark sits on the dashboard and is the most likely first
    // Oracle call anyone makes, so it is the most important one to explain
    // before it happens.
    if (!(await confirmOracleCall('spark'))) return;
    setState('loading'); setResult(null);
    try {
      // sample() copies before shuffling — `wishlist` is state.wishlist, and the
      // old in-place .sort() reordered the reader's real wishlist on every draw.
      const titles = sample(wishlist, 20)
        .map((b) => `"${b.t}" by ${b.a}`).join('\n');
      // v0.38: fold onboarding personalization into the Spark prompt when present —
      // favorite genres bias the pick, current mood shapes the "reason" framing.
      const favGenres = profile?.favoriteGenres || [];
      const mood = profile?.currentMood || [];
      // v0.50: stated reading level + goal join the Spark personalization.
      //
      // v0.63.3: so does the taste profile. Spark was the only Oracle surface
      // that never saw genre affinity — it knew the reader's STATED favourite
      // genres but not which genres they actually rate highly, which is the
      // difference between what someone says they like and what they finish at
      // five stars. It is one line of prompt and the widget already had the
      // library loaded upstream.
      const tasteSummary = describeTasteProfile(tasteProfile);
      const personalization = [
        tasteSummary || null,
        favGenres.length > 0 ? `Reader's favorite genres: ${favGenres.join(', ')}. Lean toward these when a good option exists, but don't force it.` : null,
        mood.length > 0 ? `Reader says they're currently in the mood for: ${mood.join(', ')}. Frame the pick and reason with this in mind.` : null,
        profile?.readingLevel != null ? `Reader's stated reading level: ${profile.readingLevel}/5 (1=casual page-turners, 5=experimental prose).` : null,
        goalDirective(profile?.goal),
      ].filter(Boolean).join(' ');
      const raw = await callClaude(
        `${personalization ? personalization + '\n\n' : ''}From this wishlist, pick ONE book that would most pleasantly surprise me right now. Return ONLY JSON: { title, author, reason (max 20 words, evocative) }.\n\n${titles}`,
        'You are a literary oracle. Be bold. Return only valid JSON, no markdown.',
        { source: 'spark' } // v0.58: history label (schema_v44)
      );
      if (!raw) { setState('error'); return; }
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      const match = (wishlist || []).find((b) =>
        b.t?.toLowerCase().replace(/[^a-z0-9]/g, '') === parsed.title?.toLowerCase().replace(/[^a-z0-9]/g, '')
      );
      // v0.58 provenance. Spark is logged but is NOT comparable to the other
      // surfaces: it recommends from the reader's own wishlist, so the book was
      // already chosen once by them. Its "accept" is picking the book up, not
      // adding it, and it has no rejection to observe — the metrics queries
      // exclude surface = 'spark' for that reason. Logged anyway so the
      // exclusion is a decision made against data rather than a gap.
      const [sparkRecId] = await logRecommendations('spark', [parsed]);
      setResult({ ...parsed, book: match || null, recommendationId: sparkRecId ?? null });
      setState('result');
      refreshQuota?.();
    } catch (e) {
      setState(e?.code === 'quota_exceeded' ? 'quota' : 'error');
    }
  }

  return (
    <WidgetShell icon={<IconSparkle />} label={t('dashboard.widgetSpark')}>
      <div className="db-spark">
        {state === 'idle' && (
          <>
            <p className="db-spark__prompt">{t('dashboard.sparkSub')}</p>
            {/* v0.58: Spark was the ONLY Oracle surface with no quota badge —
                Ask, Similar, Categories and the Oracle fork all carry one. It
                is also the most prominent and the most likely first Oracle
                call anyone makes, and its copy ("one book from your wishlist")
                reads like a local shuffle of a list you already own. Drawing
                from your own shelf does not make it free: the pick and the
                reason are still written by the Oracle. Say so where the button
                is, not only in the first-use dialog. */}
            {hasWishlist && !quotaEmpty && (
              <div className="db-spark__cost">
                <OracleQuotaBadge />
              </div>
            )}
            <div className="db-spark__actions">
              {quotaEmpty ? (
                <>
                  <span className="db-spark__empty-text">{t('oracle.quotaWallTitle')}</span>
                  <button className="btn-tertiary btn--sm" onClick={() => go('profile', { scrollTo: 'subscription' })}>
                    {t('dashboard.aiQuotaUpgrade')}
                  </button>
                </>
              ) : !hasWishlist ? (
                <button className="btn-tertiary" onClick={() => go('wishlist')}>
                  {t('dashboard.sparkNoWishlist')}
                </button>
              ) : (
                <button className="btn-accent" onClick={draw}>
                  {t('dashboard.sparkButton')} ✦
                </button>
              )}
            </div>
          </>
        )}

        {state === 'loading' && (
          <div className="db-spark__loading">
            <div className="loading-spinner" />
            <span className="db-spark__loading-label">{t('dashboard.sparkDrawing')}</span>
          </div>
        )}

        {state === 'result' && result && (
          <div className="db-spark__result">
            {result.book && (
              <CoverThumb book={result.book} width={64} onClick={() => result.book && openBookTab(result.book, 'dashboard')} />
            )}
            <div className="db-spark__result-meta">
              <div className="db-spark__result-eyebrow">
                <IconSparkle /> {t('dashboard.sparkResult')}
              </div>
              <div className="db-spark__result-title"
                onClick={() => result.book && openBookTab(result.book, 'dashboard')}>
                {result.title}
              </div>
              <div className="db-spark__result-author">{result.author}</div>
              {result.reason && (
                <p className="db-spark__result-reason">"{result.reason}"</p>
              )}
              <button className="btn-tertiary btn--sm"
                onClick={() => { setState('idle'); setResult(null); }}>
                {t('dashboard.sparkTryAgain')}
              </button>
            </div>
          </div>
        )}

        {(state === 'error' || state === 'quota') && (
          <div className="db-spark__empty">
            <span className="db-spark__empty-text">
              {state === 'quota' ? t('oracle.quotaWallTitle') : 'Something went wrong.'}
            </span>
            <button className="btn-tertiary btn--sm"
              onClick={() => state === 'quota' ? go('profile', { scrollTo: 'subscription' }) : setState('idle')}>
              {state === 'quota' ? t('dashboard.aiQuotaUpgrade') : 'Try again'}
            </button>
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
