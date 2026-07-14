// src/components/EmptyState.jsx — v0.46
//
// The shared zero-state (docs/feature-discovery-v1-spec.md, Move 1). Replaces
// the bespoke variants (.lv-empty, .fp-empty, .clubs-empty-*, ad-hoc
// .empty-state markup) with one component that TEACHES what a feature is for
// and, optionally, offers the action that fills it — the moment-of-intent place
// to explain a feature.
//
// Renders the canonical .empty-state DOM already styled in styles/_global.scss
// (ornament + title + text), and adds an optional primary action. When an
// action is present the block renders crisp (`is-actionable` drops the faded
// look) so the call-to-action reads clearly; a plain informational empty state
// keeps the quiet, dimmed treatment.
//
// Usage:
//   <EmptyState
//     ornament="❦"
//     title={t('lists.emptyTitle')}
//     body={t('lists.emptyBody')}          // one sentence: what this is FOR
//     action={{ label: t('lists.emptyCta'), onClick: () => setCreating(true) }}
//   />
//
// `action.onClick` may be omitted if `action.href` is given (rare); `children`
// renders below the action for the odd case that needs extra controls.

export default function EmptyState({ ornament = '❦', title, body, action, children }) {
  // Crisp (un-faded) whenever there's something to act on — a primary action
  // or a caller-supplied button group in `children`. A purely informational
  // empty state (no action, no children) keeps the quiet, dimmed treatment.
  const actionable = !!action || !!children;
  return (
    <div className={`empty-state${actionable ? ' is-actionable' : ''}`}>
      {ornament && <div className="ornament" aria-hidden="true">{ornament}</div>}
      {title && <div className="empty-state-title">{title}</div>}
      {body && <div className="empty-state-text">{body}</div>}
      {action && (
        <div className="empty-state-action">
          <button className="btn btn-primary" onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
