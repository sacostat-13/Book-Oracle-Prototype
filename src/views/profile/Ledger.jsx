// src/views/profile/Ledger.jsx — the Ledger tab: every accomplishment the reader has earned.

import { useState } from 'react';
import { groupFamilyAccomplishments, nextRung } from '../../lib/achievements/ledger';
import { FamilyRowsSkeleton } from '../../components/Skeleton';
import BookMark from '../../components/BookMark';

// ── v0.45: The Ledger — retroactive trophy shelf ─────────────────────────────
// A record of what the reader's library has already earned, grouped and dated.
// Ledger discipline (docs/specs/reading-accomplishments-v1-spec.md): past tense,
// dated, no streaks, no countdowns, no "N to go". Tapping a plaque re-opens
// its branded share card. The forward-looking "next rung" line is deliberately
// omitted in v1 — it could not be made to read as a ledger line rather than a
// nudge, so per the spec it was cut.
export const LEDGER_ORNAMENT = {
  goal_completed: '✦',
  series_completed: '☩',
  plan_completed: <BookMark />,
  nth_book: '✺',
  family_count: '⚜',
  family_breadth: '✦',
  new_family: '✧',
  // Retired in v0.67 but never deleted — "earned once, kept forever" (spec
  // rule 3). These render in their own collapsed group below.
  genre_count: '⚜',
  new_genre: '✧',
  female_authors_count: '⚘',
};

// Group order = significance order, matching the share-moment PRIORITY ladder.
export const LEDGER_GROUPS = [
  { id: 'goals', kinds: ['goal_completed'] },
  { id: 'series', kinds: ['series_completed'] },
  { id: 'plans', kinds: ['plan_completed'] },
  { id: 'years', kinds: ['nth_book'] },
  // Families are NOT a plaque shelf — they render as one row per family, with
  // the count ladder as a track. See FamilyLedgerRow below.
  // { id: 'genres', kinds: ['genre_count', 'new_genre'], legacy: true },
  // v0.55: books by women — cross-genre, kept as its own shelf group rather
  // than folded into 'genres' since it deliberately isn't one.
  { id: 'authors', kinds: ['female_authors_count'] },
];

export function ledgerPlaqueLabel(entry, t) {
  const m = entry.meta || {};
  switch (entry.kind) {
    case 'goal_completed': return t('ledger.goalLabel', { goal: m.goal, year: m.year });
    case 'series_completed': return t('ledger.seriesLabel', { series: m.seriesName, total: m.total });
    case 'plan_completed': return t('ledger.planLabel', { plan: m.planTitle });
    case 'nth_book': return t('ledger.nthLabel', { n: m.n, year: m.year });
    case 'family_count': return t('ledger.familyCountLabel', { n: m.n, family: m.familyName || m.family });
    case 'family_breadth': return t('ledger.familyBreadthLabel', { n: m.n, family: m.familyName || m.family });
    case 'new_family': return t('ledger.newFamilyLabel', { family: m.familyName || m.family });
    case 'genre_count': return t('ledger.genreCountLabel', { n: m.n, genre: m.genre });
    case 'new_genre': return t('ledger.newGenreLabel', { genre: m.genre });
    case 'female_authors_count': return t('ledger.femaleAuthorsLabel', { n: m.n });
    default: return '';
  }
}

