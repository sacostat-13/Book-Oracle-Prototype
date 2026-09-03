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

// ── Composites ───────────────────────────────────────────────────────────────
//
// WHEN A SKELETON, AND WHEN BookLoader?
//
// Both exist and they are not interchangeable.
//
//   Skeleton    — the shape of the result is KNOWN and the wait is short. A
//                 shelf, a grid, a list of rows. Drawing the layout in advance
//                 means nothing moves when the data lands.
//   BookLoader  — the wait is LONG and the result's shape is unknown. That is
//                 the Oracle: five to fifteen seconds, and a skeleton of three
//                 book cards would be a promise about a number of results we do
//                 not have yet. A literary quote is better company for that
//                 wait, and it is the app's own voice.
//
// So Oracle surfaces keep BookLoader. Everything that renders a predictable
// list gets a skeleton.

/** A wall of covers — The Stacks, and any cover grid. */
export function CoverGridSkeleton({ count = 8 }) {
  return (
    <div className="stacks__grid" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="stack-card stack-card--skeleton">
          <Skeleton variant="cover" />
          <Skeleton variant="text" width="82%" />
          <Skeleton variant="text" width="54%" />
        </div>
      ))}
    </div>
  );
}

/** Rows with a small leading square — friends, requests, feed events. */
export function RowListSkeleton({ count = 3, className = '' }) {
  return (
    <div className={`skeleton-rows ${className}`} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton variant="block" className="skeleton-row__avatar" />
          <div className="skeleton-row__body">
            <Skeleton variant="text" width="46%" />
            <Skeleton variant="text" width="72%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Cards in a responsive grid — curated lists, club directory. */
export function CardGridSkeleton({ count = 6, className = 'directory-grid' }) {
  return (
    <div className={className} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-card">
          <Skeleton variant="title" width="64%" />
          <Skeleton variant="text" lines={2} />
          <div className="bp-meta">
            <Skeleton variant="chip" width="72px" />
            <Skeleton variant="chip" width="56px" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Family rows on the Ledger — a family name over a milestone track.
 *
 * v0.67. Dropping the backfill stamp means the family ladders are recomputed on
 * every mount, so there is now a real interval where the persisted groups
 * (Series, Milestones, Genres-earlier) are already on screen and the family
 * rows are not. Without a placeholder that interval reads as "you have no
 * families", which is a wrong answer stated confidently — the worst kind.
 *
 * The dots mirror `.pf-family-track__stop`: same count as a typical early row
 * (three rungs plus the hollow next), so nothing shifts when the real track
 * lands.
 */
export function FamilyRowsSkeleton({ count = 3 }) {
  return (
    <div className="pf-family-rows" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="pf-family-row pf-family-row--skeleton">
          <Skeleton variant="text" width="34%" />
          <div className="pf-family-track">
            {Array.from({ length: 4 }, (_, j) => (
              <div key={j} className="pf-family-track__stop">
                <Skeleton variant="block" className="pf-family-track__dot" />
                <Skeleton variant="text" width="24px" />
                <Skeleton variant="text" width="40px" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
