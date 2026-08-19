// ProgressUpdateModal.jsx — v0.37.3
// v0.44: Reading Memory capture + recall (docs/reading-memory-v1-spec.md)
// v0.65: reader editions (docs/reader-editions-v1-spec.md)
// v0.65.1: audiobooks (docs/audiobook-progress-v1-spec.md)
//
// FORMAT DECIDES THE FORM.
//
// The v0.65 layout asked for a page count first and the edition afterwards, as
// an afterthought behind a disclosure link. That ordering was wrong in a way
// that only became visible once audiobooks existed: it asks "how many pages?"
// before it knows whether this book has pages at all, and an audiobook listener
// got a disabled page field, a note apologising for it, and nowhere to record
// what they had actually done.
//
// The form now establishes WHAT THE COPY IS before asking HOW FAR IN you are:
//
//   ISBN → Format → Title → Language          (every format, in this order)
//     ├── print / ebook: Pages read · Pages in your edition · Translator
//     └── audio:         Listened · Total length · Narrator
//
// ISBN stays first because it is the one field a reader can copy off the back
// cover without deciding anything, and filling it fills several of the others.
// Format is second because it is the switch — everything below it changes shape.
//
// The two branches are not cosmetic variants of one control. An audiobook is
// measured in time, and this file never converts between time and pages; see
// src/lib/editions.js and the spec for why that conversion would be a
// fabrication rather than a convenience.

import { useEffect, useState } from 'react';
import { useT } from '../lib/I18nContext';
import { useData } from '../lib/DataContext';
import {
  EDITION_LANGUAGES, EDITION_FORMATS, effectivePages, normalizeLanguage,
  toMinutes, splitMinutes,
} from '../lib/editions';
import { cleanIsbn, isValidIsbn } from '../lib/isbn';
import { googleBooksLookupByIsbn } from '../lib/googleBooksService';
import CornerBrackets from './CornerBrackets';
import CoachMark from './CoachMark';

