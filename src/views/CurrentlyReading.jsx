import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import { bookKey } from '../lib/bookHelpers';
import BookCover from '../components/BookCover';
import RatingModal from '../components/RatingModal';
import ProgressUpdateModal from '../components/ProgressUpdateModal';

export default function CurrentlyReading({ onOpenBook }) {
  const { state, removeFromCurrentlyReading, finishReading, updateReadingProgress } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();
  const [finishing, setFinishing] = useState(null);
  const [updatingProgress, setUpdatingProgress] = useState(null);
  const { currentlyReading } = state;

  function daysReading(startedAt) {
    if (!startedAt) return null;
    const start = new Date(startedAt);
    const now = new Date();
    const diff = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    if (diff === 0) return t('currentlyReading.startedToday');
    if (diff === 1) return t('currentlyReading.oneDay');
    return t('currentlyReading.nDays', { count: diff });
  }

  async function handleFinish({ rating, notes, readAt }) {
    if (!finishing) return;
    await finishReading(finishing, { rating, notes, readAt });
    setFinishing(null);
  }

  async function handleProgressSave(pagesRead) {
    if (!updatingProgress) return;
    await updateReadingProgress(updatingProgress, pagesRead);
    setUpdatingProgress(null);
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head__eyebrow">
          <a onClick={() => go('dashboard')}>{t('currentlyReading.breadcrumb')}</a> · {t('currentlyReading.eyebrow')}
        </div>
        <div className="page-header">
          <h1 className="page-head__title">{tNode('currentlyReading.pageTitle')}</h1>
          <p className="page-head__lead">
            {currentlyReading.length === 0
              ? t('currentlyReading.subtitleEmpty')
              : currentlyReading.length === 1
                ? t('currentlyReading.subtitleOne')
                : t('currentlyReading.subtitleMany', { count: currentlyReading.length })}
          </p>
        </div>
      </div>

      {currentlyReading.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">{t('currentlyReading.emptyTitle')}</div>
          <div className="empty-state-text">
            {t('currentlyReading.emptyText')}
          </div>
          <div className="lv-load-more">
            <button className="btn btn-secondary" onClick={() => go('read-next')}>{t('nav.readNext')}</button>
            <button className="btn btn-secondary" onClick={() => go('wishlist')}>{t('nav.wishlist')}</button>
          </div>
        </div>
      ) : (
        <div className="cr-grid">
          {currentlyReading.map((b) => {
            const days = daysReading(b.startedAt);
            const genres = state.genresByBookId?.[b.bookId];
            const pagesRead = b.pagesRead ?? 0;
            const pct = b.pp && pagesRead > 0 ? Math.min(100, Math.round((pagesRead / b.pp) * 100)) : null;
            return (
              <div className="cr-card" key={bookKey(b)}>
                <div
                  className="cr-cover"
                  onClick={() => onOpenBook?.(b)}

                >
                  <BookCover title={b.t} author={b.a} coverUrl={b.coverUrl} />
                </div>
                <div className="cr-info">
                  <div
                    className="cr-title"
                    onClick={() => onOpenBook?.(b)}

                  >
                    {b.t}
                  </div>
                  <div className="cr-author">{b.a}</div>
                  {genres && genres.length > 0 && (
                    <div className="li-genres cr-genres">
                      {genres.map((g) => (
                        <span key={g.genreId} className="cr-chip" title={g.description || undefined}>
                          {g.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="cr-meta">
                    {b.startedAt && (
                      <span className="cr-started">
                        Started {new Date(b.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        {days && <> · <span className="cr-days">{days}</span></>}
                      </span>
                    )}
                    {b.pp && <span className="cr-pages">{b.pp} pages</span>}
                  </div>

                  {/* Progress bar */}
                  {b.pp ? (
                    <div className="cr-progress-wrap">
                      <div className="cr-progress-bar-track">
                        <div
                          className="cr-progress-bar-fill"
                          style={{ '--cr-pct': `${pct ?? 0}%` }}
                        />
                      </div>
                      <div className="cr-progress-label">
                        {pagesRead > 0
                          ? t('currentlyReading.pagesReadPct', { read: pagesRead, total: b.pp, pct: pct ?? 0 })
                          : t('currentlyReading.pagesRead', { read: 0, total: b.pp })}
                      </div>
                    </div>
                  ) : pagesRead > 0 ? (
                    <div className="cr-progress-label">
                      {t('currentlyReading.pagesReadOnly', { count: pagesRead })}
                    </div>
                  ) : null}

                  <div className="cr-actions">
                    <button
                      className="btn-secondary"
                      onClick={() => setUpdatingProgress(b)}
                    >
                      {t('currentlyReading.updateProgress')}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setFinishing(b)}
                    >
                      {t('currentlyReading.markFinished')}
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => {
                        if (confirm(t('currentlyReading.confirmRemove', { title: b.t }))) {
                          removeFromCurrentlyReading(b);
                        }
                      }}
                    >
                      {t('currentlyReading.remove')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {finishing && (
        <RatingModal
          book={finishing}
          mode="finish"
          onSave={handleFinish}
          onSkip={() => {
            finishReading(finishing);
            setFinishing(null);
          }}
        />
      )}

      {updatingProgress && (
        <ProgressUpdateModal
          book={updatingProgress}
          onSave={handleProgressSave}
          onClose={() => setUpdatingProgress(null)}
        />
      )}
    </>
  );
}
