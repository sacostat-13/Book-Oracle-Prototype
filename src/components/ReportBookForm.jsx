// ReportBookForm.jsx — v0.31

import { useState, useEffect, useRef } from 'react';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import { supabase } from '../lib/supabase';

export default function ReportBookForm({ book }) {
  const { showToast } = useData();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef(null);

  const REPORT_FIELDS = [
    { key: 'title',       label: t('report.fieldTitle') },
    { key: 'description', label: t('report.fieldDescription') },
    { key: 'series',      label: t('report.fieldSeries') },
    { key: 'genres',      label: t('report.fieldGenres') },
  ];

  useEffect(() => {
    if (open && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      formRef.current.focus();
    }
  }, [open]);

  function toggleField(key) {
    setFields((prev) => prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]);
  }

  async function handleSubmit() {
    if (fields.length === 0) { showToast(t('report.errorNoField'), true); return; }
    if (!book?.bookId) { showToast(t('report.errorNoBook'), true); return; }
    setSubmitting(true);
    const { error } = await supabase.from('book_reports').insert({
      book_id: book.bookId, fields, comment: comment.trim() || null, status: 'open',
    });
    setSubmitting(false);
    if (error) {
      console.error('submitBookReport failed', error);
      showToast(t('report.errorSubmit'), true);
      return;
    }
    showToast(t('report.successToast'));
    setOpen(false); setFields([]); setComment('');
  }

  function handleCancel() { setOpen(false); setFields([]); setComment(''); }

  return (
    <div className="report-book">
      {!open ? (
        <button className="report-book-trigger" onClick={() => setOpen(true)} aria-expanded="false">
          {t('report.trigger')}
        </button>
      ) : (
        <div className="report-book-form" ref={formRef} tabIndex={-1}>
          <div className="report-book-form-title">{t('report.formTitle')}</div>
          <div className="report-book-fields">
            {REPORT_FIELDS.map(({ key, label }) => (
              <label key={key} className="report-book-field">
                <input type="checkbox" checked={fields.includes(key)} onChange={() => toggleField(key)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <textarea
            className="report-book-comment"
            placeholder={t('report.commentPlaceholder')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
          <div className="report-book-actions">
            <button className="btn btn-ghost" onClick={handleCancel} disabled={submitting}>
              {t('report.cancel')}
            </button>
            <button className="btn" onClick={handleSubmit} disabled={submitting || fields.length === 0}>
              {submitting ? t('report.submitting') : t('report.submit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
