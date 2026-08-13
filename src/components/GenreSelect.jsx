// GenreSelect.jsx — searchable genre picker.
//
// WHY NOT A NATIVE <select>
//
// The taxonomy went from 15 seeds to 136 entries. A native select with 136
// options is not a styling problem that CSS can reach: the browser renders the
// popup as an OS-level list and positions it so the CURRENTLY SELECTED option
// sits over the trigger. With "all" selected (index 0) and 136 options below
// it, the list is taller than the viewport, so Chrome pins it to the top of
// the window and it reads as a panel that has come unmoored from the control
// that opened it. That is the reported bug. Nothing in _forms.scss can move it,
// because none of it is in the page.
//
// It is also, at 136 entries, simply unusable — scrolling an unsorted-looking
// alphabetical list to find "Chicano & Latinx Fiction" is worse than typing
// three letters.
//
// Modelled deliberately on CategoryAutocomplete: same open/blur handling, same
// arrow/enter/escape keys, same `onMouseDown` + `preventDefault` on rows so the
// input does not blur before the click registers. Differences are that the
// options are a fixed local list rather than a debounced RPC, and that this one
// selects rather than creates.

import { useEffect, useMemo, useRef, useState } from 'react';

const MAX_VISIBLE = 60; // enough to browse, few enough to keep the DOM cheap

export default function GenreSelect({
  value,             // normalized genre key, or 'all'
  onChange,          // (norm: string) => void
  options,           // [{ norm, name }]
  allLabel,          // label for the 'all' row
  placeholder = 'Search genres…',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selectedName = useMemo(() => {
    if (value === 'all') return allLabel;
    return options.find((o) => o.norm === value)?.name || allLabel;
  }, [value, options, allLabel]);

  // 'all' is always offered and always first, so clearing the filter never
  // requires finding a row by name.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = { norm: 'all', name: allLabel };
    if (!q) return [all, ...options].slice(0, MAX_VISIBLE + 1);
    const matched = options.filter((o) => o.name.toLowerCase().includes(q));
    // Rank prefix matches above mid-string ones: typing "hor" should surface
    // "Horror" before "Cosmic Horror", which is what a reader expects even
    // though both are honest matches.
    matched.sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
    return matched.slice(0, MAX_VISIBLE);
  }, [query, options, allLabel]);

  useEffect(() => { setHighlightIdx(0); }, [query]);

  useEffect(() => {
    function onDocMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) close();
    }
    if (open) {
      document.addEventListener('mousedown', onDocMouseDown);
      return () => document.removeEventListener('mousedown', onDocMouseDown);
    }
  }, [open]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlightIdx];
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, open]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function pick(norm) {
    onChange(norm);
    close();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (rows.length) setHighlightIdx((i) => (i + 1) % rows.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) setHighlightIdx((i) => (i - 1 + rows.length) % rows.length);
      return;
    }
    if (e.key === 'Enter') {
      if (!open) { e.preventDefault(); setOpen(true); return; }
      const row = rows[highlightIdx];
      if (row) { e.preventDefault(); pick(row.norm); }
    }
  }

  return (
    <div className="genre-select" ref={containerRef}>
      {!open ? (
        <button
          type="button"
          className="select genre-select__trigger"
          disabled={disabled}
          onClick={() => {
            setOpen(true);
            // Focus after paint: the input does not exist until `open` renders.
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="genre-select__value">
            {value === 'all' ? selectedName : `☩ ${selectedName}`}
          </span>
        </button>
      ) : (
        <input
          ref={inputRef}
          type="text"
          className="select genre-select__input"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="genre-select-list"
        />
      )}

      {open && (
        <div className="genre-select__dropdown" id="genre-select-list" role="listbox" ref={listRef}>
          {rows.length === 0 && (
            <div className="genre-select__empty">No genre matches “{query.trim()}”.</div>
          )}
          {rows.map((r, i) => (
            <div
              key={r.norm}
              role="option"
              aria-selected={r.norm === value}
              className={
                'genre-select__row' +
                (i === highlightIdx ? ' is-highlighted' : '') +
                (r.norm === value ? ' is-selected' : '')
              }
              onMouseEnter={() => setHighlightIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(r.norm); }}
            >
              {r.norm === 'all' ? r.name : `☩ ${r.name}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
