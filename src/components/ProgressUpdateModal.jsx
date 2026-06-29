// ProgressUpdateModal.jsx — v0.31

import { useEffect, useState } from 'react';
import { useT } from '../lib/I18nContext';

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

  const fieldStyle = {
    background: 'rgba(176, 140, 63, 0.04)', border: '1px solid rgba(176, 140, 63, 0.25)',
    borderRadius: 'var(--ro-radius-sm)', padding: '0.55rem 0.8rem', color: 'var(--paper)',
    fontFamily: 'var(--ro-font-display)', fontSize: '1.1rem', width: '120px', colorScheme: 'dark',
  };
  const labelStyle = {
    display: 'block', fontFamily: 'var(--ro-font-mono)', fontSize: '0.7rem',
    letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.4rem',
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.(); }}
      className="rating-modal-overlay"
    >
      <div className="rating-modal">
        <div className="rating-modal__eyebrow">
          {t('progress.eyebrow')}
        </div>
        <h2 className="plan-step-title" style={{ marginBottom: "0.35rem" }}>
          {t('progress.title')}
        </h2>
        <p className="pu-book-sub">
          {book.t}
          {book.a ? <span className="pu-book-author"> · {book.a}</span> : null}
        </p>

        <div >
          <label style={labelStyle}>
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
              placeholder="0" autoFocus style={fieldStyle}
            />
            {totalPages && validPages ? (
              <span className="pu-progress-label">
                {pct}%
              </span>
            ) : null}
          </div>
        </div>

        {totalPages ? (
          <div >
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
