// src/components/AddToListPicker.jsx — v0.27
// Single-book "Add to list" button that opens AddToListModal.

import { useState } from 'react';
import { useT } from '../lib/I18nContext';
import AddToListModal from './AddToListModal';

export default function AddToListPicker({ book }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  if (!book) return null;

  return (
    <>
      <button className="btn btn-secondary" onClick={() => setOpen(true)}>
        {t('addToListPicker.btn')}
      </button>
      {open && <AddToListModal books={[book]} onClose={() => setOpen(false)} />}
    </>
  );
}
