// src/views/dashboard/WidgetShell.jsx — the frame and title every Dashboard widget uses.

// ─── Sparkle SVG icon (Oracle sigil) ─────────────────────────────────────────
export const IconSparkle = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5Z" />
  </svg>
);

export const IconDiamond = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2 L20 12 L12 22 L4 12Z" />
  </svg>
);

export const IconBook = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

// ─── Widget heading ──────────────────────────────────────────────
// Real <h2> so the dashboard has a document outline; styled serif roman rather
// than a mono overline. The small gold glyph is the one decorative carry-over.
export function WidgetTitle({ icon, label }) {
  return (
    <h2 className="db-widget-title">
      {icon && <span className="db-widget-title__glyph">{icon}</span>}
      {label}
    </h2>
  );
}

// ─── Widget shell ─────────────────────────────────────────────────────────────
export function WidgetShell({ icon, label, children }) {
  return (
    <section className="db-section">
      {label && <WidgetTitle icon={icon} label={label} />}
      {children}
    </section>
  );
}
