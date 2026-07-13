import { useEffect, useRef, useState, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';

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
  const t = useT();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);

  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);
  const queryIdRef = useRef(0);

  const atCap = (existingIds?.size || 0) >= 10;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!open || atCap) { setResults([]); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const thisQueryId = ++queryIdRef.current;
      const rows = await searchCategories(query, 8);
      if (thisQueryId !== queryIdRef.current) return;
      const filtered = (existingIds && existingIds.size > 0)
        ? rows.filter((r) => !existingIds.has(r.id))
        : rows;
      setResults(filtered);
      setHighlightIdx(0);
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open, atCap, searchCategories, existingIds]);

  useEffect(() => {
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      return () => document.removeEventListener('mousedown', onDocClick);
    }
  }, [open]);

  const commit = useCallback(async (nameToAdd) => {
    const trimmed = (nameToAdd || '').trim();
    if (!trimmed) return;
    if (atCap) { onCapHit?.(); return; }
    setCommitting(true);
    const ok = await addCategoryToBook(book, trimmed);
    setCommitting(false);
    if (ok) {
      onAdd?.(trimmed);
      setQuery(''); setResults([]); setHighlightIdx(0);
      inputRef.current?.focus();
    } else {
      if ((existingIds?.size || 0) + 1 >= 10) onCapHit?.();
    }
  }, [book, addCategoryToBook, atCap, onAdd, onCapHit, existingIds]);

  const trimmedQuery = query.trim();
  const hasExactMatch = results.some((r) => r.exactMatch);
  const showCreateNew = trimmedQuery.length > 0 && !hasExactMatch && !atCap;
  const totalRows = results.length + (showCreateNew ? 1 : 0);

  function onKeyDown(e) {
    if (atCap) return;
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      if (totalRows > 0) setHighlightIdx((i) => (i + 1) % totalRows);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalRows > 0) setHighlightIdx((i) => (i - 1 + totalRows) % totalRows);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (!open || totalRows === 0) {
        if (e.key === 'Enter' && trimmedQuery.length > 0) { e.preventDefault(); commit(trimmedQuery); }
        return;
      }
      const isCreateRowHighlighted = showCreateNew && highlightIdx === results.length;
      const highlighted = !isCreateRowHighlighted ? results[highlightIdx] : null;
      if (highlighted) { e.preventDefault(); commit(highlighted.name); }
      else if (isCreateRowHighlighted || (e.key === 'Enter' && trimmedQuery)) { e.preventDefault(); commit(trimmedQuery); }
    }
  }

  return (
    <div ref={containerRef} className="cat-auto">
      <input
        ref={inputRef}
        type="text"
        className="input"
        value={query}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { if (!atCap) setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder={atCap ? t('categories.maxCategories') : (placeholder || t('categories.addPlaceholder'))}
        disabled={disabled || atCap || committing}
      />
      {open && !atCap && (
        <Dropdown
          loading={loading}
          results={results}
          showCreateNew={showCreateNew}
          createNewLabel={trimmedQuery}
          highlightIdx={highlightIdx}
          onPick={commit}
          committing={committing}
          t={t}
        />
      )}
    </div>
  );
}

function Dropdown({ loading, results, showCreateNew, createNewLabel, highlightIdx, onPick, committing, t }) {
  if (!loading && results.length === 0 && !showCreateNew) return null;

  return (
    <div className="cat-auto__dropdown" style={{ opacity: committing ? 0.6 : 1, pointerEvents: committing ? "none" : "auto" }}>
      {loading && results.length === 0 && (
        <div className="cat-auto__empty">
          {t('navSearch.loadingText')}
        </div>
      )}
      {results.map((r, i) => (
        <DropdownRow key={r.id} highlighted={i === highlightIdx} onClick={() => onPick(r.name)}>
          <RowContent name={r.name} verified={r.verified} usageCount={r.usageCount} t={t} />
        </DropdownRow>
      ))}
      {showCreateNew && (
        <DropdownRow highlighted={highlightIdx === results.length} onClick={() => onPick(createNewLabel)} isCreateNew>
          <div className="cat-auto__row">
            <span className="cat-auto__tag">
              {t('categories.createBtn')}
            </span>
            <span className="session-form__book-title">
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
      onMouseDown={(e) => { e.preventDefault(); onClick?.(); }}
      className="ldetail-pick-row" style={{ background: highlighted ? 'rgba(176, 140, 63, 0.12)' : 'transparent', borderTop: isCreateNew ? '1px dotted var(--ro-border)' : 'none' }}
    >
      {children}
    </div>
  );
}

function RowContent({ name, verified, usageCount, t }) {
  return (
    <div className="club-card__head">
      <div className="lv-curated-by">
        {verified && (
          <span className="cat-auto__tag" title={t('categories.editorVerified')}>
            ☩
          </span>
        )}
        <span style={{ color: 'var(--ro-text)', fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
      </div>
      {usageCount > 0 && (
        <span style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.7rem', color: 'var(--ro-muted)', opacity: 0.55, flexShrink: 0 }} title={t('categories.usedByReaders', { count: usageCount })}>
          {usageCount}
        </span>
      )}
    </div>
  );
}
