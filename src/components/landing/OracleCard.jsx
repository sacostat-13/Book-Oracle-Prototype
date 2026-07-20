// src/components/landing/OracleCard.jsx
// The one card to rule the whole page. Every card on the story landing —
// hero spread, dealt suggestions, pricing tiers, the Epilogue CTA — renders
// through this component so they all share one visual language: 2:3 ratio,
// gold border, inner frame, sigil + serif name + mono meaning.
//
// Variants:
//   back  — face-down card (rune + wordmark)
//   front — face-up card (sigil / name / divider / meaning)
//   mini  — small dealt card used inside the Rite I mock
//   tier  — large tarot-style pricing card (content via children)
//   cta   — the small returned card in the Epilogue (render as <button>)
//
// The .oc__glare span is the hook useCardTilt animates; it costs nothing when
// tilt is off. The inner frame is a ::after in SCSS.
import { forwardRef } from 'react';

const OracleCard = forwardRef(function OracleCard(
  {
    variant = 'front',
    sigil = '✧',
    name,
    meaning,
    rune = '☩',
    backword = 'The Books Oracle',
    as: Tag = 'div',
    className = '',
    children,
    ...rest
  },
  ref
) {
  return (
    <Tag ref={ref} className={`oc oc--${variant} ${className}`.trim()} {...rest}>
      {variant === 'back' ? (
        <>
          <span className="oc__rune" aria-hidden="true">{rune}</span>
          <span className="oc__backword">{backword}</span>
        </>
      ) : children || (
        <>
          <span className="oc__sigil" aria-hidden="true">{sigil}</span>
          <span className="oc__name">{name}</span>
          <span className="oc__divider" aria-hidden="true" />
          <span className="oc__meaning">{meaning}</span>
        </>
      )}
      <span className="oc__glare" aria-hidden="true" />
    </Tag>
  );
});

export default OracleCard;
