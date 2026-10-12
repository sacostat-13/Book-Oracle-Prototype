// src/components/primitives/Modal.jsx — the one modal shell.
//
// Every dialog in the app renders through this. It owns what each modal used
// to re-implement (and often half-implement):
//   - portal to <body>, so no ancestor's overflow/transform can clip it
//   - role="dialog", aria-modal and an accessible name
//   - Escape and a backdrop press close it — only the topmost layer reacts
//     (useEscape), and neither works while `dismissible` is false (saving)
//   - focus moves to the dialog on open (or stays on an autoFocus field inside),
//     Tab is kept inside, and focus returns to whatever had it on close
//   - page scroll is locked while any modal is open (useScrollLock, counted)
//
// Render it only while open, as every modal here already does:
//   {open && <Modal onClose={close} label="Rate this book">…</Modal>}
//
// Looks: the card is the former `.rating-modal` shell. Per-modal styling keeps
// working through `className` (panel) and `overlayClassName` — the module's own
// rules are wrapped in :where(), so they have zero specificity and any page
// class wins regardless of stylesheet order. See src/styles/README.md.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import CornerBrackets from '../CornerBrackets';
import { useEscape } from '../../hooks/useEscape';
import { useScrollLock } from '../../hooks/useScrollLock';
import styles from './Modal.module.scss';

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableIn(el) {
  return Array.from(el.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
}

const cx = (...c) => c.filter(Boolean).join(' ');

/**
 * Modal dialog.
 *
 * @param {object}   props
 * @param {() => void} props.onClose        called on Escape, backdrop press (when dismissible)
 * @param {boolean}  [props.dismissible=true] false while closing would lose work (e.g. saving)
 * @param {string}   [props.label]           accessible name, when there is no visible title
 * @param {string}   [props.labelledBy]      id of the visible title element (preferred)
 * @param {'sm'|'md'|'lg'} [props.size='md'] max width: 420 / 480 / 640px (lg also caps height at 85vh)
 * @param {'card'|'sections'|'fullscreen'} [props.layout='card']
 *        card: padded panel that scrolls as a whole.
 *        sections: no padding; a head / body / foot stack where only the body scrolls
 *                  (children use .modal-head/.modal-body/.modal-foot or .modal__head/__body/__actions).
 *        fullscreen: no panel chrome at all (camera scanner).
 * @param {boolean}  [props.sheetOnMobile=false] dock to the bottom as a sheet below the mobile breakpoint
 * @param {boolean|'sm'} [props.brackets=true]  decorative corner brackets
 * @param {string}   [props.className]        extra class on the panel
 * @param {string}   [props.overlayClassName] extra class on the backdrop
 * @param {React.ReactNode} props.children
 */
export default function Modal({
  onClose,
  dismissible = true,
  label,
  labelledBy,
  size = 'md',
  layout = 'card',
  sheetOnMobile = false,
  brackets = true,
  className,
  overlayClassName,
  children,
}) {
  const panelRef = useRef(null);

  useScrollLock(true);
  useEscape(() => onClose?.(), dismissible);

  // Focus in on open, back out on close.
  useEffect(() => {
    const previous = document.activeElement;
    const panel = panelRef.current;
    // An autoFocus field inside has already taken focus during commit; keep it.
    // Otherwise focus the dialog itself rather than its first button: screen
    // readers announce it, Tab reaches the first control, and a mouse user
    // doesn't get a focus ring flashed onto the close button.
    if (panel && !panel.contains(document.activeElement)) {
      panel.focus({ preventScroll: true });
    }
    return () => {
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  function onKeyDown(e) {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = focusableIn(panelRef.current);
    if (items.length === 0) { e.preventDefault(); panelRef.current.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  // Close only when the press both started and ended on the backdrop, so a
  // text selection dragged out of the panel doesn't dismiss the dialog.
  const downOnBackdrop = useRef(false);
  const onBackdropDown = (e) => { downOnBackdrop.current = e.target === e.currentTarget; };
  const onBackdropClick = (e) => {
    if (dismissible && downOnBackdrop.current && e.target === e.currentTarget) onClose?.();
    downOnBackdrop.current = false;
  };

  return createPortal(
    <div
      className={cx(styles.overlay, sheetOnMobile && styles.sheetOverlay, layout === 'fullscreen' && styles.fullscreenOverlay, overlayClassName)}
      onMouseDown={onBackdropDown}
      onClick={onBackdropClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : (label || undefined)}
        aria-labelledby={labelledBy || undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx(
          layout === 'fullscreen' ? styles.fullscreen : styles.panel,
          layout === 'sections' && styles.sections,
          layout !== 'fullscreen' && styles[size],
          sheetOnMobile && styles.sheet,
          className,
        )}
      >
        {brackets && layout !== 'fullscreen' && <CornerBrackets size={brackets === 'sm' ? 'sm' : undefined} />}
        {children}
      </div>
    </div>,
    document.body,
  );
}
