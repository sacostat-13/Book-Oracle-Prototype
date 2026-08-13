// Skeleton.jsx — placeholder shapes for content that is on its way.
//
// WHY A SHARED PRIMITIVE
//
// The app already had two ad-hoc versions of this idea: `.chip--skeleton` in
// _badges.scss (v0.63, for genre chips) and a bare line of loading text on the
// Book Page. Both are the same gesture — reserve the space, say "not empty,
// just not here yet" — and a third hand-rolled copy would have been the point
// at which they started disagreeing.
//
// The rule that matters: a skeleton must occupy the SAME BOX the real content
// will. A placeholder of the wrong height is worse than no placeholder, because
// the layout still jumps when the content lands — you have paid the cost of the
// extra markup and kept the problem it was meant to solve.
//
// Deliberately not a "shimmer": a travelling highlight draws the eye to the
// loading state, which is the opposite of what it is for. A slow opacity pulse
// says "pending" without competing with the content around it, and it honours
// prefers-reduced-motion.

/**
 * @param {'text'|'title'|'chip'|'block'|'cover'} variant
 * @param {number} [lines]  for variant="text", how many lines to draw
 * @param {string} [width]  CSS width override, e.g. '60%'
 */
export default function Skeleton({ variant = 'text', lines = 1, width, className = '', style }) {
  if (variant === 'text' && lines > 1) {
    return (
      <div className={`skeleton-stack ${className}`} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className="skeleton skeleton--text"
            // The last line short, the way a real paragraph ends. Without it a
            // block of identical bars reads as a table rather than prose.
            style={i === lines - 1 ? { width: '62%' } : undefined}
          />
        ))}
      </div>
    );
  }

  return (
    <span
      className={`skeleton skeleton--${variant} ${className}`}
      style={{ ...(width ? { width } : null), ...style }}
      aria-hidden="true"
    />
  );
}

/**
 * A whole-page placeholder for a route that cannot render anything yet.
 * Mirrors the Book Page hero: cover on the left, title/author/meta on the right.
 */
export function BookPageSkeleton() {
  return (
    <div className="bp-skeleton" aria-busy="true" aria-live="polite">
      <div className="bp-hero">
        <div className="bp-cover-col">
          <Skeleton variant="cover" />
        </div>
        <div className="bp-info">
          <div className="bp-meta">
            <Skeleton variant="chip" />
            <Skeleton variant="chip" width="68px" />
          </div>
          <Skeleton variant="title" />
          <Skeleton variant="text" width="45%" />
          <div className="bp-meta">
            <Skeleton variant="chip" width="88px" />
            <Skeleton variant="chip" width="104px" />
          </div>
        </div>
      </div>
      <div className="bp-section">
        <Skeleton variant="text" lines={4} />
      </div>
    </div>
  );
}
