// src/hooks/useClickOutside.js — close a dropdown/popover on an outside press.
//
// Replaces the two identical copies that lived in Nav.jsx and LandingFooter.jsx.
// Listens on `mousedown` (not `click`) so a press that starts outside closes the
// layer even if the pointer is released inside another control.

import { useEffect, useRef } from 'react';

/**
 * Call `onOutside` when the pointer goes down outside `ref.current`.
 *
 * @param {{ current: Element | null }} ref  the element that counts as "inside"
 * @param {(e: MouseEvent) => void} onOutside
 * @param {boolean} [enabled=true]  skip listening while the layer is closed
 */
export function useClickOutside(ref, onOutside, enabled = true) {
  const cb = useRef(onOutside);
  cb.current = onOutside;

  useEffect(() => {
    if (!enabled) return undefined;
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) cb.current?.(e);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, enabled]);
}
