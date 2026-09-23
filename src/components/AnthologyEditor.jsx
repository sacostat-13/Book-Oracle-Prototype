// src/components/AnthologyEditor.jsx — v0.71.1
//
// Edit an Anthology you own: title, description, and (Pro) a custom cover.
// Opened from ListDetail's "Edit" button. Tags keep their own editor there —
// they only apply to public Anthologies, and this panel applies to all.
//
// Save writes title and description together; the cover is written the moment
// it is uploaded or removed, because an uploaded file with no row pointing at
// it is an orphan, and making the reader press Save to avoid that is a trap.

import { useRef, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import { useProLimits } from '../lib/proGates';
import { uploadAnthologyCover, deleteAnthologyCoverFile, CoverError } from '../lib/anthologyCover';
import ProGate from './ProGate';

const TITLE_MAX = 120;
const DESC_MAX = 600;

export default function AnthologyEditor({ list, onClose }) {
  const t = useT();
  const { updateList, showToast } = useData();
  const { isPro } = useProLimits();
  const fileRef = useRef(null);

  const [title, setTitle] = useState(list.title || '');
  const [description, setDescription] = useState(list.description || '');
  const [saving, setSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);

  const cover = list.cover_image_url || null;
  const dirty = title.trim() !== (list.title || '') || description.trim() !== (list.description || '');

  async function save() {
    if (!title.trim() || saving) return;
    setSaving(true);
    const res = await updateList(list.id, { title: title.trim(), description: description.trim() || null });
    setSaving(false);
    if (res?.error) { showToast?.(t('anthologyEditor.saveError'), true); return; }
    onClose?.();
  }

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCoverBusy(true);
    try {
      const url = await uploadAnthologyCover(list.id, file);
      const previous = cover;
      const res = await updateList(list.id, { cover_image_url: url });
      if (res?.error) {
        deleteAnthologyCoverFile(url); // the row refused it; do not leave the file behind
        throw new CoverError(/pro_required/.test(res.error.message || '') ? 'pro_required' : 'upload_failed');
      }
      if (previous) deleteAnthologyCoverFile(previous);
    } catch (err) {
      const code = err instanceof CoverError ? err.code : 'upload_failed';
      showToast?.(t(`anthologyEditor.coverError.${code}`), true);
    } finally {
      setCoverBusy(false);
    }
  }

  async function removeCover() {
    if (!cover) return;
    setCoverBusy(true);
    const res = await updateList(list.id, { cover_image_url: null });
    if (!res?.error) deleteAnthologyCoverFile(cover);
    setCoverBusy(false);
  }

  return (
    <section className="anth-editor" aria-label={t('anthologyEditor.title')}>
      <div className="anth-editor__fields">
        <label className="field-label" htmlFor="anth-title">{t('anthologyEditor.fieldTitle')}</label>
        <input
          id="anth-title"
          className="input"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
        />

        <label className="field-label" htmlFor="anth-desc">{t('anthologyEditor.fieldDescription')}</label>
        <textarea
          id="anth-desc"
          className="textarea"
          rows={3}
          value={description}
          maxLength={DESC_MAX}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="anth-editor__cover">
        <div className="field-label">{t('anthologyEditor.fieldCover')}</div>
        {cover && <img className="anth-editor__cover-img" src={cover} alt="" />}

        {isPro ? (
          <div className="anth-editor__cover-actions">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
            <button type="button" className="btn-secondary btn--sm" disabled={coverBusy} onClick={() => fileRef.current?.click()}>
              {coverBusy ? t('anthologyEditor.coverUploading') : cover ? t('anthologyEditor.coverReplace') : t('anthologyEditor.coverUpload')}
            </button>
            {cover && (
              <button type="button" className="btn-text btn--sm" disabled={coverBusy} onClick={removeCover}>
                {t('anthologyEditor.coverRemove')}
              </button>
            )}
            <p className="db-ai__note">{t('anthologyEditor.coverHint')}</p>
          </div>
        ) : cover ? (
          // Set while Pro, kept after a downgrade. It can still be removed.
          <div className="anth-editor__cover-actions">
            <button type="button" className="btn-text btn--sm" disabled={coverBusy} onClick={removeCover}>
              {t('anthologyEditor.coverRemove')}
            </button>
            <ProGate feature="cover" compact />
          </div>
        ) : (
          <ProGate feature="cover" compact />
        )}
      </div>

      <div className="anth-editor__actions">
        <button type="button" className="btn-tertiary" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn-primary" disabled={!title.trim() || !dirty || saving} onClick={save}>
          {saving ? '…' : t('anthologyEditor.save')}
        </button>
      </div>
    </section>
  );
}
