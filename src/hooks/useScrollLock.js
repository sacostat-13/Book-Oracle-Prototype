// src/hooks/useScrollLock.js — stop the page scrolling behind an open overlay.
//
// Counted, so two stacked modals don't fight: the first lock saves the body's
// overflow, the last unlock restores it. (Before, each modal set and cleared
// `overflow` itself, so closing an inner modal unlocked the page behind the
// outer one.)

import { useEffect } from 'react';

let locks = 0;
let saved = '';

/** Lock `document.body` scrolling while `active` is true. */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    if (locks === 0) {
      saved = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = saved;
    };
  }, [active]);
}
