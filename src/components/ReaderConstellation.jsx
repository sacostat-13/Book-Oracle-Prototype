// src/components/ReaderConstellation.jsx — "Your reading sky" (Profile → Overview).
//
// Every book the reader has finished is a star, gathered into one
// constellation per genre family; a gold thread runs through their last reads
// in the order they read them. Layout lives in constellation/buildSky.js, the
// WebGL in constellation/scene.js (lazy, fetched only when this section nears
// the viewport, and only on devices canUseWebGL() accepts).
//
// The family legend under the sky is real text and real links, and it is the
// whole component when WebGL is unavailable — so the information is never
// canvas-only.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useT, useI18n } from '../lib/I18nContext';
import { useRouter, RouteLink } from '../lib/RouterContext';
import { canUseWebGL, readColorVar, isParchment } from '../lib/webgl';
import { buildSky, THREAD_MAX } from './constellation/buildSky';

const MIN_STARS = 3;

function toHex([r, g, b]) {
  const h = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export default function ReaderConstellation() {
  const { state } = useData();
  const t = useT();
  const { lang } = useI18n();
  const { go } = useRouter();
  const hostRef = useRef(null);
  const labelRefs = useRef([]);
  const [live, setLive] = useState(false);
  const [tip, setTip] = useState(null); // { i, x, y }

  const sky = useMemo(
    () => buildSky(state, { unchartedLabel: t('profile.constellationUncharted') }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.library, state.genresByBookId, lang]
  );
  const enough = sky.stars.length >= MIN_STARS;
  const skyRef = useRef(sky);
  skyRef.current = sky;

  useEffect(() => {
    const host = hostRef.current;
    if (!enough || !host || !canUseWebGL()) return undefined;
    let api = null;
    let disposed = false;
    const start = () => {
      import('./constellation/scene')
        .then(({ createConstellationScene }) => {
          if (disposed) return;
          api = createConstellationScene(host, {
            sky,
            labels: labelRefs.current,
            colors: { gold: toHex(readColorVar('--ro-gold')), parchment: isParchment() },
            onHover: (i, at) => setTip(i >= 0 && at ? { i, ...at } : null),
            onPick: (i) => {
              const s = skyRef.current.stars[i];
              if (s) go('book-page', { bookKey: s.key });
            },
          });
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
      api?.dispose();
      setLive(false);
      setTip(null);
    };
  }, [sky, enough, go]);

  const star = tip ? sky.stars[tip.i] : null;
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
            {t('profile.constellationHint', { n: Math.min(sky.thread.length, THREAD_MAX) })}
          </p>
          <div className={`rc__sky${live ? ' is-live' : ''}`} ref={hostRef}>
            {live && (
              <div className="rc__labels" aria-hidden="true">
                {sky.families.map((f, i) => (
                  <span className="rc__label" key={f.slug} ref={(el) => { labelRefs.current[i] = el; }}>
                    {f.name}
                  </span>
                ))}
              </div>
            )}
            {star && (
              <div className="rc__tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
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
              </div>
            )}
          </div>
          <ul className="rc__legend">
            {sky.families.map((f) => (
              <li key={f.slug}>
                {f.slug === '_uncharted' ? (
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
