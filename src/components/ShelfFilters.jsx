// ShelfFilters — the search + genre + category cluster shared by the Wishlist
// and Library toolbars.
//
// v0.62. Lifted verbatim from both views, which carried identical markup down
// to the SVG path data. The only thing that differed was the i18n key prefix,
// which is what `context` selects.
//
// Renders the contents of .lv-toolbar__filters, not the toolbar itself — the
// two shelves put different things in .lv-chips beside it (Wishlist has bulk
// import, Library does not), so the wrapper stays with the caller.
//
// Behaviour-neutral extraction: no new controls here yet. The advanced filters
// (pages, prose, depth, author) attach to this component in a later step; see
// docs/shelf-filters-v1-spec.md.

import { useState } from 'react';
import { useT } from '../lib/I18nContext';
import { PAGE_OPTIONS, GENDER_OPTIONS, LEVELS } from '../lib/useShelfFilters';

// Endpoint labels only. The 1-5 scales are defined canonically in
// src/lib/oracleCategorizationService.js (COMPLEXITY RULES / DEPTH RULES) and
// the tooltips below quote them — paraphrasing here is how the classifier and
// the UI drift apart, which is exactly how author_gender got lost.
const LEVEL_HINTS = {
  complexity: {
    1: 'Casual, page-turners',
    2: 'Mid-difficulty',
    3: 'Literary',
    4: 'Challenging (Faulkner, Han Kang)',
    5: 'Experimental (Donoso, Lispector)',
  },
  depth: {
    1: 'Approachable themes',
    2: 'Lightly demanding',
    3: 'Moderately demanding',
    4: 'Demanding',
    5: 'Most demanding in its genre',
  },
};

export default function ShelfFilters({ state, context = 'wishlist' }) {
  const t = useT();
  const {
    values, set, options, hasCategoryFilter,
    available, activeCount, hasAdvanced, unmeasuredCount, clearAdvanced,
  } = state;

  // Opens automatically when a persisted filter is already narrowing the shelf.
  // A collapsed panel silently removing half the books is the failure mode this
  // whole disclosure pattern has to design against.
  const [open, setOpen] = useState(activeCount > 0);

  // 'wishlist.searchPlaceholder' / 'library.searchPlaceholder', etc. Both key
  // sets already exist in en.json and es.json with distinct copy — Library says
  // "Search your library", Wishlist "Search title or author" — so this cannot
  // collapse to one shared key without a copy change.
  const k = (name) => t(`${context}.${name}`);

  const levelRow = (which) => (
    <div className="sf-field">
      <span className="sf-field__label">{t(`shelfFilters.${which}`)}</span>
      <div className="sf-chips" role="group" aria-label={t(`shelfFilters.${which}`)}>
        {LEVELS.map((lvl) => {
          const on = values[which].includes(lvl);
          return (
            <button
              key={lvl}
              type="button"
              className={`sf-chip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              title={LEVEL_HINTS[which][lvl]}
              onClick={() => set.toggleLevel(which, lvl)}
            >
              {lvl}
            </button>
          );
        })}
      </div>
      <span className="sf-field__scale">
        {t('shelfFilters.scaleLow')} → {t('shelfFilters.scaleHigh')}
      </span>
    </div>
  );

  return (
    <>
    <div className="lv-toolbar__filters">
      <div className="lv-search">
        <svg
          className="lv-search__icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="text"
          className="lv-search__input"
          placeholder={k('searchPlaceholder')}
          value={values.search}
          onChange={(e) => set.search(e.target.value)}
        />
      </div>

      <select
        className="select"
        value={values.genre}
        onChange={(e) => set.genre(e.target.value)}
      >
        <option value="all">{k('allGenres')}</option>
        {options.genres.map((o) => (
          <option key={o.normalizedName} value={o.normalizedName}>
            ☩ {o.name}
          </option>
        ))}
      </select>

      {hasCategoryFilter && (
        <select
          className="select"
          value={values.category}
          onChange={(e) => set.category(e.target.value)}
        >
          <option value="all">{k('allCategories')}</option>
          {options.categories.map((o) => (
            <option key={o.name} value={o.name}>
              {o.verified ? `☩ ${o.name}` : o.name}
            </option>
          ))}
        </select>
      )}

      {hasAdvanced && (
        <button
          type="button"
          className={`btn btn-tertiary sf-toggle${activeCount > 0 ? ' is-active' : ''}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          ⚙ {t(open ? 'shelfFilters.fewer' : 'shelfFilters.more')}
          {activeCount > 0 && <span className="sf-toggle__count">· {activeCount}</span>}
        </button>
      )}
    </div>

    {hasAdvanced && open && (
      <div className="sf-panel">
        <div className="sf-panel__grid">
          {available.pages && (
            <div className="sf-field">
              <span className="sf-field__label">{t('shelfFilters.pages')}</span>
              <select
                className="select"
                value={values.pages}
                onChange={(e) => set.pages(e.target.value)}
              >
                <option value="all">{t('shelfFilters.anyPages')}</option>
                {PAGE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n === 501
                      ? t('shelfFilters.pagesOver').replace('{n}', 500)
                      : t('shelfFilters.pagesUnder').replace('{n}', n)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {available.complexity && levelRow('complexity')}
          {available.depth && levelRow('depth')}

          {available.gender && (
            <div className="sf-field">
              {/* "Author", not "Author gender". Filtering a shelf by who wrote
                  the books is a normal reading-goal move; labelling it as a
                  demographic field is not the register this app speaks in. */}
              <span className="sf-field__label">{t('shelfFilters.author')}</span>
              <select
                className="select"
                value={values.gender}
                onChange={(e) => set.gender(e.target.value)}
              >
                <option value="all">{t('shelfFilters.anyAuthor')}</option>
                {GENDER_OPTIONS.map((g) => (
                  <option key={g} value={g}>{t(`shelfFilters.author_${g}`)}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Only meaningful once something is actually being filtered — until
            then there is no "excluded because unmeasured" bucket to recover. */}
        {activeCount > 0 && (
          <div className="sf-panel__foot">
            <label className="sf-unrated">
              {/* The input stays a real checkbox and keeps its own focus ring
                  and keyboard behaviour; the box beside it is the visible
                  affordance. Replacing the control with a div would have meant
                  reimplementing both, badly. */}
              <input
                type="checkbox"
                className="sf-unrated__input"
                checked={values.includeUnrated}
                onChange={(e) => set.includeUnrated(e.target.checked)}
              />
              <span className="sf-unrated__box" aria-hidden="true">✓</span>
              <span className="sf-unrated__text">
                {t('shelfFilters.includeUnmeasured')}
                {unmeasuredCount > 0 && <span className="sf-unrated__count"> ({unmeasuredCount})</span>}
              </span>
            </label>
            <button type="button" className="btn btn-tertiary btn--sm" onClick={clearAdvanced}>
              {t('shelfFilters.clear')}
            </button>
          </div>
        )}
      </div>
    )}
    </>
  );
}
