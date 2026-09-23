// src/components/OracleWaitSpread.jsx
//
// The long-wait toy for Oracle calls. BookLoader renders this when a caller
// passes `spread` (OracleAsk, OracleCategories, OracleSimilar). For the first
// few seconds nothing changes — most Oracle calls land before it matters.
// Past SHOW_AFTER_MS the book mark gives way to a ring of cards from the
// reader's own shelf (see oracleSpread/scene.js) that they can spin and turn.
//
// The three.js chunk is fetched halfway through the delay, so it is already
// in cache by the time the spread appears, and never fetched at all for a
// quick answer. No WebGL (or reduced motion, Save-Data…) → quotes only, as
// before.
import { useContext, useEffect, useRef, useState } from 'react';
import { DataContext } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import { canUseWebGL, readColorVar, isParchment } from '../lib/webgl';

const SHOW_AFTER_MS = 8000;

function toHex([r, g, b]) {
  const h = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Books with covers first, then the rest; shuffled so repeat waits differ.
function pickBooks(state) {
  if (!state) return [];
  const all = [
    ...(state.currentlyReading || []).map((c) => c?.book || c),
    ...(state.library || []),
    ...(state.readNext || []),
    ...(state.wishlist || []),
  ].filter((b) => b?.t);
  const seen = new Set();
  const uniq = all.filter((b) => {
    const k = `${b.t}|${b.a}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const shuffled = uniq.sort(() => Math.random() - 0.5);
  const withCover = shuffled.filter((b) => b.coverUrl);
  const without = shuffled.filter((b) => !b.coverUrl);
  return [...withCover, ...without].slice(0, 12);
}

export default function OracleWaitSpread({ onActive }) {
  const t = useT();
  const data = useContext(DataContext);
  const hostRef = useRef(null);
  const stateRef = useRef(data?.state);
  stateRef.current = data?.state;
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
    }, SHOW_AFTER_MS / 2);
    const show = setTimeout(() => {
      (chunk || import('./oracleSpread/scene'))
        .then(({ createSpreadScene }) => {
          if (disposed || !hostRef.current) return;
          const parchment = isParchment();
          api = createSpreadScene(hostRef.current, {
            books: pickBooks(stateRef.current),
            mobile: window.innerWidth <= 640,
            colors: {
              gold: toHex(readColorVar('--ro-gold')),
              ink: toHex(readColorVar('--ro-surface', document.body, [0.08, 0.07, 0.05])),
              parchment,
            },
          });
          if (api) {
            setOn(true);
            onActiveRef.current?.(true);
          }
        })
        .catch(() => {});
    }, SHOW_AFTER_MS);
    return () => {
      disposed = true;
      clearTimeout(prefetch);
      clearTimeout(show);
      api?.dispose();
    };
  }, []);

  return (
    <div className={`ows${on ? ' is-on' : ''}`} aria-hidden="true">
      <div className="ows__stage" ref={hostRef} />
      {on && <p className="ows__hint">{t('common.oracleWaitHint')}</p>}
    </div>
  );
}