export default function ProgressUpdateModal({ book, onSave, onClose }) {
  const t = useT();
  const {
    memoriesForBook, addReadingMemory, dismissCoachmark, state,
    saveReaderEdition, updateListeningProgress,
  } = useData();
  const catalogPages = book?.pp || null;
  const initialPages = book?.pagesRead ?? 0;

  const edition = state?.editionsByBookId?.[book?.bookId] || null;
  const initialOverride = edition?.page_count ?? book?.userPageCount ?? null;

  const [pages, setPages] = useState(String(initialPages || ''));
  const [overridePages, setOverridePages] = useState(initialOverride ? String(initialOverride) : '');
  const [saving, setSaving] = useState(false);

  const [edLang, setEdLang] = useState(edition?.language || '');
  const [edIsbn, setEdIsbn] = useState(edition?.isbn || '');
  const [edTitle, setEdTitle] = useState(edition?.edition_title || '');
  const [edFormat, setEdFormat] = useState(edition?.format || '');
  const [edTranslator, setEdTranslator] = useState(edition?.translator || '');
  const [edNarrator, setEdNarrator] = useState(edition?.narrator || '');
  const [isbnLooking, setIsbnLooking] = useState(false);
  const [isbnNote, setIsbnNote] = useState(null);

  // Hours and minutes as two fields, because that is how a listening app shows
  // a position and how a publisher prints a length. The column stores minutes;
  // toMinutes/splitMinutes in editions.js are the whole translation.
  const initialDuration = splitMinutes(edition?.duration_minutes);
  const initialListened = splitMinutes(book?.progressMinutes);
  const [durH, setDurH] = useState(initialDuration.hours);
  const [durM, setDurM] = useState(initialDuration.minutes);
  const [lisH, setLisH] = useState(initialListened.hours);
  const [lisM, setLisM] = useState(initialListened.minutes);

  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryText, setMemoryText] = useState('');
  const lastMemory = memoriesForBook(book)[0] || null;

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !saving) onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  // An unset format behaves as print. It is what the overwhelming majority of
  // rows are, and defaulting the SELECT to 'print' instead would write a claim
  // the reader never made onto every edition they touch.
  const isAudio = edFormat === 'audio';

  async function lookUpIsbn() {
    const clean = cleanIsbn(edIsbn);
    if (!clean || !isValidIsbn(clean)) { setIsbnNote(t('progress.editionIsbnInvalid')); return; }
    setIsbnLooking(true);
    setIsbnNote(null);
    try {
      const hit = await googleBooksLookupByIsbn(clean);
      if (!hit) { setIsbnNote(t('progress.editionIsbnNotFound')); return; }
      if (hit.lang && !edLang) setEdLang(normalizeLanguage(hit.lang) || '');
      // Never onto an audio edition: Google's page count is the print
      // edition's, and writing it here would give an audiobook a page count,
      // which is the one thing this release exists to stop happening.
      if (hit.pp && !overridePages && !isAudio) setOverridePages(String(hit.pp));
      if (hit.t && !edTitle && hit.t.trim() !== (book?.t || '').trim()) setEdTitle(hit.t);
      setIsbnNote(t('progress.editionIsbnFound'));
    } catch {
      setIsbnNote(t('progress.editionIsbnNotFound'));
    } finally {
      setIsbnLooking(false);
    }
  }

  // ── Print / ebook ──────────────────────────────────────────────────────────
  const overrideNum = parseInt(overridePages, 10);
  const validOverride = !isNaN(overrideNum) && overrideNum > 0;
  const totalPages = isAudio
    ? null
    : (validOverride && overridePages !== '')
      ? overrideNum
      : effectivePages(book, edition);

  const pagesNum = parseInt(pages, 10);
  const validPages = !isNaN(pagesNum) && pagesNum >= 0;
  const cappedPages = validPages && totalPages ? Math.min(pagesNum, totalPages) : pagesNum;

  // ── Audio ──────────────────────────────────────────────────────────────────
  const durationMinutes = toMinutes(durH, durM);
  const listenedRaw = toMinutes(lisH, lisM);
  const listenedMinutes = listenedRaw && durationMinutes
    ? Math.min(listenedRaw, durationMinutes)
    : listenedRaw;

  // One percentage, whichever unit the reader is in. `null` means "cannot be
  // known" — a total nobody has given us — and every consumer of it below
  // renders nothing rather than zero.
  const pct = isAudio
    ? (durationMinutes && listenedMinutes ? Math.min(100, Math.round((listenedMinutes / durationMinutes) * 100)) : null)
    : (totalPages && validPages ? Math.min(100, Math.round((cappedPages / totalPages) * 100)) : null);

  const canSave = isAudio
    ? true                                        // a listener with no total is still making progress
    : (validPages && (overridePages === '' || validOverride));

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    const userPageCount = !isAudio && overridePages !== '' && validOverride ? overrideNum : null;
    try {
      if (isAudio) {
        // pages_read is passed through UNCHANGED, and the page override is left
        // alone (undefined, not null). A reader who read 76 pages of the
        // paperback and then switched to the audiobook has not un-read them,
        // and clearing the override would destroy a number they would need
        // again the moment they switched back.
        await onSave?.(initialPages, undefined);
        await updateListeningProgress?.(book, listenedMinutes);
      } else {
        await onSave?.(cappedPages, userPageCount);
      }

      try {
        await saveReaderEdition?.(book, {
          language: normalizeLanguage(edLang),
          isbn: cleanIsbn(edIsbn),
          edition_title: edTitle.trim() || null,
          translator: isAudio ? (edition?.translator ?? null) : (edTranslator.trim() || null),
          narrator: isAudio ? (edNarrator.trim() || null) : (edition?.narrator ?? null),
          // Keep the other unit's numbers rather than nulling them. The form
          // only shows one branch at a time; a hidden field is not a retracted
          // one, and switching format twice must not be lossy.
          page_count: isAudio ? (edition?.page_count ?? null) : userPageCount,
          duration_minutes: isAudio ? durationMinutes : (edition?.duration_minutes ?? null),
          format: edFormat || null,
          source: edition?.source || 'manual',
        });
      } catch (err) {
        console.warn('reader edition save failed', err);
      }

      if (memoryText.trim()) {
        try {
          await addReadingMemory(book, memoryText, {
            pagesAt: isAudio ? null : cappedPages,
            pctAt: pct,
            kind: 'progress',
          });
        } catch (err) {
          console.warn('reading memory save failed', err);
        }
      }
    } finally { setSaving(false); }
  }

  function clearEdition() {
    setOverridePages('');
    setEdLang(''); setEdIsbn(''); setEdTitle('');
    setEdFormat(''); setEdTranslator(''); setEdNarrator('');
    setDurH(''); setDurM(''); setIsbnNote(null);
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.(); }}
      className="rating-modal-overlay"
    >
      <div className="rating-modal pu-modal">
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

        <div className="pu-form">
          {/* ── What the copy is ──────────────────────────────────────────── */}

          <div className="pu-field">
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
                className="input"
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
            {isbnNote && <div className="pu-note">{isbnNote}</div>}
          </div>

          {/* The switch. Everything below this changes shape with it. */}
          <div className="pu-field">
            <label className="field-label" htmlFor="pu-ed-format">
              {t('progress.editionFormatLabel')}
            </label>
            <select
              id="pu-ed-format"
              className="input"
              value={edFormat}
              onChange={(e) => setEdFormat(e.target.value)}
            >
              <option value="">{t('progress.editionFormatUnset')}</option>
              {EDITION_FORMATS.map((f) => (
                <option key={f} value={f}>{t(`progress.editionFormat_${f}`)}</option>
              ))}
            </select>
          </div>

          <div className="pu-field">
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
          </div>

          <div className="pu-field">
            <label className="field-label" htmlFor="pu-ed-lang">
              {t('progress.editionLanguageLabel')}
            </label>
            <select
              id="pu-ed-lang"
              className="input"
              value={edLang}
              onChange={(e) => setEdLang(e.target.value)}
            >
              <option value="">{t('progress.editionLanguageUnset')}</option>
              {EDITION_LANGUAGES.map((code) => (
                <option key={code} value={code}>{t(`language.${code}`)}</option>
              ))}
            </select>
          </div>

          {/* ── How far in ────────────────────────────────────────────────── */}

          {isAudio ? (
            <>
              <div className="pu-field">
                <label className="field-label" htmlFor="pu-lis-h">
                  {t('progress.listenedLabel')}
                  {pct != null && (
                    <span className="club-form__optional">{pct}%</span>
                  )}
                </label>
                <div className="pu-hm">
                  <input
                    id="pu-lis-h" type="number" min="0" className="input"
                    value={lisH} onChange={(e) => setLisH(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    placeholder="0" autoFocus
                  />
                  <span className="pu-hm__unit">{t('progress.hoursShort')}</span>
                  <input
                    type="number" min="0" className="input"
                    value={lisM} onChange={(e) => setLisM(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    placeholder="00"
                  />
                  <span className="pu-hm__unit">{t('progress.minutesShort')}</span>
                </div>
              </div>

              <div className="pu-field">
                <label className="field-label" htmlFor="pu-dur-h">
                  {t('progress.editionDurationLabel')}
                </label>
                <div className="pu-hm">
                  <input
                    id="pu-dur-h" type="number" min="0" className="input"
                    value={durH} onChange={(e) => setDurH(e.target.value)}
                    placeholder="0"
                  />
                  <span className="pu-hm__unit">{t('progress.hoursShort')}</span>
                  <input
                    type="number" min="0" className="input"
                    value={durM} onChange={(e) => setDurM(e.target.value)}
                    placeholder="00"
                  />
                  <span className="pu-hm__unit">{t('progress.minutesShort')}</span>
                </div>
                {/* Optional on purpose: the hours-listened total works without
                    it, and only the progress bar needs it. Saying so stops the
                    field reading as a requirement the reader cannot meet. */}
                <div className="pu-note">{t('progress.editionDurationNote')}</div>
              </div>

              <div className="pu-field">
                <label className="field-label" htmlFor="pu-ed-narrator">
                  {t('progress.editionNarratorLabel')}
                </label>
                <input
                  id="pu-ed-narrator"
                  type="text"
                  value={edNarrator}
                  onChange={(e) => setEdNarrator(e.target.value)}
                  className="input"
                />
              </div>
            </>
          ) : (
            <>
              <div className="pu-field">
                <label className="field-label" htmlFor="pu-pages">
                  {t('progress.pagesLabel')}
                  {totalPages && (
                    <span className="club-form__optional">
                      {t('progress.pagesOf', { total: totalPages })}
                    </span>
                  )}
                </label>
                <div className="pu-input-row">
                  <input
                    id="pu-pages"
                    type="number" min="0" max={totalPages || undefined}
                    value={pages} onChange={(e) => setPages(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    placeholder="0" autoFocus className="input"
                  />
                  {pct != null ? <span className="pu-progress-label">{pct}%</span> : null}
                </div>
              </div>

              <div className="pu-field">
                <label className="field-label" htmlFor="pu-ed-pages">
                  {t('progress.editionPagesLabel')}
                </label>
                <input
                  id="pu-ed-pages"
                  type="number" min="1"
                  value={overridePages}
                  onChange={(e) => setOverridePages(e.target.value)}
                  placeholder={catalogPages ? String(catalogPages) : ''}
                  className="input"
                />
                <div className="pu-note">{t('progress.editionOverrideNote')}</div>
              </div>

              <div className="pu-field">
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
              </div>
            </>
          )}

          {/* One bar, either unit. Absent when the fraction cannot be known —
              which is now also the honest answer for a print book with no page
              count, where this used to render stuck at zero. */}
          {pct != null ? (
            <div className="db-ai__track">
              <div className="db-ai__fill" style={{ '--ai-pct': `${pct}%` }} />
            </div>
          ) : null}

          <button type="button" className="btn-text btn--sm pu-form__reset" onClick={clearEdition}>
            {t('progress.editionUseDefault')}
          </button>
        </div>

        {!memoryOpen ? (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button type="button" className="btn-text btn--sm" onClick={() => { dismissCoachmark('memory-note'); setMemoryOpen(true); }}>
              ✎ {t('memory.captureLink')}
            </button>
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
