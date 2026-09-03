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
//
// v0.67 — AN ACCORDION WHEN BROWSING, FLAT WHEN SEARCHING.
//
// The taxonomy is 167 now, and MAX_VISIBLE truncates an unqueried list at 60 —
// so browsing without typing showed the alphabet as far as "F" and then stopped.
// Grouping alone was not enough either: 16 headings plus 167 genres is still a
// wall, just a signposted one. Opening the picker now shows sixteen family rows
// and nothing else, and one family opens at a time.
//
// Searching stays FLAT and ranked. This is the important half. The obvious
// design — family dropdown, then genre dropdown — forces a reader who knows they
// want Folk Horror to first answer a question they may not be able to (is
// Magical Realism under The Literary Shelf or Fantasy?) and punishes a wrong
// guess with an empty second control. Here the family is structure while you
// scroll and irrelevant the moment you type.
//
// Family rows are selectable, emitting `family:<slug>`. Callers that do not want
// that pass selectableFamilies={false} and get headings only.

import { useEffect, useMemo, useRef, useState } from 'react';

const MAX_VISIBLE = 60; // enough to browse, few enough to keep the DOM cheap

export const FAMILY_PREFIX = 'family:';
export const isFamilyValue = (v) => typeof v === 'string' && v.startsWith(FAMILY_PREFIX);
export const familySlugOf  = (v) => (isFamilyValue(v) ? v.slice(FAMILY_PREFIX.length) : null);

// Genres whose family has not been curated yet. They must still be reachable —
// an Oracle-invented genre is born without a family and may hold the only copy
// of a book on this shelf.
const UNFILED = { slug: '__unfiled', name: 'Everything else', sort: 9999 };

// Extracted from the component so the fiddly half can be tested without a DOM.
//
// Browsing is an ACCORDION: sixteen family rows and nothing else until one is
// opened. 183 rows was better than 167 flat ones, but it still asked the reader
// to scroll a wall to find out what the shelf even contains. Sixteen rows is a
// list you read rather than scan.
//
// One family open at a time, deliberately. Several open is a wall again by the
// third click, and closing the previous one costs nothing — the reader is
// looking for one genre, not comparing two families.
//
// Searching ignores the accordion entirely and returns a flat ranked list. That
// is the whole point of the split: the accordion is for readers who do not know
// what they want, and typing is proof that you do.
//
// Returns a flat list of rows; `kind` is one of:
//   'all'    — the clear-the-filter row, always first when browsing
//   'family' — always expandable; selectable (emits `family:<slug>`) only when
//              the caller allows it
//   'genre'  — selectable, emits the normalized name
export function buildGenreRows(options, query, {
  allLabel,
  selectableFamilies = true,
  expandedFamily = null,
} = {}) {
  const q = query.trim().toLowerCase();
  const all = { kind: 'all', key: 'all', value: 'all', name: allLabel };

  if (q) {
    // FLAT and ranked. Matching a family name surfaces the family row too, so
    // typing "gothic" offers the whole shelf as well as its genres.
    const matched = options.filter((o) => o.name.toLowerCase().includes(q));
    // Rank prefix matches above mid-string ones: typing "hor" should surface
    // "Horror" before "Cosmic Horror", which is what a reader expects even
    // though both are honest matches.
    matched.sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
    const out = matched.slice(0, MAX_VISIBLE).map((o) => ({
      kind: 'genre', key: o.norm, value: o.norm, name: o.name,
    }));

    if (!selectableFamilies) return out;

    const fams = new Map();
    for (const o of options) {
      if (!o.familySlug || !o.familyName) continue;
      if (!o.familyName.toLowerCase().includes(q)) continue;
      fams.set(o.familySlug, o);
    }
    const famRows = [...fams.values()]
      .sort((a, b) => (a.familySort ?? 999) - (b.familySort ?? 999))
      .map((o) => ({
        kind: 'family', key: FAMILY_PREFIX + o.familySlug, slug: o.familySlug,
        value: FAMILY_PREFIX + o.familySlug, name: o.familyName, expanded: false,
      }));
    return [...famRows, ...out].slice(0, MAX_VISIBLE);
  }

  // ACCORDION.
  const byFamily = new Map();
  for (const o of options) {
    const slug = o.familySlug || UNFILED.slug;
    if (!byFamily.has(slug)) {
      byFamily.set(slug, {
        slug,
        name: o.familyName || UNFILED.name,
        sort: o.familySlug ? (o.familySort ?? 999) : UNFILED.sort,
        items: [],
      });
    }
    byFamily.get(slug).items.push(o);
  }
  const groups = [...byFamily.values()]
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  const out = [all];
  for (const g of groups) {
    const expanded = g.slug === expandedFamily;
    out.push({
      kind: 'family',
      key: FAMILY_PREFIX + g.slug,
      slug: g.slug,
      // The unfiled bucket is expandable but never selectable: "has no family"
      // is not a filter anyone can act on.
      value: (selectableFamilies && g.slug !== UNFILED.slug) ? FAMILY_PREFIX + g.slug : null,
      name: g.name,
      count: g.items.length,
      expanded,
    });
    if (!expanded) continue;
    for (const o of g.items.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ kind: 'genre', key: o.norm, value: o.norm, name: o.name });
    }
  }
  return out;
}

