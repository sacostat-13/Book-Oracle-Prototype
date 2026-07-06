// src/components/AddToListPicker.jsx — v0.27
// Single-book "Add to list" button that opens AddToListModal.

import { useState } from 'react';
import { useT } from '../lib/I18nContext';
import AddToListModal from './AddToListModal';

// v0.40: accepts an optional className so callers can demote/promote this
// button's visual weight (e.g. BookPage's "Want to read" state now renders
// it as a tertiary action) without forking the component.
export default function AddToListPicker({ book, className = 'btn-secondary' }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  if (!book) return null;

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        {t('addToListPicker.btn')}
      </button>
      {open && <AddToListModal books={[book]} onClose={() => setOpen(false)} />}
    </>
  );
}
