// RatingModal.jsx — v0.31

import { useEffect, useState } from 'react';
import { useT } from '../lib/I18nContext';

const STARS = [1, 2, 3, 4, 5];
const NOTES_MAX = 4000;

export default function RatingModal({ book, initialRating, initialNotes, initialReadAt, mode = 'create', onSave, onSkip }) {
  const t = useT();
  const [rating, setRating] = useState(initialRating || 0);
  const [hover, setHover] = useState(0);
  const [notes, setNotes] = useState(initialNotes || '');
  const [saving, setSaving] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [readAt, setReadAt] = useState(initialReadAt ? initialReadAt.slice(0, 10) : todayStr);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !saving) onSkip?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSkip, saving]);

  async function handleSave() {
    setSaving(true);
    try { await onSave?.({ rating: rating > 0 ? rating : null, notes: notes.trim() || null, readAt: readAt || null }); }
    finally { setSaving(false); }
  }

  const isCreate = mode === 'create';
  const titleText = isCreate ? t('rating.titleCreate') : t('rating.titleEdit');
  const subText = isCreate ? t('rating.subCreate', { title: book.t }) : null;
  const cancelLabel = isCreate ? t('rating.cancelCreate') : t('rating.cancelEdit');
  const saveLabel = isCreate
    ? (rating > 0 || notes.trim() ? t('rating.saveCreate') : t('rating.saveNoRating'))
    : t('rating.saveEdit');
  const displayedStars = hover || rating;

  const eyebrowText = isCreate ? t('rating.eyebrowOptional') : t('rating.eyebrowEdit');

  return (
    <div
      className="rating-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onSkip?.(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10, 8, 6, 0.78)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div className="rating-modal" style={{ background: 'var(--ink, #1a1410)', border: '1px solid rgba(176, 140, 63, 0.35)', borderRadius: '4px', maxWidth: '480px', width: '100%', padding: '2rem 2.2rem', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)' }}>
        <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.75rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.5rem' }}>
          {eyebrowText}
        </div>
        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1.7rem', color: 'var(--paper)', margin: 0, marginBottom: subText ? '0.6rem' : '1.2rem' }}>
          {titleText}
        </h2>
        {subText && (
          <p style={{ color: 'var(--paper-aged)', lineHeight: 1.55, marginBottom: '1.2rem', fontSize: '0.95rem' }}>
            {subText}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center', marginBottom: '0.6rem' }} onMouseLeave={() => setHover(0)}>
          {STARS.map((n) => (
            <button
              key={n} type="button"
              onClick={() => setRating(rating === n ? 0 : n)}
              onMouseEnter={() => setHover(n)}
              aria-label={rating === 5 ? t('rating.starFavorite', { n }) : t('rating.starOf5', { n })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '2.2rem', lineHeight: 1, padding: '0.2rem 0.35rem', color: n <= displayedStars ? 'var(--gilt-bright, #e8c560)' : 'rgba(176, 140, 63, 0.25)', transition: 'color 0.12s ease, transform 0.12s ease', transform: n === hover ? 'scale(1.08)' : 'scale(1)' }}
            >
              ★
            </button>
          ))}
        </div>
        <div style={{ textAlign: 'center', fontFamily: "'Special Elite', monospace", fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--paper-aged)', opacity: 0.7, marginBottom: '1.5rem', minHeight: '1em' }}>
          {rating > 0
            ? (rating === 5 ? t('rating.starFavorite', { n: rating }) : t('rating.starOf5', { n: rating }))
            : t('rating.tapStar')}
        </div>

        <div className="field field-full" style={{ marginBottom: '1.2rem' }}>
          <label style={{ display: 'block', fontFamily: "'Special Elite', monospace", fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.4rem' }}>
            {t('rating.notesLabel')} <span style={{ opacity: 0.5, textTransform: 'none', letterSpacing: 0 }}>{t('rating.notesPrivate')}</span>
          </label>
          <textarea
            placeholder={t('rating.notesPlaceholder')}
            value={notes} onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
            rows={4}
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(176, 140, 63, 0.04)', border: '1px solid rgba(176, 140, 63, 0.25)', borderRadius: '2px', padding: '0.7rem 0.85rem', color: 'var(--paper)', fontFamily: "'Cormorant Garamond', serif", fontSize: '1rem', lineHeight: 1.55, resize: 'vertical', minHeight: '90px' }}
          />
          {notes.length > NOTES_MAX * 0.85 && (
            <div style={{ fontSize: '0.75rem', color: notes.length >= NOTES_MAX ? 'var(--blood-bright)' : 'var(--paper-aged)', opacity: 0.7, textAlign: 'right', marginTop: '0.25rem' }}>
              {notes.length} / {NOTES_MAX}
            </div>
          )}
        </div>

        <div className="field field-full" style={{ marginBottom: '1.2rem' }}>
          <label style={{ display: 'block', fontFamily: "'Special Elite', monospace", fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.4rem' }}>
            {t('rating.finishedOn')}
          </label>
          <input
            type="date" value={readAt} max={todayStr}
            onChange={(e) => setReadAt(e.target.value)}
            style={{ background: 'rgba(176, 140, 63, 0.04)', border: '1px solid rgba(176, 140, 63, 0.25)', borderRadius: '2px', padding: '0.5rem 0.75rem', color: 'var(--paper)', fontFamily: "'EB Garamond', serif", fontSize: '0.95rem', colorScheme: 'dark' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={onSkip} disabled={saving}>
            {cancelLabel}
          </button>
          <button type="button" className="btn" onClick={handleSave} disabled={saving}>
            {saving ? t('rating.saving') : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