// Which family should be open when the dropdown is first opened: the one
// holding the current selection, so reopening shows you where you are instead
// of making you find it again.
export function familyForValue(value, options) {
  if (!value || value === 'all') return null;
  if (isFamilyValue(value)) return familySlugOf(value);
  return options.find((o) => o.norm === value)?.familySlug || null;
}

export default function GenreSelect({
  value,             // normalized genre key, `family:<slug>`, or 'all'
  onChange,          // (value: string) => void
  options,           // [{ norm, name, familySlug?, familyName?, familySort? }]
  allLabel,          // label for the 'all' row
  placeholder = 'Search genres…',
  disabled = false,
  selectableFamilies = true,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [expandedFamily, setExpandedFamily] = useState(null);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selectedName = useMemo(() => {
    if (value === 'all') return allLabel;
    if (isFamilyValue(value)) {
      const slug = familySlugOf(value);
      return options.find((o) => o.familySlug === slug)?.familyName || allLabel;
    }
    return options.find((o) => o.norm === value)?.name || allLabel;
  }, [value, options, allLabel]);

  // 'all' is always offered and always first, so clearing the filter never
  // requires finding a row by name.
  const rows = useMemo(
    () => buildGenreRows(options, query, { allLabel, selectableFamilies, expandedFamily }),
    [query, options, allLabel, selectableFamilies, expandedFamily]
  );

  // Every row is interactive now — a family row is at minimum a disclosure —
  // so there is nothing to skip over when arrowing.
  const selectableIdx = useMemo(() => rows.map((_, i) => i), [rows]);

  useEffect(() => { setHighlightIdx(selectableIdx[0] ?? 0); }, [query, selectableIdx]);

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

  // A family row does two things at once and stays open for both: it applies
  // the family as the filter (when the caller allows) AND discloses its genres,
  // so the reader sees the broad result immediately and can narrow without
  // reopening anything. Picking a genre is a terminal choice, so that closes.
  function activate(row) {
    if (row.kind === 'family') {
      setExpandedFamily((cur) => (cur === row.slug ? null : row.slug));
      if (row.value) onChange(row.value);
      return;
    }
    onChange(row.value);
    close();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const step = (dir) => {
      if (!selectableIdx.length) return;
      const at = selectableIdx.indexOf(highlightIdx);
      const next = at === -1
        ? (dir > 0 ? 0 : selectableIdx.length - 1)
        : (at + dir + selectableIdx.length) % selectableIdx.length;
      setHighlightIdx(selectableIdx[next]);
    };
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      step(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
      return;
    }
    if (e.key === 'Enter') {
      if (!open) { e.preventDefault(); setOpen(true); return; }
      const row = rows[highlightIdx];
      if (row) { e.preventDefault(); activate(row); }
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
            setExpandedFamily(familyForValue(value, options));
            // Focus after paint: the input does not exist until `open` renders.
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="genre-select__value">
            {value === 'all' || isFamilyValue(value) ? selectedName : `☩ ${selectedName}`}
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
          {rows.map((r, i) => {
            const isFam = r.kind === 'family';
            return (
              <div
                key={r.key}
                role="option"
                aria-selected={!!r.value && r.value === value}
                aria-expanded={isFam ? !!r.expanded : undefined}
                className={
                  'genre-select__row' +
                  (isFam ? ' genre-select__row--family' : '') +
                  (isFam && r.expanded ? ' is-expanded' : '') +
                  (r.kind === 'genre' ? ' genre-select__row--genre' : '') +
                  (i === highlightIdx ? ' is-highlighted' : '') +
                  (r.value && r.value === value ? ' is-selected' : '')
                }
                onMouseEnter={() => setHighlightIdx(i)}
                onMouseDown={(e) => { e.preventDefault(); activate(r); }}
              >
                {isFam && <span className="genre-select__chevron" aria-hidden="true" />}
                <span className="genre-select__label">
                  {r.kind === 'genre' ? `☩ ${r.name}` : r.name}
                </span>
                {isFam && r.count ? <span className="genre-select__count">{r.count}</span> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
