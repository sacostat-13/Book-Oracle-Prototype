// src/components/ProGate.jsx — v0.72
//
// The one card that says "this next one is part of Pro". Used where a Free
// reader has reached a creation limit (clubs, Anthologies, Passages).
//
// Tone rule: it names what they already have before what they don't. "Your
// first club is yours" — never "you have hit your limit".

import { useT } from '../lib/I18nContext';
import { useProLimits } from '../lib/proGates';

export default function ProGate({ feature, compact = false }) {
  const t = useT();
  const { limits, goUpgrade } = useProLimits();
  const limit = limits[feature];

  return (
    <div className={`pro-gate${compact ? ' pro-gate--compact' : ''}`} role="note">
      <span className="pro-gate__glyph" aria-hidden="true">✦</span>
      <div className="pro-gate__text">
        <div className="pro-gate__title">{t(`pro.gate.${feature}.title`, { limit })}</div>
        {!compact && <p className="pro-gate__body">{t(`pro.gate.${feature}.body`, { limit })}</p>}
      </div>
      <button type="button" className="btn-primary btn--sm" onClick={goUpgrade}>
        {t('pro.gate.upgrade')}
      </button>
    </div>
  );
}
