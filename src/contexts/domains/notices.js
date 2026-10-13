// src/contexts/domains/notices.js — the toast and the share-moment modal.
//
// Both are transient UI state that any action can raise; rendered globally by
// <Toast/> and <ShareMomentModal/>. Never persisted.

import { useCallback, useState } from 'react';
import { rowToMoment } from '../../lib/achievements/accomplishments';

/**
 * Called once by DataProvider; returns toast, showToast, shareMoment, setShareMoment, showShareMoment, dismissShareMoment, shareAccomplishment.
 * Takes no arguments.
 */
export function useNotices() {
  const [toast, setToast] = useState(null);
  const [shareMoment, setShareMoment] = useState(null); // v0.43: pending action-share moment

  // ---------- Toast helper ----------
  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError, id: Math.random() });
    setTimeout(() => setToast(null), 2800);
  }, []);

  // ---------- Share moments (v0.43) ----------
  // The pending action-share moment, rendered globally by <ShareMomentModal/>.
  // State-only, never persisted: a moment exists exactly between the action
  // that produced it and the user sharing/dismissing the modal.
  const showShareMoment = useCallback((moment) => {
    if (moment) setShareMoment(moment);
  }, []);
  const dismissShareMoment = useCallback(() => setShareMoment(null), []);

  // v0.45: re-open the share card for an already-earned accomplishment from the
  // Ledger. Reconstructs the moment from the stored row — no library lookup.
  const shareAccomplishment = useCallback((entry) => {
    if (entry) setShareMoment(rowToMoment(entry));
  }, []);

  return { toast, showToast, shareMoment, setShareMoment, showShareMoment, dismissShareMoment, shareAccomplishment };
}
