// src/components/AddToListPicker.jsx — v0.27
// Single-book "Add to list" button that opens AddToListModal.

import { useState } from 'react';
import { useI18n } from '../lib/I18nContext';
import AddToListModal from './AddToListModal';

export default function AddToListPicker({ book }) {
  const { lang } = useI18n();
  const isSpanish = lang === 'es';
  const [open, setOpen] = useState(false);

  if (!book) return null;

  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        ❦ {isSpanish ? 'Agregar a lista' : 'Add to list'}
      </button>
      {open && <AddToListModal books={[book]} onClose={() => setOpen(false)} />}
    </>
  );
}
