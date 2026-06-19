// Modal for updating reading progress on a currently-reading book.
//
// Shows the book title, a numeric page input, and an optional visual progress
// bar when the book has a known page total (books.pages). When page total is
// unknown the bar is hidden and only the raw count is captured.
//
// Props:
//   book       — currently-reading book object (must have .t, .a, .pp optional)
//   onSave(pagesRead)  — called with the new page count (integer)
//   onClose()          — called when the modal is dismissed without saving
import { useEffect, useState } from 'react';

export default function ProgressUpdateModal({ book, onSave, onClose }) {
  const totalPages = book?.pp || null;
  const initialPages = book?.pagesRead ?? 0;
  const [pages, setPages] = useState(String(initialPages || ''));
  const [saving, setSaving] = useState(false);

  // Close on Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !saving) onClose?.();
    }
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
    try {
      await onSave?.(cappedPages);
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle = {
    background: 'rgba(176, 140, 63, 0.04)',
    border: '1px solid rgba(176, 140, 63, 0.25)',
    borderRadius: '2px',
    padding: '0.55rem 0.8rem',
    color: 'var(--paper)',
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: '1.1rem',
    width: '120px',
    colorScheme: 'dark',
  };

  const labelStyle = {
    display: 'block',
    fontFamily: "'Special Elite', monospace",
    fontSize: '0.7rem',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: 'var(--gilt)',
    marginBottom: '0.4rem',
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose?.();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10, 8, 6, 0.78)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        style={{
          background: 'var(--ink, #1a1410)',
          border: '1px solid rgba(176, 140, 63, 0.35)',
          borderRadius: '4px',
          maxWidth: '420px',
          width: '100%',
          padding: '2rem 2.2rem',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            fontFamily: "'Special Elite', monospace",
            fontSize: '0.75rem',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--gilt)',
            marginBottom: '0.5rem',
          }}
        >
          Progress
        </div>

        {/* Title */}
        <h2
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontStyle: 'italic',
            fontSize: '1.6rem',
            color: 'var(--paper)',
            margin: 0,
            marginBottom: '0.35rem',
          }}
        >
          Update your progress
        </h2>
        <p
          style={{
            color: 'var(--paper-aged)',
            fontSize: '0.9rem',
            marginBottom: '1.5rem',
            lineHeight: 1.5,
          }}
        >
          {book.t}
          {book.a ? <span style={{ opacity: 0.6 }}> · {book.a}</span> : null}
        </p>

        {/* Page input */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={labelStyle}>
            Pages read
            {totalPages ? (
              <span style={{ opacity: 0.5, textTransform: 'none', letterSpacing: 0, marginLeft: '0.4rem' }}>
                (out of {totalPages})
              </span>
            ) : null}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <input
              type="number"
              min="0"
              max={totalPages || undefined}
              value={pages}
              onChange={(e) => setPages(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="0"
              autoFocus
              style={fieldStyle}
            />
            {totalPages && validPages ? (
              <span
                style={{
                  fontFamily: "'Special Elite', monospace",
                  fontSize: '0.85rem',
                  color: pct === 100 ? 'var(--gilt-bright, #e8c560)' : 'var(--paper-aged)',
                  letterSpacing: '0.05em',
                }}
              >
                {pct}%
              </span>
            ) : null}
          </div>
        </div>

        {/* Progress bar (only when page total is known) */}
        {totalPages ? (
          <div style={{ marginBottom: '1.5rem' }}>
            <div
              style={{
                height: '4px',
                background: 'rgba(176, 140, 63, 0.15)',
                borderRadius: '2px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${validPages ? Math.min(100, (cappedPages / totalPages) * 100) : 0}%`,
                  background: 'var(--gilt, #b08c3f)',
                  borderRadius: '2px',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
            {totalPages && (
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--paper-aged)',
                  opacity: 0.55,
                  marginTop: '0.3rem',
                  fontFamily: "'Special Elite', monospace",
                  letterSpacing: '0.05em',
                }}
              >
                Page count from our catalog — your edition may differ
              </div>
            )}
          </div>
        ) : null}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleSave}
            disabled={saving || !validPages}
          >
            {saving ? 'Saving…' : pct === 100 ? 'Save — finished! ❦' : 'Save progress ❦'}
          </button>
        </div>
      </div>
    </div>
  );
}
