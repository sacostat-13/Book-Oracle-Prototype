// src/components/ReaderConstellation.jsx — "Your reading sky" (Profile → Overview).
//
// Every book the reader has finished is a star, gathered into one
// constellation per genre family; a gold thread runs through their last reads
// in the order they read them. Layout lives in constellation/buildSky.js, the
// WebGL in constellation/scene.js (lazy, fetched only when this section nears
// the viewport, and only on devices canUseWebGL() accepts).
//
// Pro draws the whole sky: every star named, the thread, zoom. Free gets a
// glimpse of their own sky — the same 3D sky, but only the most recent reads
// are lit and named; the rest are faint unnamed stars, and hovering one says
// what Pro would show.
//
// Choosing a family (its name in the sky, or its chip in the legend) clears
// the sky down to that family and flies to it.
//
// The family legend under the sky is real text and real links, and it is the
// whole component when WebGL is unavailable — so the information is never
// canvas-only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useT, useI18n } from '../lib/I18nContext';
import { useRouter, RouteLink } from '../lib/RouterContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { useProLimits } from '../lib/proGates';
import { canUseWebGL, readColorVar, isParchment } from '../lib/webgl';
import { buildSky, THREAD_MAX } from './constellation/buildSky';

const MIN_STARS = 3;
const TIP_LINGER_MS = 350;

