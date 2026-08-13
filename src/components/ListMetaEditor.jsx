// src/components/ListMetaEditor.jsx — v0.63
//
// Genre and mood chips for a curated list. Shared by the create modal and the
// list detail page so the two cannot drift, and deliberately built from the
// same `chip` / `chip--active` vocabulary as BookClubCreate — a reader who has
// tagged a club should recognise this instantly.
//
// Both fields are optional and both only matter on a public list: they exist so
// Discover can filter, and a private list is not in Discover. The caller
// decides whether to show them (see `hint`), rather than this component
// guessing at visibility rules it cannot see.
//
// One difference from BookClubCreate worth keeping: the genre taxonomy is ~49
// entries, which is a lot of chips to scan. Selected genres are hoisted to the
// front so the current answer is always visible without hunting, and the rest
// stay alphabetical.

import { useMemo, useState } from 'react';
import { useT } from '../lib/I18nContext';
import { MOODS, moodTitleKey } from '../lib/moods';

// Below this many genres the "show all" toggle is pointless — everything fits.
const GENRE_COLLAPSE_AT = 14;

export default function ListMetaEditor({
  genres,          // full taxonomy: [{ id, name }]
  genreIds,        // selected genre ids
  moods,           // selected mood ids
  onGenresChange,
  onMoodsChange,
  disabled = false,
  hint = null,     // optional line explaining why these matter
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const selectedGenres = useMemo(() => new Set(genreIds || []), [genreIds]);

  // Selected first, then alphabetical. Sorting a copy — `genres` is
  // `state.genres`, shared across the app, and sorting it in place would
  // reorder every other genre picker as a side effect.
  const ordered = useMemo(() => {
    const rows = [...(genres || [])];
    rows.sort((a, b) => {
      const as = selectedGenres.has(a.id) ? 0 : 1;
      const bs = selectedGenres.has(b.id) ? 0 : 1;
      return as - bs || (a.name || '').localeCompare(b.name || '');
    });
    return rows;
  }, [genres, selectedGenres]);

  const collapsible = ordered.length > GENRE_COLLAPSE_AT;
  const shown = (collapsible && !expanded) ? ordered.slice(0, GENRE_COLLAPSE_AT) : ordered;

  function toggleGenre(id) {
    if (disabled) return;
    const next = selectedGenres.has(id)
      ? (genreIds || []).filter((g) => g !== id)
      : [...(genreIds || []), id];
    onGenresChange(next);
  }

  function toggleMood(id) {
    if (disabled) return;
    const cur = moods || [];
    onMoodsChange(cur.includes(id) ? cur.filter((m) => m !== id) : [...cur, id]);
  }

  return (
    <div className="list-meta">
      {hint && <p className="list-meta__hint">{hint}</p>}

      <div className="list-meta__field">
        <label className="field-label">
          {t('lists.fieldGenres')}{' '}
          <span className="lists-optional-label">({t('lists.optional')})</span>
        </label>
        <div className="club-form__genre-row">
          {shown.map((g) => (
            <button
              key={g.id}
              type="button"
              disabled={disabled}
              onClick={() => toggleGenre(g.id)}
              className={`chip${selectedGenres.has(g.id) ? ' chip--active' : ''}`}
            >
              {g.name}
            </button>
          ))}
          {collapsible && (
            <button
              type="button"
              className="btn-text list-meta__more"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? t('lists.showFewerGenres')
                : t('lists.showAllGenres', { count: ordered.length - GENRE_COLLAPSE_AT })}
            </button>
          )}
        </div>
      </div>

      <div className="list-meta__field">
        <label className="field-label">
          {t('lists.fieldMoods')}{' '}
          <span className="lists-optional-label">({t('lists.optional')})</span>
        </label>
        <div className="club-form__genre-row">
          {MOODS.map((id) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => toggleMood(id)}
              className={`chip${(moods || []).includes(id) ? ' chip--active' : ''}`}
            >
              {t(moodTitleKey(id))}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
