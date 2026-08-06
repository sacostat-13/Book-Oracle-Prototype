// ImportProgressToast — global, fixed-position progress for a running import.
//
// Rendered once in App.jsx, outside the router, so it survives every view
// change: onboarding → dashboard, dashboard → profile, anywhere. That is the
// whole point. The previous progress UI lived inside Onboarding, which App
// unmounts the instant setOnboarded(true) lands — so it vanished a second
// after the import began and the reader was left watching nothing happen for
// three minutes.
//
// Two states:
//   writing — a determinate bar. Cannot be dismissed; there is nothing to
//             decide yet and hiding it would recreate the original problem.
//   done    — sticky confirmation. Does NOT auto-dismiss. This is the only
//             signal the reader gets that a multi-minute job finished, so it
//             waits for an explicit acknowledgement.
//
// v0.59

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import ImportCompleteModal from './ImportCompleteModal';

export default function ImportProgressToast() {
  const { importJob, dismissImportJob } = useData();
  const t = useT();
  const [showModal, setShowModal] = useState(false);

  if (!importJob) return null;

  const { phase, done, total, added } = importJob;
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const isDone = phase === 'done';

  return (
    <>
      <div
        className={`import-toast ${isDone ? 'import-toast--done' : ''}`}
        role="status"
        aria-live="polite"
      >
        <div className="import-toast__body">
          <div className="import-toast__title">
            {isDone ? t('onboarding.import.readyTitle') : t('onboarding.import.savingTitle')}
          </div>

          {isDone ? (
            <div className="import-toast__sub">
              {/* added === 0 means every book was already on the shelves —
                  a re-import, or a second run of onboarding. Saying "0 books
                  added" reads as a failure; say what actually happened. */}
              {added > 0
                ? t('onboarding.import.readyBody', { count: added })
                : t('onboarding.import.readyNothingNew')}
            </div>
          ) : (
            <>
              <div className="import-toast__sub">
                {t('onboarding.import.saving', { done, total })}
              </div>
              <div className="import-toast__track">
                <div className="import-toast__fill" style={{ width: `${pct}%` }} />
              </div>
              {/* Says "keep using the app", not "leave this open" — now true. */}
              <div className="import-toast__note">{t('onboarding.import.keepBrowsing')}</div>
            </>
          )}
        </div>

        {isDone && (
          <div className="import-toast__actions">
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              {t('onboarding.import.readyCta')}
            </button>
            <button
              className="import-toast__dismiss"
              onClick={dismissImportJob}
              aria-label={t('onboarding.import.dismiss')}
            >
              ×
            </button>
          </div>
        )}
      </div>

      {showModal && (
        <ImportCompleteModal
          count={added}
          onClose={() => { setShowModal(false); dismissImportJob(); }}
        />
      )}
    </>
  );
}
