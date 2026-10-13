// ── Horizontal bar for genre breakdown ───────────────────────────────────────
// NOTE: the wrapper previously reused the ".pf-genre-bar" class name, but in
// the design system ".pf-genre-bar" IS the 2px track itself (overflow:hidden) —
// applying it to the wrapper silently clipped/collapsed the head + track.
// Correct wrapper is ".pf-genre-row"; track is ".pf-genre-bar"; fill is
// ".pf-genre-fill" (".pf-bar-track"/".pf-bar-fill" don't exist in the DS).
export default function GenreBar({ name, count, max }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="pf-genre-row">
      <div className="pf-genre-bar__head">
        <span className="pf-genre-bar__name">{name}</span>
        <span className="pf-genre-bar__count">{count}</span>
      </div>
      <div className="pf-genre-bar">
        <div className="pf-genre-fill" style={{ '--pf-bar-w': `${pct}%` }} />
      </div>
    </div>
  );
}
