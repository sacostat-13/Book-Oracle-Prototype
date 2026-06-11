import { useEffect, useRef, useState, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useI18n } from '../lib/I18nContext';

// Autocomplete-with-create input for category tagging.
//
// Behavior:
//   - User types → debounced (~180ms) call to searchCategories
//   - Dropdown shows up to 8 candidates, ranked verified-first then by usage
//   - "Create new: <query>" affordance pinned at bottom IF no exact-match
//     candidate exists AND the trimmed query is non-empty
//   - Arrow keys + Enter for keyboard nav (Tab also commits the highlighted
//     option to be hospitable to keyboard users)
//   - Esc closes the dropdown without committing
//   - Clicking outside closes the dropdown
//   - After commit (existing or new), input clears and stays focused for
//     the next category — users typically add several at once
//
// Props:
//   book          — the book to tag. Required (uses bookId).
//   existingIds   — Set of category IDs already on this book; these are
//                   filtered out of the dropdown so users don't see options
//                   they've already added.
//   onAdd(name)   — optional callback after a successful add. Called with
//                   the canonical name returned by the server.
//   onCapHit()    — optional callback when the soft-cap of 10 is reached.
//                   Component itself shows the inline message; this is for
//                   a parent that wants to react too (e.g. hide the input).
//   disabled      — boolean, disables the input
//   placeholder   — override the default placeholder text

const DEBOUNCE_MS = 180;

export default function CategoryAutocomplete({
  book,
  existingIds,
  onAdd,
  onCapHit,
  disabled = false,
  placeholder,
}) {
  const { searchCategories, addCategoryToBook } = useData();
  const { lang } = useI18n();
  const isSpanish = lang === 'es';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);

  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);
  // Used to drop stale responses if the user kept typing
  const queryIdRef = useRef(0);

  const atCap = (existingIds?.size || 0) >= 10;

  // --------- Search effect: debounce + race-safe ---------
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!open || atCap) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const thisQueryId = ++queryIdRef.current;
      const rows = await searchCategories(query, 8);
      // If a newer query has started, drop this result
      if (thisQueryId !== queryIdRef.current) return;
      // Filter out categories already on this book
      const filtered = (existingIds && existingIds.size > 0)
        ? rows.filter((r) => !existingIds.has(r.id))
        : rows;
      setResults(filtered);
      setHighlightIdx(0);
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, atCap, searchCategories, existingIds]);

  // --------- Click outside to close ---------
  useEffect(() => {
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      return () => document.removeEventListener('mousedown', onDocClick);
    }
  }, [open]);

  // --------- Commit logic ---------
  const commit = useCallback(
    async (nameToAdd) => {
      const trimmed = (nameToAdd || '').trim();
      if (!trimmed) return;
      if (atCap) {
        onCapHit?.();
        return;
      }
      setCommitting(true);
      const ok = await addCategoryToBook(book, trimmed);
      setCommitting(false);
      if (ok) {
        onAdd?.(trimmed);
        setQuery('');
        setResults([]);
        setHighlightIdx(0);
        // Keep focus for the next add
        inputRef.current?.focus();
      } else {
        // addCategoryToBook surfaces its own toast on failure. If the cap
        // was hit, signal the parent.
        if ((existingIds?.size || 0) + 1 >= 10) onCapHit?.();
      }
    },
    [book, addCategoryToBook, atCap, onAdd, onCapHit, existingIds]
  );

  // --------- "Create new" affordance visibility ---------
  // Show when:
  //   - query has non-whitespace content
  //   - no result row is an exact match for the query
  //   - we're not currently loading (avoid flicker between requests)
  const trimmedQuery = query.trim();
  const hasExactMatch = results.some((r) => r.exactMatch);
  const showCreateNew =
    trimmedQuery.length > 0 && !hasExactMatch && !atCap;

  // Total visible row count for keyboard navigation
  const totalRows = results.length + (showCreateNew ? 1 : 0);

  // --------- Keyboard navigation ---------
  function onKeyDown(e) {
    if (atCap) return;
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      if (totalRows > 0) {
        setHighlightIdx((i) => (i + 1) % totalRows);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalRows > 0) {
        setHighlightIdx((i) => (i - 1 + totalRows) % totalRows);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      // Tab commits if the dropdown is open AND there's a highlighted row;
      // otherwise let Tab move focus normally.
      if (!open || totalRows === 0) {
        // No dropdown rows but query has text → commit-as-new (typed-then-Enter)
        if (e.key === 'Enter' && trimmedQuery.length > 0) {
          e.preventDefault();
          commit(trimmedQuery);
        }
        return;
      }
      // For Tab, only intercept if the user has actively highlighted something
      // (the create-new is highlightIdx === results.length when present)
      const isCreateRowHighlighted =
        showCreateNew && highlightIdx === results.length;
      const highlighted = !isCreateRowHighlighted ? results[highlightIdx] : null;

      if (highlighted) {
        e.preventDefault();
        commit(highlighted.name);
      } else if (isCreateRowHighlighted || (e.key === 'Enter' && trimmedQuery)) {
        e.preventDefault();
        commit(trimmedQuery);
      }
      return;
    }
  }

  function onFocus() {
    if (!atCap) setOpen(true);
  }

  // --------- Render ---------
  const placeholderText =
    placeholder ||
    (isSpanish ? 'Agregar categoría…' : 'Add a category…');

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-block', width: '100%', maxWidth: '320px' }}
    >
      <input
        ref={inputRef}
        type="text"
        className="search-input"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={atCap
          ? (isSpanish ? 'Máximo 10 categorías por libro' : 'Max 10 categories per book')
          : placeholderText}
        disabled={disabled || atCap || committing}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontSize: '0.9rem',
          padding: '0.5rem 0.75rem',
          opacity: atCap ? 0.5 : 1,
        }}
      />
      {open && !atCap && (
        <Dropdown
          loading={loading}
          results={results}
          showCreateNew={showCreateNew}
          createNewLabel={trimmedQuery}
          highlightIdx={highlightIdx}
          onPick={(name) => commit(name)}
          isSpanish={isSpanish}
          committing={committing}
        />
      )}
    </div>
  );
}

