// src/components/FeatureCarousel.jsx
// Landing-page feature showcase: numbered eyebrow + title/subtitle/description
// on one side, a slide carousel (thumbnail + slide title/body) on the other.
// Sides alternate left/right by `reverse` so the section doesn't feel like a
// repeating template. Built for the public Landing page only -- self-contained,
// no dependency on app auth/data state.

import { useState, useRef, useCallback, useEffect } from 'react';

function IconArrow({ dir = 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      {dir === 'right' ? <path d="m9 6 6 6-6 6" /> : <path d="m15 6-6 6 6 6" />}
    </svg>
  );
}

export default function FeatureCarousel({
  number,        // "01"
  title,         // "The Oracle"
  subtitle,      // "Recommendations that get you"
  description,   // paragraph
  slides,        // [{ title, body, image? }]
  icon,          // decorative svg node shown on placeholder thumbnails
  reverse = false,
  className = '',
}) {
  const [active, setActive] = useState(0);
  const touchStartX = useRef(null);
  const count = slides.length;

  const go = useCallback((next) => {
    setActive((cur) => (next + count) % count);
  }, [count]);

  useEffect(() => { setActive(0); }, [count]);

  function onTouchStart(e) { touchStartX.current = e.touches[0].clientX; }
  function onTouchEnd(e) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) go(active + (dx < 0 ? 1 : -1));
    touchStartX.current = null;
  }
  function onKeyDown(e) {
    if (e.key === 'ArrowRight') go(active + 1);
    if (e.key === 'ArrowLeft') go(active - 1);
  }

  const slide = slides[active];

  return (
    <section className={`lp-feature${reverse ? ' lp-feature--reverse' : ''} lp-reveal ${className}`}>
      <div className="lp-feature__text">
        <div className="lp-feature__number">{number}</div>
        <h3 className="lp-feature__title">{title}</h3>
        <p className="lp-feature__subtitle">{subtitle}</p>
        <p className="lp-feature__description">{description}</p>
      </div>

      <div
        className="lp-feature__carousel"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="group"
        aria-roledescription="carousel"
        aria-label={`${title} -- feature highlights`}
      >
        <div className="lp-carousel__frame">
          <div className="lp-carousel__thumb">
            {slide.image ? (
              <img src={slide.image} alt={`${title} — ${slide.title}`} loading="lazy" />
            ) : (
              <div className="lp-carousel__thumb-placeholder" aria-hidden>
                {icon}
                <span>{number}</span>
              </div>
            )}
          </div>
          <div className="lp-carousel__caption">
            <div className="lp-carousel__caption-title">{slide.title}</div>
            <p className="lp-carousel__caption-body">{slide.body}</p>
          </div>
        </div>

        <div className="lp-carousel__controls">
          <button
            type="button"
            className="lp-carousel__arrow"
            onClick={() => go(active - 1)}
            aria-label="Previous slide"
          >
            <IconArrow dir="left" />
          </button>

          <div className="lp-carousel__dots" role="tablist">
            {slides.map((s, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === active}
                aria-label={s.title}
                className={`lp-carousel__dot${i === active ? ' is-active' : ''}`}
                onClick={() => go(i)}
              />
            ))}
          </div>

          <button
            type="button"
            className="lp-carousel__arrow"
            onClick={() => go(active + 1)}
            aria-label="Next slide"
          >
            <IconArrow dir="right" />
          </button>
        </div>
      </div>
    </section>
  );
}
