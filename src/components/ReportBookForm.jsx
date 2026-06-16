// ReportBookForm.jsx — v0.20
// Self-contained inline report form for BookModal and BookPage.
// Supabase insert is done directly here to avoid a separate import
// that could silently break if reportService.js isn't deployed yet.

import { useState, useEffect, useRef } from 'react';
import { useData } from '../lib/DataContext';
import { supabase } from '../lib/supabase';

const REPORT_FIELDS = [
  { key: 'title',       labelEn: 'Title',       labelEs: 'Título' },
  { key: 'description', labelEn: 'Description', labelEs: 'Descripción' },
  { key: 'series',      labelEn: 'Series',      labelEs: 'Saga' },
  { key: 'genres',      labelEn: 'Genres',      labelEs: 'Géneros' },
];

export default function ReportBookForm({ book, isSpanish }) {
  const { showToast } = useData();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef(null);

  // Scroll form into view and focus it when opened
  useEffect(() => {
    if (open && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      formRef.current.focus();
    }
  }, [open]);

  function toggleField(key) {
    setFields((prev) =>
      prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]
    );
  }

  async function handleSubmit() {
    if (fields.length === 0) {
      showToast(
        isSpanish ? 'Seleccioná al menos un campo' : 'Select at least one field',
        true
      );
      return;
    }
    if (!book?.bookId) {
      showToast(
        isSpanish
          ? 'Agregá el libro a tu colección primero'
          : 'Add the book to your collection first',
        true
      );
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('book_reports').insert({
      book_id: book.bookId,
      fields,
      comment: comment.trim() || null,
      status: 'open',
    });
    setSubmitting(false);
    if (error) {
      console.error('submitBookReport failed', error);
      showToast(
        isSpanish ? 'No se pudo enviar. Intentá de nuevo.' : 'Could not submit. Please try again.',
        true
      );
      return;
    }
    showToast(isSpanish ? 'Gracias, lo revisaremos pronto' : "Thanks — we'll review this soon");
    setOpen(false);
    setFields([]);
    setComment('');
  }

  function handleCancel() {
    setOpen(false);
    setFields([]);
    setComment('');
  }

  return (
    <div className="report-book">
      {!open ? (
        <button
          className="report-book-trigger"
          onClick={() => setOpen(true)}
          aria-expanded="false"
        >
          ⚑ {isSpanish ? 'Reportar un error' : 'Report an issue'}
        </button>
      ) : (
        <div className="report-book-form" ref={formRef} tabIndex={-1}>
          <div className="report-book-form-title">
            {isSpanish ? '¿Qué está incorrecto?' : "What's incorrect?"}
          </div>
          <div className="report-book-fields">
            {REPORT_FIELDS.map(({ key, labelEn, labelEs }) => (
              <label key={key} className="report-book-field">
                <input
                  type="checkbox"
                  checked={fields.includes(key)}
                  onChange={() => toggleField(key)}
                />
                <span>{isSpanish ? labelEs : labelEn}</span>
              </label>
            ))}
          </div>
          <textarea
            className="report-book-comment"
            placeholder={isSpanish ? 'Comentario (opcional)…' : 'Comment (optional)…'}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
          <div className="report-book-actions">
            <button className="btn btn-ghost" onClick={handleCancel} disabled={submitting}>
              {isSpanish ? 'Cancelar' : 'Cancel'}
            </button>
            <button
              className="btn"
              onClick={handleSubmit}
              disabled={submitting || fields.length === 0}
            >
              {submitting
                ? (isSpanish ? 'Enviando…' : 'Sending…')
                : (isSpanish ? 'Enviar reporte' : 'Submit report')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
