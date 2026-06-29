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
      className="rating-modal-overlay"
    >
      <div className="rating-modal">
        <div className="rating-modal__eyebrow">
          {eyebrowText}
        </div>
        <h2 className="rating-modal__title">
          {titleText}
        </h2>
        {subText && (
          <p className="rating-modal__sub">
            {subText}
          </p>
        )}

        <div className="rating-modal__stars" onMouseLeave={() => setHover(0)}>
          {STARS.map((n) => (
            <button
              key={n} type="button"
              onClick={() => setRating(rating === n ? 0 : n)}
              onMouseEnter={() => setHover(n)}
              aria-label={rating === 5 ? t('rating.starFavorite', { n }) : t('rating.starOf5', { n })}
              className={`rating-modal__star${n <= displayedStars ? ' rating-modal__star--active' : ' rating-modal__star--ro-dim'}${n === hover ? ' rating-modal__star--hover' : ''}`}
            >
              ★
            </button>
          ))}
        </div>
        <div className="rating-modal__hint">
          {rating > 0
            ? (rating === 5 ? t('rating.starFavorite', { n: rating }) : t('rating.starOf5', { n: rating }))
            : t('rating.tapStar')}
        </div>

        <div className="field field-full">
          <label className="rating-modal__notes-label">
            {t('rating.notesLabel')} <span className="rating-modal__notes-private">{t('rating.notesPrivate')}</span>
          </label>
          <textarea
            placeholder={t('rating.notesPlaceholder')}
            value={notes} onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
            rows={4}
            className="textarea"
          />
          {notes.length > NOTES_MAX * 0.85 && (
            <div className={`lv-item-note t-right${notes.length >= NOTES_MAX ? " t-error" : ""}`}>
              {notes.length} / {NOTES_MAX}
            </div>
          )}
        </div>

        <div className="field field-full">
          <label className="rating-modal__notes-label">
            {t('rating.finishedOn')}
          </label>
          <input
            type="date" value={readAt} max={todayStr}
            onChange={(e) => setReadAt(e.target.value)}
            className="input"
          />
        </div>

        <div className="modal__actions">
          <button type="button" className="btn-tertiary" onClick={onSkip} disabled={saving}>
            {cancelLabel}
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? t('rating.saving') : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
