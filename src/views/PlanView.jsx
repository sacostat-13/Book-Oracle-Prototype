import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { ALL_BOOKS, bookKey, findBookByTitle } from '../lib/bookHelpers';
import { useI18n } from '../lib/I18nContext';

export default function PlanView() {
  const { state, addToReadNext, markAsRead, setCurrentPlan, showToast } = useData();
  const { go } = useRouter();
  const { lang } = useI18n();
  const isSpanish = lang === 'es';
  const plan = state.currentPlan;
  const { genresByBookId } = state;

  if (!plan) {
    return (
      <>
        <div className="breadcrumb">
          <a onClick={() => go('dashboard')}>Dashboard</a> · Your Reading Plan
        </div>
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">No active plan</div>
          <div className="empty-state-text">Create one from the dashboard.</div>
          <div style={{ marginTop: '1.5rem' }}>
            <button className="btn" onClick={() => go('plan-create')}>Create a plan</button>
          </div>
        </div>
      </>
    );
  }

  function addAllToQueue() {
    let added = 0;
    for (const b of plan.books) {
      const found = findBookByTitle(b.title || b.t, state.wishlist) || { t: b.title || b.t, a: b.author || b.a };
      const k = bookKey(found);
      if (
        !state.library.some((l) => bookKey(l) === k) &&
        !state.readNext.some((l) => bookKey(l) === k)
      ) {
        addToReadNext(found);
        added++;
      }
    }
    showToast(`Added ${added} books to Read Next`);
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · Reading Plan
      </div>
      <div className="page-header">
        <div className="page-eyebrow">Your Reading Plan</div>
        <h1 className="page-title">{plan.title}</h1>
        <p className="page-subtitle">{plan.intro || ''}</p>
      </div>

      <div style={{ marginBottom: '2rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {plan.type === 'series' && plan.seriesName && (
          <button
            className="btn"
            onClick={() => go('series-page', { seriesName: plan.seriesName, from: 'plan-view', fromLabel: isSpanish ? 'Plan' : 'Reading Plan' })}
          >
            {isSpanish ? 'Abrir saga ↗' : 'Open Series ↗'}
          </button>
        )}
        <button className="btn btn-gilt" onClick={addAllToQueue}>{isSpanish ? 'Agregar todo a la cola' : 'Add all to Read Next'}</button>
        <button className="btn btn-ghost" onClick={() => go('plan-create')}>{isSpanish ? 'Crear otro plan' : 'Create a different plan'}</button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (confirm('Delete this reading plan?')) {
              setCurrentPlan(null);
              go('dashboard');
            }
          }}
        >
          Delete this plan
        </button>
      </div>

      <div>
        {plan.books.map((b, i) => {
          const found = findBookByTitle(b.title || b.t, state.wishlist) ||
            { t: b.title || b.t, a: b.author || b.a, d: b.description || '' };
          const pages = b.pp || found.pp || null;
          const k = bookKey(found);
          const isRead = state.library.some((l) => bookKey(l) === k);
          const isQueued = state.readNext.some((l) => bookKey(l) === k);
          return (
            <div className="plan-step" key={i}>
              <div className="plan-month">Month {b.month || i + 1}</div>
              <div>
                <div className="plan-book">{found.t}</div>
                <div className="plan-author">
                  {found.a}
                  {pages && (
                    <> · <span style={{ color: 'var(--paper-aged)', opacity: 0.7, fontSize: '0.9rem' }}>
                      ~{pages} pages
                    </span></>
                  )}
                </div>
                <div className="plan-reason">{b.reason || found.d || ''}</div>
                    {(() => {
                      const genres = genresByBookId[found.bookId];
                      return genres && genres.length > 0 ? (
                        <div className="li-genres" style={{ marginTop: '0.5rem' }}>
                          {genres.map((g) => <span key={g.genreId} className="li-genre-pill" title={g.description || undefined}>{g.name}</span>)}
                        </div>
                      ) : null;
                    })()}
                <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {isRead ? (
                    <span className="level-pill" style={{ background: 'var(--moss)', color: 'var(--paper)', borderColor: 'var(--moss)' }}>
                      ✓ Read
                    </span>
                  ) : isQueued ? (
                    <span className="level-pill">✓ Queued</span>
                  ) : (
                    <>
                      <button className="li-action" onClick={() => addToReadNext(found)}>+ Add to Read Next</button>
                      <button className="li-action success" onClick={() => markAsRead(found)}>✓ Mark as Read</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
