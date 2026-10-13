// src/views/profile/OverviewTab.jsx — Profile's Overview tab: the reading
// challenge, the reader's sky and chart, and the stats from ./profileStats.js.

import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter } from '../../contexts/RouterContext';
import { useT } from '../../contexts/I18nContext';
import { openBookTab } from '../../lib/book/bookHelpers';
import TasteChart from '../../components/TasteChart';
import ReaderConstellation from '../../components/ReaderConstellation';
import StatCard from './overview/StatCard';
import GenreBar from './overview/GenreBar';
import PaceChart from './overview/PaceChart';
import ReadingChallenge from './overview/ReadingChallenge';

/** @param {{ stats: ReturnType<import('./profileStats').computeProfileStats> }} props */
export default function OverviewTab({ stats }) {
  const { state, setReadingGoalCount } = useData();
  const { user } = useAuth();
  const { go } = useRouter();
  const t = useT();
  const hasStats = stats.totalBooks > 0;
  const sectionTitle = (label) => (
    <div className="pf-overline">{label}</div>
  );

  return (
    <>
      {/* ── Reading Challenge — first thing in Overview (v0.65).
          The goal is the frame the rest of the numbers are read against, so it
          leads rather than trailing the stats it contextualises. It also
          renders outside `hasStats`, which means a reader with an empty shelf
          opens Profile on "set a goal" instead of on nothing.

          No outer overline: the component self-labels ("2026 Reading
          Challenge" / the set-a-goal subtitle), so an extra label doubled up. */}
      <section className="pf-challenge-block">
        <div className="pf-pace-panel">
          <ReadingChallenge
            library={state.library}
            readingGoalCount={state.readingGoalCount}
            setReadingGoalCount={setReadingGoalCount}
            t={t}
          />
        </div>
      </section>

      {/* three.js-motion experiment: the reader's sky — books as stars by family. */}
      {user && <ReaderConstellation />}

      {/* v0.72.2: the reader's chart (Pro). Own profile only — this view is. */}
      {user && <TasteChart />}

      {hasStats && (
        <div className="profile-stats">

          <section>
            {sectionTitle(t('profile.sectionStats'))}

            {/* Top-line numbers */}
            <div className="pf-stats-grid">
              <StatCard
                value={stats.totalBooks}
                label={t('profile.statBooksRead')}
                sub={stats.booksThisYear > 0 ? t('profile.statThisYear', { count: stats.booksThisYear }) : null}
              />
              {stats.totalPages > 0 && (
                <StatCard
                  value={stats.totalPages.toLocaleString()}
                  label={t('profile.statPages')}
                  sub={stats.pagesThisYear > 0 ? t('profile.statThisYear', { count: stats.pagesThisYear.toLocaleString() }) : null}
                />
              )}
              {stats.pace && (
                <StatCard
                  value={stats.pace}
                  label={t('profile.statBooksMonth')}
                  sub={t('profile.statLast12')}
                />
              )}
              {stats.avgRating && (
                <StatCard
                  value={`${stats.avgRating}★`}
                  label={t('profile.statAvgRating')}
                />
              )}
              {stats.seriesCompleted > 0 && (
                <StatCard
                  value={stats.seriesCompleted}
                  label={t('profile.statSeriesFinished')}
                />
              )}
            </div>
          </section>

          {/* Pace chart */}
          {stats.datedBooks.length > 0 && (
            <section>
              {sectionTitle(t('profile.sectionPace'))}
              <PaceChart books={stats.datedBooks} onOpenBook={(b) => openBookTab(b, 'profile')} />
            </section>
          )}

          {/* Top genres */}
          {stats.topGenres.length > 0 && (
            <section>
              {sectionTitle(t('profile.sectionTopGenres'))}
              <div className="pf-pace-panel">
                {stats.topGenres.map((g) => (
                  <GenreBar key={g.name} name={g.name} count={g.count} max={stats.topGenres[0].count} />
                ))}
              </div>
            </section>
          )}

          {/* Favourite author */}
          {stats.topAuthor && stats.topAuthor[1] > 1 && (
            <section>
              {sectionTitle(t('profile.sectionTopAuthor'))}
              {/* v0.43.1: panel wrapper — was a bare line floating on the
                  page background, inconsistent with the genre/pace panels */}
              <div className="pf-pace-panel">
                <p className="pf-author-line">
                  <span className="pf-author-name">{stats.topAuthor[0]}</span>
                  <span className="pf-author-count">
                    · {t('profile.topAuthorBooks', { count: stats.topAuthor[1] })}
                  </span>
                </p>
              </div>
            </section>
          )}

          {/* Series in progress */}
          {stats.seriesInProgress.length > 0 && (
            <section>
              {sectionTitle(t('profile.sectionSeries'))}
              <div className="pf-series-list">
                {stats.seriesInProgress.map((s) => (
                  <div
                    key={s.name}
                    className="pf-series-row"
                    onClick={() => go('series-page', { seriesName: s.name, from: 'profile', fromLabel: t('profile.fromProfile') })}
                    title={t('profile.openSeries')}
                  >
                    <div className="pf-series-bar__body">
                      <div className="pf-series-bar__name">{s.name}</div>
                      <div className="pf-series-bar__meta">
                        {t('profile.seriesRead', { read: s.read, total: s.total })}
                      </div>
                    </div>
                    <div className="pf-series-bar__right">
                      <span className="bp-series__open">
                        {t('profile.openLink')}
                      </span>
                      <div className="pf-pips">
                        {Array.from({ length: s.total }).map((_, i) => (
                          <div key={i} className={`pf-pip${i < s.read ? ' pf-pip--filled' : ''}`} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* No date data nudge */}
          {stats.datedBooks.length === 0 && stats.totalBooks > 0 && (
            <p className="bp-no-rating">
              {t('profile.paceNudge')}
            </p>
          )}

        </div>
      )}

    </>
  );
}
