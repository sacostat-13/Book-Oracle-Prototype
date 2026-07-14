// src/components/CoachMark.jsx — v0.46
//
// A single contextual coach-mark (docs/feature-discovery-v1-spec.md, Move 2):
// one quiet, dismissible pointer at the one non-obvious thing on a page a
// first-time visitor would miss. NOT a multi-step tour, never blocking.
//
// Discipline:
//   - Once, then gone. Shows only if its `id` is not in `coachmarksSeen`;
//     dismissing (the ×, or the caller acting on the target) adds the id and
//     it never returns. Seen-state persists like readNext/dashboardLayout.
//   - One per page. Place at most one; don't stack them.
//
// Positioning: drop <CoachMark> inside a `position: relative` container that
// wraps the target element. The bubble pins itself to one edge via `placement`
// ('bottom' | 'top' | 'left' | 'right', default 'bottom'). See
// styles/components/_coachmark.scss.
//
// "Acting on the target dismisses it": pass the same id to dismissCoachmark
// from the target's own handler, e.g.
//   const { dismissCoachmark } = useData();
//   <button onClick={() => { dismissCoachmark('bookpage-categories'); addCategory(); }}>

import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';

export default function CoachMark({ id, title, body, placement = 'bottom', className = '' }) {
  const { coachmarksSeen, dismissCoachmark } = useData();
  const t = useT();

  if (!id) return null;
  if ((coachmarksSeen || []).includes(id)) return null;

  return (
    <div
      className={`coachmark coachmark--${placement}${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        className="coachmark__close"
        aria-label={t('coachmark.dismiss')}
        onClick={() => dismissCoachmark(id)}
      >
        ✕
      </button>
      {title && <div className="coachmark__title">{title}</div>}
      <div className="coachmark__body">{body}</div>
    </div>
  );
}
