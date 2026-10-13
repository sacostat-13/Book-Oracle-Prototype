// src/hooks/useEscape.js — close the topmost layer on Escape.
//
// Modals, dropdowns and popovers each used to add their own window keydown
// listener, so with two layers open (a confirm dialog over a modal) one
// Escape closed both. Layers registered here form a stack: only the most
// recently opened, still-enabled layer receives the key.

import { useEffect, useRef } from 'react';

const stack = [];

function onKeyDown(e) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  for (let i = stack.length - 1; i >= 0; i--) {
    const layer = stack[i];
    if (!layer.enabled) continue;
    e.preventDefault();
    layer.handler.current?.(e);
    return;
  }
}

/**
 * Call `handler` when Escape is pressed and this is the topmost active layer.
 *
 * @param {(e: KeyboardEvent) => void} handler
 * @param {boolean} [enabled=true]  pass false while the layer must not close
 *        (e.g. a save in flight); it then neither reacts nor blocks layers below
 */
export function useEscape(handler, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const layerRef = useRef(null);

  // Register once per mount so stacking order = opening order.
  useEffect(() => {
    const layer = { handler: handlerRef, enabled };
    layerRef.current = layer;
    stack.push(layer);
    if (stack.length === 1) window.addEventListener('keydown', onKeyDown);
    return () => {
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) window.removeEventListener('keydown', onKeyDown);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (layerRef.current) layerRef.current.enabled = enabled;
  }, [enabled]);
}
