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
      style={{ position: 'fixed', inset: 0, background: 'rgba(10, 8, 6, 0.78)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div style={{ background: 'var(--ink, #1a1410)', border: '1px solid rgba(176, 140, 63, 0.35)', borderRadius: 'var(--ro-radius-sm)', maxWidth: '420px', width: '100%', padding: '2rem 2.2rem', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)' }}>
        <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.75rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.5rem' }}>
          {t('progress.eyebrow')}
        </div>
        <h2 style={{ fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', fontSize: '1.6rem', color: 'var(--paper)', margin: 0, marginBottom: '0.35rem' }}>
          {t('progress.title')}
        </h2>
        <p style={{ color: 'var(--paper-aged)', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
          {book.t}
          {book.a ? <span style={{ opacity: 0.6 }}> · {book.a}</span> : null}
        </p>

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={labelStyle}>
            {t('progress.pagesLabel')}
            {totalPages && (
              <span style={{ opacity: 0.5, textTransform: 'none', letterSpacing: 0, marginLeft: '0.4rem' }}>
                {t('progress.pagesOf', { total: totalPages })}
              </span>
            )}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <input
              type="number" min="0" max={totalPages || undefined}
              value={pages} onChange={(e) => setPages(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="0" autoFocus style={fieldStyle}
            />
            {totalPages && validPages ? (
              <span style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.85rem', color: pct === 100 ? 'var(--gilt-bright, #e8c560)' : 'var(--paper-aged)', letterSpacing: '0.05em' }}>
                {pct}%
              </span>
            ) : null}
          </div>
        </div>

        {totalPages ? (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ height: '4px', background: 'rgba(176, 140, 63, 0.15)', borderRadius: 'var(--ro-radius-sm)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${validPages ? Math.min(100, (cappedPages / totalPages) * 100) : 0}%`, background: 'var(--gilt, #b08c3f)', borderRadius: 'var(--ro-radius-sm)', transition: 'width 0.2s ease' }} />
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--paper-aged)', opacity: 0.55, marginTop: '0.3rem', fontFamily: 'var(--ro-font-mono)', letterSpacing: '0.05em' }}>
              {t('progress.editionNote')}
            </div>
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            {t('progress.cancel')}
          </button>
          <button type="button" className="btn" onClick={handleSave} disabled={saving || !validPages}>
            {saving ? t('progress.saving') : pct === 100 ? t('progress.saveFinished') : t('progress.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
