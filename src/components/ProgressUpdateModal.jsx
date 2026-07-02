// ProgressUpdateModal.jsx — v0.31

import { useEffect, useState } from 'react';
import { useT } from '../lib/I18nContext';
import CornerBrackets from './CornerBrackets';

export default function ProgressUpdateModal({ book, onSave, onClose }) {
  const t = useT();
  const totalPages = book?.pp || null;
  const initialPages = book?.pagesRead ?? 0;
  const [pages, setPages] = useState(String(initialPages || ''));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !saving) onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const pagesNum = parseInt(pages, 10);
  const validPages = !isNaN(pagesNum) && pagesNum >= 0;
  const cappedPages = validPages && totalPages ? Math.min(pagesNum, totalPages) : pagesNum;
  const pct = totalPages && validPages ? Math.min(100, Math.round((cappedPages / totalPages) * 100)) : null;

  async function handleSave() {
    if (!validPages) return;
    setSaving(true);
    try { await onSave?.(cappedPages); } finally { setSaving(false); }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.(); }}
      className="rating-modal-overlay"
    >
      <div className="rating-modal">
        <CornerBrackets size="sm" />
        <div className="rating-modal__eyebrow">
          {t('progress.eyebrow')}
        </div>
        <h2 className="plan-step-title plan-step-title--tight">
          {t('progress.title')}
        </h2>
        <p className="pu-book-sub">
          {book.t}
          {book.a ? <span className="pu-book-author"> · {book.a}</span> : null}
        </p>

        <div>
          <label className="field-label">
            {t('progress.pagesLabel')}
            {totalPages && (
              <span className="club-form__optional">
                {t('progress.pagesOf', { total: totalPages })}
              </span>
            )}
          </label>
          <div className="pu-input-row">
            <input
              type="number" min="0" max={totalPages || undefined}
              value={pages} onChange={(e) => setPages(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="0" autoFocus className="input pf-input--narrow"
            />
            {totalPages && validPages ? (
              <span className="pu-progress-label">
                {pct}%
              </span>
            ) : null}
          </div>
        </div>

        {totalPages ? (
          <div>
            <div className="db-ai__track">
              <div className="db-ai__fill" style={{ '--ai-pct': `${validPages ? Math.min(100, (cappedPages / totalPages) * 100) : 0}%` }} />
            </div>
            <div className="pu-progress-label">
              {t('progress.editionNote')}
            </div>
          </div>
        ) : null}

        <div className="pu-actions">
          <button type="button" className="btn-tertiary" onClick={onClose} disabled={saving}>
            {t('progress.cancel')}
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || !validPages}>
            {saving ? t('progress.saving') : pct === 100 ? t('progress.saveFinished') : t('progress.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