function Dropdown({
  loading,
  results,
  showCreateNew,
  createNewLabel,
  highlightIdx,
  onPick,
  isSpanish,
  committing,
}) {
  const hasAnyContent = loading || results.length > 0 || showCreateNew;
  if (!hasAnyContent) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 2px)',
        left: 0,
        right: 0,
        background: 'var(--ink, #1a1410)',
        border: '1px solid rgba(176, 140, 63, 0.4)',
        borderRadius: '3px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
        maxHeight: '280px',
        overflowY: 'auto',
        zIndex: 100,
        opacity: committing ? 0.6 : 1,
        pointerEvents: committing ? 'none' : 'auto',
      }}
    >
      {loading && results.length === 0 && (
        <div
          style={{
            padding: '0.6rem 0.85rem',
            color: 'var(--paper-aged)',
            opacity: 0.6,
            fontSize: '0.85rem',
            fontStyle: 'italic',
            fontFamily: "'Cormorant Garamond', serif",
          }}
        >
          {isSpanish ? 'Buscando…' : 'Searching…'}
        </div>
      )}
      {results.map((r, i) => (
        <DropdownRow
          key={r.id}
          highlighted={i === highlightIdx}
          onClick={() => onPick(r.name)}
          onMouseEnter={() => {/* hover handled by CSS */}}
        >
          <RowContent
            name={r.name}
            verified={r.verified}
            usageCount={r.usageCount}
            isSpanish={isSpanish}
          />
        </DropdownRow>
      ))}
      {showCreateNew && (
        <DropdownRow
          highlighted={highlightIdx === results.length}
          onClick={() => onPick(createNewLabel)}
          isCreateNew
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                fontFamily: "'Special Elite', monospace",
                fontSize: '0.65rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--gilt)',
              }}
            >
              + {isSpanish ? 'Crear' : 'Create'}
            </span>
            <span
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontStyle: 'italic',
                fontSize: '1.05rem',
                color: 'var(--paper)',
              }}
            >
              "{createNewLabel}"
            </span>
          </div>
        </DropdownRow>
      )}
    </div>
  );
}

function DropdownRow({ children, highlighted, onClick, isCreateNew }) {
  return (
    <div
      onMouseDown={(e) => {
        // mousedown (not click) so we fire before the input loses focus
        // and the click-outside handler closes the dropdown
        e.preventDefault();
        onClick?.();
      }}
      style={{
        padding: '0.55rem 0.85rem',
        cursor: 'pointer',
        background: highlighted ? 'rgba(176, 140, 63, 0.12)' : 'transparent',
        borderTop: isCreateNew ? '1px dotted rgba(176, 140, 63, 0.2)' : 'none',
        transition: 'background 0.08s ease',
      }}
    >
      {children}
    </div>
  );
}

function RowContent({ name, verified, usageCount, isSpanish }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
        {verified && (
          <span
            style={{
              fontFamily: "'Special Elite', monospace",
              fontSize: '0.65rem',
              color: 'var(--gilt-bright)',
              flexShrink: 0,
            }}
            title={isSpanish ? 'Verificado por editores' : 'Editor-verified'}
          >
            ☩
          </span>
        )}
        <span
          style={{
            color: 'var(--paper)',
            fontSize: '0.95rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
      </div>
      {usageCount > 0 && (
        <span
          style={{
            fontFamily: "'Special Elite', monospace",
            fontSize: '0.7rem',
            color: 'var(--paper-aged)',
            opacity: 0.55,
            flexShrink: 0,
          }}
          title={isSpanish ? `Usada por ${usageCount} lectores` : `Used by ${usageCount} readers`}
        >
          {usageCount}
        </span>
      )}
    </div>
  );
}
