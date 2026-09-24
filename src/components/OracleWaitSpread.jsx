// src/components/OracleWaitSpread.jsx
//
// The long-wait ritual for Oracle calls. BookLoader renders this when a
// caller passes `spread` (OracleAsk, OracleCategories, OracleSimilar). For the
// first few seconds nothing changes — most Oracle calls land before it
// matters. Past `showAfterMs` the loader gives way to a tarot spread under a
// sky of stars that choose a card, every ~12 s (see oracleSpread/scene.js),
// with a line explaining why the screen changed: the Oracle is taking longer.
//
// The three.js chunk is fetched halfway through the delay, so it is in cache
// by the time the spread appears, and never fetched at all for a quick
// answer. No WebGL (or reduced motion, Save-Data…) → the quote loader only.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/I18nContext';
import { canUseWebGL, readColorVar, isParchment } from '../lib/webgl';

const SHOW_AFTER_MS = 8000;
const SIGILS = ['✧', '☾', '⚜', '❦', '✦', '☼', '❧'];

function toHex([r, g, b]) {
  const h = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export default function OracleWaitSpread({ onActive, showAfterMs = SHOW_AFTER_MS }) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const hostRef = useRef(null);
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!canUseWebGL()) return undefined;
    let disposed = false;
    let api = null;
    let chunk = null;
    const prefetch = setTimeout(() => {
      chunk = import('./oracleSpread/scene');
      chunk.catch(() => {});
    }, showAfterMs / 2);
    const show = setTimeout(() => {
      (chunk || import('./oracleSpread/scene'))
        .then(({ createSpreadScene }) => {
          if (disposed || !hostRef.current) return;
          api = createSpreadScene(hostRef.current, {
            mobile: window.innerWidth <= 640,
            faces: SIGILS.map((sigil, i) => ({ sigil, name: tRef.current(`common.oracleArcana${i + 1}`) })),
            colors: {
              gold: toHex(readColorVar('--ro-gold')),
              ink: toHex(readColorVar('--ro-surface', document.body, [0.08, 0.07, 0.05])),
              text: toHex(readColorVar('--ro-text', document.body, [0.91, 0.87, 0.79])),
              parchment: isParchment(),
            },
          });
          if (api) {
            setOn(true);
            onActiveRef.current?.(true);
          }
        })
        .catch(() => {});
    }, showAfterMs);
    return () => {
      disposed = true;
      clearTimeout(prefetch);
      clearTimeout(show);
      api?.dispose();
    };
  }, [showAfterMs]);

  return (
    <div className={`ows${on ? ' is-on' : ''}`}>
      <div className="ows__stage" ref={hostRef} aria-hidden="true" />
      {on && <p className="ows__hint">{t('common.oracleWaitHint')}</p>}
    </div>
  );
}