function toHex([r, g, b]) {
  const h = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export default function ReaderConstellation() {
  const { state } = useData();
  const t = useT();
  const { lang } = useI18n();
  const { go } = useRouter();
  const { loading: quotaLoading } = useOracleQuota();
  const { isPro, goUpgrade } = useProLimits();
  const glimpse = !isPro;
  const hostRef = useRef(null);
  const apiRef = useRef(null);
  const labelRefs = useRef([]);
  const tipTimer = useRef(0);
  const [live, setLive] = useState(false);
  const [tip, setTip] = useState(null); // { i, x, y, locked }
  const [zoomed, setZoomed] = useState(false);
  const [focus, setFocus] = useState(-1);
  const [hint, setHint] = useState(false);

  const sky = useMemo(
    () => buildSky(state, { unchartedLabel: t('profile.constellationUncharted') }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.library, state.genresByBookId, lang]
  );
  const enough = sky.stars.length >= MIN_STARS;
  const skyRef = useRef(sky);
  skyRef.current = sky;
  const unnamed = glimpse ? Math.max(0, sky.stars.length - sky.lit.length) : 0;

  const showTip = useCallback((i, at, locked) => {
    clearTimeout(tipTimer.current);
    if (i >= 0 && at) setTip({ i, ...at, locked });
    else tipTimer.current = setTimeout(() => setTip(null), TIP_LINGER_MS);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    // Wait for the quota so a Pro reader never sees the glimpse flash first.
    if (!enough || !host || quotaLoading || !canUseWebGL()) return undefined;
    let api = null;
    let disposed = false;
    let hintTimer = 0;
    const start = () => {
      import('./constellation/scene')
        .then(({ createConstellationScene }) => {
          if (disposed) return;
          api = createConstellationScene(host, {
            sky,
            glimpse,
            labels: labelRefs.current,
            colors: { gold: toHex(readColorVar('--ro-gold')), parchment: isParchment() },
            onHover: showTip,
            onPick: (i) => {
              const s = skyRef.current.stars[i];
              if (s) go('book-page', { bookKey: s.key });
            },
            onView: ({ zoomed: z }) => setZoomed(z),
            onHint: () => {
              setHint(true);
              clearTimeout(hintTimer);
              hintTimer = setTimeout(() => setHint(false), 2200);
            },
          });
          apiRef.current = api;
          if (api) setLive(true);
        })
        .catch(() => {});
    };
    // Fetch the chunk only as the section approaches.
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { io.disconnect(); start(); }
    }, { rootMargin: '300px' });
    io.observe(host);
    return () => {
      disposed = true;
      io.disconnect();
      clearTimeout(hintTimer);
      api?.dispose();
      apiRef.current = null;
      setLive(false);
      setTip(null);
      setZoomed(false);
      setFocus(-1);
    };
  }, [sky, enough, go, glimpse, quotaLoading, showTip]);

  useEffect(() => () => clearTimeout(tipTimer.current), []);

  const choose = useCallback((i) => {
    setFocus((cur) => {
      const next = cur === i ? -1 : i;
      apiRef.current?.focus(next);
      return next;
    });
    setTip(null);
  }, []);

  // Esc clears a focused family.
  useEffect(() => {
    if (focus < 0) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') choose(focus); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, choose]);

  const star = tip ? sky.stars[tip.i] : null;
  const fam = focus >= 0 ? sky.families[focus] : null;
  const fmtDate = (ms) =>
    new Date(ms).toLocaleDateString(lang === 'es' ? 'es-AR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <section className="rc">
      <h2 className="rc__title">{t('profile.constellationTitle')}</h2>
      {!enough ? (
        <p className="rc__lead">{t('profile.constellationEmpty')}</p>
      ) : (
        <>
          <p className="rc__lead">
            {glimpse
              ? t('profile.constellationGlimpseHint', { n: sky.lit.length })
              : t('profile.constellationHint', { n: Math.min(sky.thread.length, THREAD_MAX) })}
          </p>
          <div className={`rc__sky${live ? ' is-live' : ''}`} ref={hostRef}>
            {live && (
              <div className="rc__labels" aria-hidden="true">
                {sky.families.map((f, i) => (
                  <button
                    type="button"
                    className={`rc__label${focus === i ? ' is-on' : ''}`}
                    key={f.slug}
                    ref={(el) => { labelRefs.current[i] = el; }}
                    onClick={() => choose(i)}
                    aria-pressed={focus === i}
                    tabIndex={-1}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}

            {live && fam && (
              <div className="rc__focus">
                <span className="rc__focus-name">{fam.name} <b>{fam.count}</b></span>
                {fam.slug !== '_uncharted' && (
                  <RouteLink className="rc__focus-link" to="family-page" params={{ familySlug: fam.slug }}>
                    {t('profile.constellationFamilyPage')}
                  </RouteLink>
                )}
                <button type="button" className="rc__focus-clear" onClick={() => choose(focus)}>
                  {t('profile.constellationShowAll')}
                </button>
              </div>
            )}

            {live && !glimpse && (
              <div className="rc__controls">
                <button type="button" className="rc__ctl" onClick={() => apiRef.current?.zoomBy(0.6)} aria-label={t('profile.constellationZoomIn')} title={t('profile.constellationZoomIn')}>+</button>
                <button type="button" className="rc__ctl" onClick={() => apiRef.current?.zoomBy(1 / 0.6)} aria-label={t('profile.constellationZoomOut')} title={t('profile.constellationZoomOut')}>−</button>
                <button type="button" className="rc__ctl" onClick={() => { apiRef.current?.reset(); if (focus >= 0) setFocus(-1); }} disabled={!zoomed} aria-label={t('profile.constellationReset')} title={t('profile.constellationReset')}>⟲</button>
              </div>
            )}

            {hint && <div className="rc__hint" role="status">{t('profile.constellationZoomHint')}</div>}

            {star && (
              <div
                className="rc__tip"
                style={{ left: tip.x, top: tip.y }}
                role="tooltip"
                onMouseEnter={() => clearTimeout(tipTimer.current)}
                onMouseLeave={() => showTip(-1)}
              >
                {tip.locked ? (
                  <>
                    <cite className="rc__tip-title">{t('profile.constellationUnnamed')}</cite>
                    <span className="rc__tip-meta">{sky.families[star.family]?.name}</span>
                    <span className="rc__tip-author">{t('profile.constellationUnnamedBody')}</span>
                    <button type="button" className="rc__tip-open" onClick={goUpgrade}>{t('pro.gate.upgrade')} →</button>
                  </>
                ) : (
                  <>
                    <cite className="rc__tip-title">{star.book.t}</cite>
                    {star.book.a && <span className="rc__tip-author">{star.book.a}</span>}
                    <span className="rc__tip-meta">
                      {sky.families[star.family]?.name}
                      {star.readAt ? ` · ${t('profile.constellationRead', { date: fmtDate(star.readAt) })}` : ''}
                      {star.book.rating ? ` · ${'★'.repeat(star.book.rating)}` : ''}
                    </span>
                    <RouteLink className="rc__tip-open" to="book-page" params={{ bookKey: star.key }}>
                      {t('profile.constellationOpen')}
                    </RouteLink>
                  </>
                )}
              </div>
            )}
          </div>

          {glimpse && unnamed > 0 && (
            <div className="rc__pro">
              <p>{t('profile.constellationGlimpseMore', { n: unnamed })}</p>
              <button type="button" className="btn-primary btn--sm" onClick={goUpgrade}>{t('pro.gate.upgrade')}</button>
            </div>
          )}

          <ul className="rc__legend">
            {sky.families.map((f, i) => (
              <li key={f.slug}>
                {live ? (
                  <button
                    type="button"
                    className={`rc__chip${focus === i ? ' is-on' : ''}`}
                    onClick={() => choose(i)}
                    aria-pressed={focus === i}
                  >
                    {f.name} <b>{f.count}</b>
                  </button>
                ) : f.slug === '_uncharted' ? (
                  <span className="rc__chip">{f.name} <b>{f.count}</b></span>
                ) : (
                  <RouteLink className="rc__chip" to="family-page" params={{ familySlug: f.slug }}>
                    {f.name} <b>{f.count}</b>
                  </RouteLink>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