// ── v0.67: one row per family, not five plaques ──────────────────────────────
//
// A family can earn `new_family`, several `family_count` rungs and several
// `family_breadth` rungs. As separate plaques that is the same achievement
// minced into five — the 835-plaque problem the family ladders were introduced
// to fix, reappearing one level down in the UI.
//
// So: one row. The count ladder becomes a TRACK; everything else sits beside it.
//
// A TRACK, NOT A PROGRESS BAR — and the distinction is the whole design.
// A bar 76% filled toward 50 is a picture of what you have NOT done, and it
// invites you to finish it. That is habit-app grammar, and rule 1 of
// docs/specs/reading-accomplishments-v1-spec.md exists to refuse it. Dots are stops
// you have made; the connecting line ends where your reading ended rather than
// stretching toward a target. The next rung is drawn as one hollow dot with its
// number and nothing else — no fill, no percentage, no "12 to go", no colour
// change as you approach. If it ever starts reading as a bar, delete the hollow
// dot: the row survives that, and rule 1 does not survive the opposite.
export function FamilyLedgerRow({ family, counts, others, onShare, t, fmtDate }) {
  const next = nextRung(counts);

  return (
    <div className="pf-family-row">
      <div className="pf-family-row__name">{family.name}</div>

      {counts.length > 0 && (
        <div className="pf-family-track" role="list">
          {counts.map((e) => (
            <button
              type="button"
              key={e.id || e.key}
              className="pf-family-track__stop"
              role="listitem"
              onClick={() => onShare(e)}
              title={`${ledgerPlaqueLabel(e, t)} · ${fmtDate(e.earnedAt)}`}
            >
              <span className="pf-family-track__dot" aria-hidden="true" />
              <span className="pf-family-track__n">{e.meta.n}</span>
              <span className="pf-family-track__date">{fmtDate(e.earnedAt)}</span>
            </button>
          ))}
          {next && (
            <div className="pf-family-track__stop is-next" aria-hidden="true">
              <span className="pf-family-track__dot pf-family-track__dot--hollow" />
              <span className="pf-family-track__n">{next}</span>
            </div>
          )}
        </div>
      )}

      {others.length > 0 && (
        <div className="pf-family-row__aside">
          {others.map((e) => (
            <button
              type="button"
              key={e.id || e.key}
              className="pf-family-mark"
              onClick={() => onShare(e)}
              title={t('ledger.shareHint')}
            >
              <span className="pf-family-mark__ornament" aria-hidden="true">
                {LEDGER_ORNAMENT[e.kind] || '❧'}
              </span>
              <span className="pf-family-mark__label">{ledgerPlaqueLabel(e, t)}</span>
              <span className="pf-family-mark__date">{fmtDate(e.earnedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const LEGACY_VISIBLE = 5;

export default function Ledger({ accomplishments, onShare, t, locale, backfilling = false }) {
  const [showAllLegacy, setShowAllLegacy] = useState(false);
  // The panel still renders while the replay is in flight even with nothing
  // persisted yet — that is the case the skeleton exists for. Only a settled,
  // genuinely empty ledger falls through to the empty line.
  if ((!accomplishments || accomplishments.length === 0) && !backfilling) return null;

  const byKind = {};
  for (const a of accomplishments) {
    (byKind[a.kind] = byKind[a.kind] || []).push(a);
  }

  const familyRows = groupFamilyAccomplishments(accomplishments);

  const fmtDate = (iso) => {
    try {
      return new Date(iso).toLocaleDateString(locale === 'es' ? 'es-AR' : 'en-US', {
        year: 'numeric', month: 'short',
      });
    } catch { return ''; }
  };

  return (
    <section>
      <div className="pf-overline">{t('ledger.sectionTitle')}</div>
      <p className="pf-ledger-lede">{t('ledger.lede')}</p>

      {familyRows.length === 0 && backfilling && (
        <div className="pf-ledger-group">
          <div className="pf-ledger-group__label">{t('ledger.group.families')}</div>
          <FamilyRowsSkeleton />
        </div>
      )}

      {familyRows.length > 0 && (
        <div className="pf-ledger-group">
          <div className="pf-ledger-group__label">{t('ledger.group.families')}</div>
          <div className="pf-family-rows">
            {familyRows.map((row) => (
              <FamilyLedgerRow
                key={row.family.slug}
                family={row.family}
                counts={row.counts}
                others={row.others}
                onShare={onShare}
                t={t}
                fmtDate={fmtDate}
              />
            ))}
          </div>
        </div>
      )}

      {LEDGER_GROUPS.map((group) => {
        const all = group.kinds
          .flatMap((k) => byKind[k] || [])
          .sort((a, b) => (a.earnedAt < b.earnedAt ? 1 : a.earnedAt > b.earnedAt ? -1 : 0));
        if (!all.length) return null;
        // The retired genre ladders could mint 835 plaques, and a reader who
        // earned thirty of them still has thirty after the v0.67 rewrite —
        // nothing deletes an earned accomplishment. Fold rather than delete: a
        // record you can collapse is still a record.
        const collapsed = group.legacy && !showAllLegacy && all.length > LEGACY_VISIBLE;
        const items = collapsed ? all.slice(0, LEGACY_VISIBLE) : all;
        return (
          <div className="pf-ledger-group" key={group.id}>
            <div className="pf-ledger-group__label">{t(`ledger.group.${group.id}`)}</div>
            <div className="pf-ledger-shelf">
              {items.map((entry) => (
                <button
                  type="button"
                  key={entry.id || entry.key}
                  className="pf-ledger-plaque"
                  onClick={() => onShare(entry)}
                  title={t('ledger.shareHint')}
                >
                  <span className="pf-ledger-plaque__ornament" aria-hidden="true">
                    {LEDGER_ORNAMENT[entry.kind] || '❧'}
                  </span>
                  <span className="pf-ledger-plaque__body">
                    <span className="pf-ledger-plaque__label">{ledgerPlaqueLabel(entry, t)}</span>
                    <span className="pf-ledger-plaque__date">{fmtDate(entry.earnedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
            {collapsed && (
              <button
                type="button"
                className="pf-ledger-more"
                onClick={() => setShowAllLegacy(true)}
              >
                {t('ledger.showAll', { n: all.length })}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
