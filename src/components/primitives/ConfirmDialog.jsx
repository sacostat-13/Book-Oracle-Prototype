// src/components/primitives/ConfirmDialog.jsx — styled, translated confirmations.
//
// Replaces window.confirm(), which rendered an unstyled browser box (in the
// browser's language, not the reader's) and blocked the page. Mounted once by
// <ConfirmProvider> in main.jsx; any component asks with:
//
//   const confirm = useConfirm();
//   if (!(await confirm({ message: t('plans.deleteConfirm'), confirmLabel: t('common.delete'), danger: true }))) return;
//
// or the short form `await confirm(t('polls.confirmDeletePoll'))`.

import { createContext, useCallback, useContext, useId, useRef, useState } from 'react';
import Modal from './Modal';
import { useT } from '../../contexts/I18nContext';

const ConfirmContext = createContext(null);

/**
 * @typedef {object} ConfirmOptions
 * @property {string} message           the question, in the reader's language
 * @property {string} [title]           optional heading above the message
 * @property {string} [confirmLabel]    default: common.confirm
 * @property {string} [cancelLabel]     default: common.cancel
 * @property {boolean} [danger=false]   style the confirm button as destructive
 */

/** Provides useConfirm() to everything below it. Render once, near the root. */
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const pending = useRef(null);

  const confirm = useCallback((opts) => {
    const options = typeof opts === 'string' ? { message: opts } : (opts || {});
    // A second request while one is open answers the first with "no".
    pending.current?.(false);
    return new Promise((resolve) => {
      pending.current = resolve;
      setRequest(options);
    });
  }, []);

  const answer = useCallback((value) => {
    pending.current?.(value);
    pending.current = null;
    setRequest(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && <ConfirmDialog {...request} onAnswer={answer} />}
    </ConfirmContext.Provider>
  );
}

/**
 * Ask the reader to confirm something.
 *
 * @returns {(opts: ConfirmOptions | string) => Promise<boolean>}
 *   resolves true on confirm; false on cancel, Escape or a backdrop press.
 *   Outside a ConfirmProvider (e.g. an isolated test) it falls back to window.confirm.
 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  return ctx || ((opts) => Promise.resolve(window.confirm(typeof opts === 'string' ? opts : opts?.message)));
}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger = false, onAnswer }) {
  const t = useT();
  const headingId = useId();
  return (
    <Modal onClose={() => onAnswer(false)} labelledBy={headingId} size="sm" brackets="sm">
      {title ? (
        <>
          <h2 className="rating-modal__title" id={headingId}>{title}</h2>
          <p className="rating-modal__sub">{message}</p>
        </>
      ) : (
        <h2 className="rating-modal__sub" id={headingId}>{message}</h2>
      )}
      <div className="modal__actions">
        <button type="button" className="btn-tertiary" onClick={() => onAnswer(false)}>
          {cancelLabel || t('common.cancel')}
        </button>
        <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={() => onAnswer(true)}>
          {confirmLabel || t('common.confirm')}
        </button>
      </div>
    </Modal>
  );
}
