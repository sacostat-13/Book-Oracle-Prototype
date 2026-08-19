// ProgressUpdateModal.jsx — v0.37.3
// v0.44: Reading Memory capture + recall (docs/reading-memory-v1-spec.md)

import { useEffect, useState } from 'react';
import { useT } from '../lib/I18nContext';
import { useData } from '../lib/DataContext';
import { EDITION_LANGUAGES, EDITION_FORMATS, effectivePages, normalizeLanguage } from '../lib/editions';
import { cleanIsbn, isValidIsbn } from '../lib/isbn';
import { googleBooksLookupByIsbn } from '../lib/googleBooksService';
import CornerBrackets from './CornerBrackets';
import CoachMark from './CoachMark';

export default function ProgressUpdateModal({ book, onSave, onClose }) {
  const t = useT();
  const { memoriesForBook, addReadingMemory, dismissCoachmark, state, saveReaderEdition } = useData();
  const catalogPages = book?.pp || null;
  const initialPages = book?.pagesRead ?? 0;

  // v0.65 — the edition the reader has already recorded, if any. Falls back to
  // the legacy currently_reading override so a reader who set a page count
  // before this shipped sees their own number, not the catalog's.
  const edition = state?.editionsByBookId?.[book?.bookId] || null;
  const initialOverride = edition?.page_count ?? book?.userPageCount ?? null;

  const [pages, setPages] = useState(String(initialPages || ''));
  const [showOverride, setShowOverride] = useState(!!initialOverride || !!edition);
  const [overridePages, setOverridePages] = useState(initialOverride ? String(initialOverride) : '');
  const [saving, setSaving] = useState(false);

  // v0.65 — the rest of the edition. This control used to capture ONLY a page
  // count, which is the number a reader notices but not the thing that explains
  // it: they typed 512 because they are reading a different book-object, and
  // the app had nowhere to say so. Same disclosure, same one-click expansion,
  // three more optional fields.
  const [edLang, setEdLang] = useState(edition?.language || '');
  const [edIsbn, setEdIsbn] = useState(edition?.isbn || '');
  const [edTitle, setEdTitle] = useState(edition?.edition_title || '');
  const [edFormat, setEdFormat] = useState(edition?.format || '');
  const [edTranslator, setEdTranslator] = useState(edition?.translator || '');
  const [isbnLooking, setIsbnLooking] = useState(false);
  const [isbnNote, setIsbnNote] = useState(null);

  // v0.44: optional memory capture — collapsed by default; the newest
  // existing memory is recalled read-only at the top of the modal.
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryText, setMemoryText] = useState('');
  const lastMemory = memoriesForBook(book)[0] || null;

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !saving) onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  // Type thirteen digits, get the rest filled in.
  //
  // This is the whole reason to ask for an ISBN at all: a translation's ISBN is
  // the one fact a reader can read off the back of the book without thinking,
  // and it implies the language, the page count and the title. Asking them to
  // type those separately would be asking them to do a lookup we can do.
  //
  // Never overwrites something already filled in — a reader who typed their
  // page count and then pasted an ISBN meant the page count.
  async function lookUpIsbn() {
    const clean = cleanIsbn(edIsbn);
    if (!clean || !isValidIsbn(clean)) { setIsbnNote(t('progress.editionIsbnInvalid')); return; }
    setIsbnLooking(true);
    setIsbnNote(null);
    try {
      const hit = await googleBooksLookupByIsbn(clean);
      if (!hit) { setIsbnNote(t('progress.editionIsbnNotFound')); return; }
      if (hit.lang && !edLang) setEdLang(normalizeLanguage(hit.lang) || '');
      if (hit.pp && !overridePages) setOverridePages(String(hit.pp));
      if (hit.t && !edTitle && hit.t.trim() !== (book?.t || '').trim()) setEdTitle(hit.t);
      setIsbnNote(t('progress.editionIsbnFound'));
    } catch {
      setIsbnNote(t('progress.editionIsbnNotFound'));
    } finally {
      setIsbnLooking(false);
    }
  }

  const overrideNum = parseInt(overridePages, 10);
  const validOverride = !isNaN(overrideNum) && overrideNum > 0;
  // An audiobook has no page count and never will, so the progress bar must not
  // render rather than render a fiction. effectivePages() encodes the same
  // precedence used everywhere else; this is the one place that also has an
  // unsaved edit to respect.
  const totalPages = edFormat === 'audio'
    ? null
    : (showOverride && validOverride && overridePages !== '')
      ? overrideNum
      : effectivePages(book, edition);

  const pagesNum = parseInt(pages, 10);
  const validPages = !isNaN(pagesNum) && pagesNum >= 0;
  const cappedPages = validPages && totalPages ? Math.min(pagesNum, totalPages) : pagesNum;
  const pct = totalPages && validPages ? Math.min(100, Math.round((cappedPages / totalPages) * 100)) : null;

  const canSave = validPages && (!showOverride || overridePages === '' || validOverride);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    // null clears the override and falls back to the catalog page count
    const userPageCount = showOverride && overridePages !== '' && validOverride ? overrideNum : null;
    try {
      await onSave?.(cappedPages, userPageCount);
      // v0.65: the edition saves alongside the progress — one button, one
      // action, same rule the memory capture below follows. A failed edition
      // write must never undo a successful progress save, so it is caught here
      // rather than allowed to reject the whole handler.
      try {
        await saveReaderEdition?.(book, {
          language: normalizeLanguage(edLang),
          isbn: cleanIsbn(edIsbn),
          edition_title: edTitle.trim() || null,
          translator: edTranslator.trim() || null,
          page_count: userPageCount,
          format: edFormat || null,
          source: edition?.source || 'manual',
        });
      } catch (err) {
        console.warn('reader edition save failed', err);
      }
      // v0.44: memory saves with the progress — one action, never blocking.
      // A failed memory write must not undo a successful progress save.
      if (memoryText.trim()) {
        try {
          await addReadingMemory(book, memoryText, { pagesAt: cappedPages, pctAt: pct, kind: 'progress' });
        } catch (err) {
          console.warn('reading memory save failed', err);
        }
      }
    } finally { setSaving(false); }
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

        {lastMemory && (
          <div className="memory-recall">
            <div className="memory-recall__meta">
              {t('memory.lastTime')}
              {lastMemory.pagesAt != null && <> · {t('memory.pageAt', { page: lastMemory.pagesAt })}</>}
              {' · '}
              {new Date(lastMemory.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </div>
            <div className="memory-recall__body">{lastMemory.body}</div>
          </div>
        )}

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

        {!showOverride ? (
          <button type="button" className="btn-text btn--sm" onClick={() => setShowOverride(true)}>
            {t('progress.editionDifferLink')}
          </button>
        ) : (
          <div className="pu-edition">
            {/* ISBN first: it is the one field a reader can copy off the back
                cover without deciding anything, and filling it fills the rest. */}
            <label className="field-label" htmlFor="pu-ed-isbn">
              {t('progress.editionIsbnLabel')}
            </label>
            <div className="pu-edition__isbn">
              <input
                id="pu-ed-isbn"
                type="text"
                inputMode="numeric"
                value={edIsbn}
                onChange={(e) => { setEdIsbn(e.target.value); setIsbnNote(null); }}
                placeholder="978…"
                className="input pf-input--narrow"
              />
              <button
                type="button"
                className="btn-tertiary btn--sm"
                onClick={lookUpIsbn}
                disabled={isbnLooking || !edIsbn.trim()}
              >
                {isbnLooking ? t('progress.editionIsbnLooking') : t('progress.editionIsbnLookup')}
              </button>
            </div>
            {isbnNote && <div className="pu-progress-label">{isbnNote}</div>}

            <label className="field-label" htmlFor="pu-ed-lang">
              {t('progress.editionLanguageLabel')}
            </label>
            <select
              id="pu-ed-lang"
              className="input pf-input--narrow"
              value={edLang}
              onChange={(e) => setEdLang(e.target.value)}
            >
              <option value="">{t('progress.editionLanguageUnset')}</option>
              {EDITION_LANGUAGES.map((code) => (
                <option key={code} value={code}>{t(`language.${code}`)}</option>
              ))}
            </select>

            <label className="field-label" htmlFor="pu-ed-pages">
              {t('progress.editionPagesLabel')}
            </label>
            <input
              id="pu-ed-pages"
              type="number" min="1"
              value={overridePages}
              onChange={(e) => setOverridePages(e.target.value)}
              placeholder={catalogPages ? String(catalogPages) : ''}
              className="input pf-input--narrow"
              disabled={edFormat === 'audio'}
            />
            <div className="pu-progress-label">
              {edFormat === 'audio'
                ? t('progress.editionAudioNote')
                : t('progress.editionOverrideNote')}
            </div>

            <label className="field-label" htmlFor="pu-ed-format">
              {t('progress.editionFormatLabel')}
            </label>
            <select
              id="pu-ed-format"
              className="input pf-input--narrow"
              value={edFormat}
              onChange={(e) => setEdFormat(e.target.value)}
            >
              <option value="">{t('progress.editionFormatUnset')}</option>
              {EDITION_FORMATS.map((f) => (
                <option key={f} value={f}>{t(`progress.editionFormat_${f}`)}</option>
              ))}
            </select>

            <label className="field-label" htmlFor="pu-ed-title">
              {t('progress.editionTitleLabel')}
            </label>
            <input
              id="pu-ed-title"
              type="text"
              value={edTitle}
              onChange={(e) => setEdTitle(e.target.value)}
              placeholder={book?.t || ''}
              className="input"
            />

            <label className="field-label" htmlFor="pu-ed-translator">
              {t('progress.editionTranslatorLabel')}
            </label>
            <input
              id="pu-ed-translator"
              type="text"
              value={edTranslator}
              onChange={(e) => setEdTranslator(e.target.value)}
              className="input"
            />

            <button
              type="button"
              className="btn-text btn--sm"
              onClick={() => {
                // Clears the whole edition, not just the page count. Leaving
                // the language and ISBN behind while dropping the number they
                // explain would store a claim the reader just retracted.
                setShowOverride(false);
                setOverridePages('');
                setEdLang(''); setEdIsbn(''); setEdTitle('');
                setEdFormat(''); setEdTranslator(''); setIsbnNote(null);
              }}
            >
              {t('progress.editionUseDefault')}
            </button>
          </div>
        )}

        {totalPages ? (
          <div>
            <div className="db-ai__track">
              <div className="db-ai__fill" style={{ '--ai-pct': `${validPages ? Math.min(100, (cappedPages / totalPages) * 100) : 0}%` }} />
            </div>
          </div>
        ) : null}

        {!memoryOpen ? (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button type="button" className="btn-text btn--sm" onClick={() => { dismissCoachmark('memory-note'); setMemoryOpen(true); }}>
              ✎ {t('memory.captureLink')}
            </button>
            {/* v0.46: one-time hint — Reading Memory is easy to overlook */}
            <CoachMark
              id="memory-note"
              placement="top"
              title={t('coachmark.memoryTitle')}
              body={t('coachmark.memoryBody')}
            />
          </div>
        ) : (
          <div className="memory-capture">
            <label className="field-label">
              {t('memory.captureLabel')}
              <span className="club-form__optional">{t('memory.captureOptional')}</span>
            </label>
            <textarea
              className="textarea"
              rows={3}
              maxLength={2000}
              placeholder={t('memory.capturePlaceholder')}
              value={memoryText}
              onChange={(e) => setMemoryText(e.target.value)}
            />
          </div>
        )}

        <div className="pu-actions">
          <button type="button" className="btn-tertiary" onClick={onClose} disabled={saving}>
            {t('progress.cancel')}
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || !canSave}>
            {saving ? t('progress.saving') : pct === 100 ? t('progress.saveFinished') : t('progress.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
