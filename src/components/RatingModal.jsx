// Modal for capturing a quick rating + notes on a book.
//
// Used in two flows:
//   1. After "Mark as Read" — to immediately rate (skippable)
//   2. From Library — to edit existing rating/notes
//
// The modal is always dismissable without rating. Skipping is a first-class
// path: many readers mark books as read but don't want to commit to a number.
// Notes are optional, capped at 4000 chars (matches the DB constraint).
import { useEffect, useState } from 'react';

const STARS = [1, 2, 3, 4, 5];
const NOTES_MAX = 4000;

// Props:
//   book        — { t, a, ... } the book being rated. Required.
//   initialRating — current rating (1-5) or null/undefined
//   initialNotes  — current notes string or null/undefined
//   mode        — 'create' (after mark-as-read) | 'edit' (from library)
//   onSave({ rating, notes })   — called with the new values (rating can be null)
//   onSkip()    — called when user skips/closes without saving. In 'create'
//                 mode this means "added to library without a rating". In
//                 'edit' mode this just dismisses without changes.
export default function RatingModal({
  book,
  initialRating,
  initialNotes,
  mode = 'create',
  onSave,
  onSkip,
}) {
  const [rating, setRating] = useState(initialRating || 0);
  const [hover, setHover] = useState(0);
  const [notes, setNotes] = useState(initialNotes || '');
  const [saving, setSaving] = useState(false);

  // Close on Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !saving) onSkip?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSkip, saving]);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave?.({
        rating: rating > 0 ? rating : null,
        notes: notes.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }

  const isCreate = mode === 'create';
  const titleText = isCreate
    ? 'Rate this book?'
    : 'Edit your rating';
  const subText = isCreate
    ? `"${book.t}" is now in your library. Want to capture how it landed?`
    : null;
  const cancelLabel = isCreate ? 'Skip — just add it' : 'Cancel';
  const saveLabel = isCreate
    ? rating > 0 || notes.trim()
      ? 'Save & add ❦'
      : 'Add to library ❦'
    : 'Save changes ❦';

  const displayedStars = hover || rating;

  return (
    <div
      className="rating-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onSkip?.();
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
        className="rating-modal"
        style={{
          background: 'var(--ink, #1a1410)',
          border: '1px solid rgba(176, 140, 63, 0.35)',
          borderRadius: '4px',
          maxWidth: '480px',
          width: '100%',
          padding: '2rem 2.2rem',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)',
        }}
      >
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
          {isCreate ? 'Optional' : 'Your rating'}
        </div>
        <h2
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontStyle: 'italic',
            fontSize: '1.7rem',
            color: 'var(--paper)',
            margin: 0,
            marginBottom: subText ? '0.6rem' : '1.2rem',
          }}
        >
          {titleText}
        </h2>
        {subText && (
          <p
            style={{
              color: 'var(--paper-aged)',
              lineHeight: 1.55,
              marginBottom: '1.2rem',
              fontSize: '0.95rem',
            }}
          >
            {subText}
          </p>
        )}

        {/* Stars */}
        <div
          style={{
            display: 'flex',
            gap: '0.3rem',
            justifyContent: 'center',
            marginBottom: '0.6rem',
          }}
          onMouseLeave={() => setHover(0)}
        >
          {STARS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(rating === n ? 0 : n)}
              onMouseEnter={() => setHover(n)}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '2.2rem',
                lineHeight: 1,
                padding: '0.2rem 0.35rem',
                color: n <= displayedStars ? 'var(--gilt-bright, #e8c560)' : 'rgba(176, 140, 63, 0.25)',
                transition: 'color 0.12s ease, transform 0.12s ease',
                transform: n === hover ? 'scale(1.08)' : 'scale(1)',
              }}
            >
              ★
            </button>
          ))}
        </div>
        <div
          style={{
            textAlign: 'center',
            fontFamily: "'Special Elite', monospace",
            fontSize: '0.7rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--paper-aged)',
            opacity: 0.7,
            marginBottom: '1.5rem',
            minHeight: '1em',
          }}
        >
          {rating > 0
            ? `${rating} of 5${rating === 5 ? ' · a favorite' : ''}`
            : 'Tap a star — or skip'}
        </div>

        {/* Notes */}
        <div className="field field-full" style={{ marginBottom: '1.2rem' }}>
          <label
            style={{
              display: 'block',
              fontFamily: "'Special Elite', monospace",
              fontSize: '0.7rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--gilt)',
              marginBottom: '0.4rem',
            }}
          >
            Notes <span style={{ opacity: 0.5, textTransform: 'none', letterSpacing: 0 }}>(private to you)</span>
          </label>
          <textarea
            placeholder="What did you think? Anything you want to remember…"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
            rows={4}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'rgba(176, 140, 63, 0.04)',
              border: '1px solid rgba(176, 140, 63, 0.25)',
              borderRadius: '2px',
              padding: '0.7rem 0.85rem',
              color: 'var(--paper)',
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: '1rem',
              lineHeight: 1.55,
              resize: 'vertical',
              minHeight: '90px',
            }}
          />
          {notes.length > NOTES_MAX * 0.85 && (
            <div
              style={{
                fontSize: '0.75rem',
                color: notes.length >= NOTES_MAX ? 'var(--blood-bright)' : 'var(--paper-aged)',
                opacity: 0.7,
                textAlign: 'right',
                marginTop: '0.25rem',
              }}
            >
              {notes.length} / {NOTES_MAX}
            </div>
          )}
        </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onSkip}
            disabled={saving}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
