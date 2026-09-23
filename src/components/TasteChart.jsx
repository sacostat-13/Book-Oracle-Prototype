// src/components/TasteChart.jsx — v0.73 (Pro)
//
// "Your reader's chart" — a written portrait of the reader's shelf, in
// Profile → Overview. Recurring themes, which way they lean, the rooms of the
// library they have not walked into, and three directions to try.
//
// One chart per reader per language, kept in oracle_readings. It can be
// redrawn once it is a month old: the shelf changes slowly, and a chart that
// could be redrawn on every visit would turn a portrait into a slot machine.
//
// Needs a shelf to read. Under MIN_BOOKS the Oracle would be inventing a
// person, so the card says so instead of offering the call.

import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useT, useI18n, langDirective } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { useProLimits } from '../lib/proGates';
import { callClaude, parseJSONResponse, QuotaExceededError } from '../lib/claudeApi';
import { buildShelfSignature, buildExcludeHint, filterAlreadyKnown } from '../lib/oraclePrompt';
import { buildTasteProfile, describeTasteProfile } from '../lib/matchHelpers';
import { loadReading, saveReading } from '../lib/oracleReadings';

const MIN_BOOKS = 5;
const REDRAW_AFTER_DAYS = 30;
// Ask for more doors than we show: the model is only hinted at the shelf, and
// the exact check below cuts anything the reader already knows.
const DIRECTIONS_REQUEST = 6;
const DIRECTIONS_SHOWN = 3;

// Everything the reader already has a relationship with. A "door to try" that
// opens onto a book they have read is the failure they notice first.
function knownBooks(state) {
  return [
    ...(state.readNext || []),
    ...(state.currentlyReading || []).map((c) => c?.book || c),
    ...(state.library || []),
    ...(state.wishlist || []),
  ].filter((b) => b?.t);
}

function freshDirections(directions, known) {
  const asBooks = (directions || [])
    .filter((d) => d?.title)
    .map((d) => ({ ...d, t: d.title, a: d.author || '' }));
  return filterAlreadyKnown(asBooks, known).slice(0, DIRECTIONS_SHOWN);
}

export default function TasteChart() {
  const t = useT();
  const { lang } = useI18n();
  const { state } = useData();
  const { handleQuotaError, onCallSucceeded, confirmOracleCall } = useOracleQuota();
  const { isPro, goUpgrade } = useProLimits();

  const [chart, setChart] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | error

  useEffect(() => {
    if (!isPro) return undefined;
    let cancelled = false;
    loadReading('taste_chart', '', lang).then((r) => { if (!cancelled) setChart(r); });
    return () => { cancelled = true; };
  }, [isPro, lang]);

  const libraryCount = (state.library || []).length;
  const ageDays = chart?.createdAt ? (Date.now() - new Date(chart.createdAt).getTime()) / 86400e3 : null;
  // A direction the reader has since read (or already had, on charts drawn
  // before v0.71.1 checked) is dropped rather than shown. A chart left with no
  // doors to show can be redrawn early — it has stopped doing its job.
  const directions = chart ? freshDirections(chart.directions, knownBooks(state)) : [];
  const canRedraw = !chart || ageDays >= REDRAW_AFTER_DAYS || directions.length < DIRECTIONS_SHOWN;

  async function draw() {
    if (status === 'loading' || !canRedraw) return;
    if (!(await confirmOracleCall('taste_chart'))) return;
    setStatus('loading');

    const taste = describeTasteProfile(buildTasteProfile(state.library, state.genresByBookId, state.profile));
    const shelf = buildShelfSignature(state, { recentReads: 30, topRated: 20 });
    const known = knownBooks(state);
    const exclude = buildExcludeHint(known);
    const prompt = `${taste ? taste + '\n\n' : ''}${shelf}

Draw this reader's chart: a portrait of them as a reader, from their shelf alone.

Return ONLY valid JSON:
{"portrait":"two short paragraphs, addressed to the reader","themes":["3-5 recurring themes, a few words each"],"leaning":"one sentence on how they lean — pace, complexity, darkness, form","blindSpots":["2-3 kinds of book their shelf never visits"],"directions":[{"title":"...","author":"...","why":"one sentence"}]}
Give ${DIRECTIONS_REQUEST} directions. None may be a book the reader already knows — here is what is on their shelves (not exhaustive): ${exclude}
Be specific and name their books; avoid flattery.`;

    try {
      const raw = await callClaude(
        prompt,
        `You are a literary oracle reading one person's library back to them. Perceptive, warm, precise — never flattering, never diagnostic about the person beyond their reading. The reader decides what to make of it. ${langDirective(lang)} Every natural-language field MUST be in that language; titles and author names stay in their original language. Always return valid JSON.`,
        { source: 'taste_chart', maxTokens: 1500 }
      );
      const p = parseJSONResponse(raw);
      if (!p?.portrait) { setStatus('error'); return; }
      const body = {
        portrait: String(p.portrait),
        themes: (p.themes || []).filter((x) => typeof x === 'string').slice(0, 5),
        leaning: typeof p.leaning === 'string' ? p.leaning : null,
        blindSpots: (p.blindSpots || []).filter((x) => typeof x === 'string').slice(0, 3),
        // Stored already filtered; filtered again on render (below) because
        // the shelf keeps changing after the chart is drawn.
        directions: freshDirections(p.directions, known).map(({ title, author, why }) => ({ title, author, why })),
      };
      setChart({ ...body, createdAt: new Date().toISOString() });
      setStatus('idle');
      onCallSucceeded?.();
      saveReading('taste_chart', '', lang, body);
    } catch (e) {
      if (e instanceof QuotaExceededError) handleQuotaError(e);
      setStatus('error');
    }
  }

  return (
    <section className="taste-chart">
      <h2 className="taste-chart__title">{t('pro.chartTitle')}</h2>

      {!isPro ? (
        <div className="taste-chart__locked">
          <p className="taste-chart__lead">{t('pro.chartLockedBody')}</p>
          <button type="button" className="btn-primary btn--sm" onClick={goUpgrade}>{t('pro.gate.upgrade')}</button>
        </div>
      ) : libraryCount < MIN_BOOKS ? (
        <p className="taste-chart__lead">{t('pro.chartTooFew', { count: MIN_BOOKS })}</p>
      ) : !chart ? (
        <div>
          <p className="taste-chart__lead">{t('pro.chartIntro')}</p>
          <button type="button" className="btn-primary btn--sm" onClick={draw} disabled={status === 'loading'}>
            {status === 'loading' ? t('pro.chartDrawing') : `✦ ${t('pro.chartCta')}`}
          </button>
          {status === 'error' && <p className="db-ai__note">{t('pro.longReadingError')}</p>}
        </div>
      ) : (
        <div className="taste-chart__body">
          {chart.portrait.split(/\n+/).map((para, i) => (
            <p key={i} className="taste-chart__portrait">{para}</p>
          ))}

          {chart.themes?.length > 0 && (
            <div className="taste-chart__row">
              <div className="bp-section__label">{t('pro.chartThemes')}</div>
              <div className="taste-chart__chips">
                {chart.themes.map((th) => <span key={th} className="bp-pill">{th}</span>)}
              </div>
            </div>
          )}

          {chart.leaning && (
            <div className="taste-chart__row">
              <div className="bp-section__label">{t('pro.chartLeaning')}</div>
              <p>{chart.leaning}</p>
            </div>
          )}

          {chart.blindSpots?.length > 0 && (
            <div className="taste-chart__row">
              <div className="bp-section__label">{t('pro.chartBlindSpots')}</div>
              <ul className="taste-chart__list">{chart.blindSpots.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          )}

          {directions.length > 0 && (
            <div className="taste-chart__row">
              <div className="bp-section__label">{t('pro.chartDirections')}</div>
              <ul className="taste-chart__list">
                {directions.map((d) => (
                  <li key={d.title}><cite>{d.title}</cite>{d.author ? `, ${d.author}` : ''}{d.why ? ` — ${d.why}` : ''}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="db-ai__note">
            {t('pro.chartDrawnOn', { date: new Date(chart.createdAt).toLocaleDateString(lang === 'es' ? 'es-AR' : undefined, { month: 'long', day: 'numeric', year: 'numeric' }) })}
            {canRedraw && (
              <> · <button type="button" className="btn-text" style={{ padding: 0, fontSize: 'inherit' }} onClick={draw} disabled={status === 'loading'}>
                {status === 'loading' ? t('pro.chartDrawing') : t('pro.chartRedraw')}
              </button></>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
