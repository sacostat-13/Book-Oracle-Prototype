// GoodreadsImportPanel — direct shelf import by profile ID.
//
// Replaces the CSV upload as the PRIMARY import route. The CSV path is not
// removed: it remains the only option for readers whose Goodreads profile is
// private, and is rendered beneath this panel as a fallback by the caller.
//
// The win here is not "no file upload" — it's skipping the Goodreads export
// queue, which is asynchronous and can take hours. That wait is where readers
// leave onboarding and don't come back.
//
// This panel never writes to Supabase. It hands parsed shelves up via
// onImported, so it behaves identically inside onboarding (deferred write on
// finish) and inside Profile (write immediately).
//
// v0.59

import { useState } from 'react';
import { useT } from '../lib/I18nContext';
import { extractGoodreadsId, fetchGoodreadsShelves, importErrorKey } from '../lib/goodreadsRss';

export default function GoodreadsImportPanel({ onImported, disabled }) {
  const t = useT();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('idle'); // idle | working | done | error
  const [errorKey, setErrorKey] = useState(null);
  const [stage, setStage] = useState(null);
  const [result, setResult] = useState(null);

  const detectedId = extractGoodreadsId(input);
  const canSubmit = !!detectedId && status !== 'working' && !disabled;

  async function run() {
    if (!canSubmit) return;
    setStatus('working');
    setErrorKey(null);
    setResult(null);

    const shelves = await fetchGoodreadsShelves(detectedId, setStage);
    setStage(null);

    if (shelves.error) {
      setErrorKey(importErrorKey(shelves.error));
      setStatus('error');
      return;
    }

    const total =
      shelves.read.length + shelves.toRead.length + shelves.currentlyReading.length;

    if (total === 0) {
      setErrorKey('onboarding.import.empty');
      setStatus('error');
      return;
    }

    setResult({ ...shelves, total });
    setStatus('done');
    onImported?.({ ...shelves, goodreadsId: detectedId });
  }

  return (
    <div className="gr-import">
      <label className="gr-import-label" htmlFor="gr-id">
        {t('onboarding.import.title')}
      </label>
      <p className="gr-import-desc">{t('onboarding.import.body')}</p>

      <div className="gr-import-row">
        <input
          id="gr-id"
          type="text"
          className="gr-import-input"
          placeholder={t('onboarding.import.placeholder')}
          value={input}
          disabled={status === 'working' || disabled}
          onChange={(e) => {
            setInput(e.target.value);
            if (status === 'error') { setStatus('idle'); setErrorKey(null); }
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          aria-describedby="gr-import-status"
        />
        <button className="btn-primary" onClick={run} disabled={!canSubmit}>
          {status === 'working' ? t('onboarding.import.working') : t('onboarding.import.cta')}
        </button>
      </div>

      {/* Live region: import outcomes must reach screen readers, since the
          visual feedback here is the entire substance of the step. */}
      <div id="gr-import-status" className="gr-import-status" role="status" aria-live="polite">
        {status === 'idle' && detectedId && (
          <span className="gr-import-ok">{t('onboarding.import.found')}</span>
        )}
        {status === 'idle' && input.trim() && !detectedId && (
          <span className="gr-import-err">{t('onboarding.import.badId')}</span>
        )}
        {status === 'working' && stage && (
          <span className="gr-import-working">
            {t(`onboarding.import.shelf.${stage.shelf}`)} ({stage.index + 1}/{stage.total})
          </span>
        )}
        {status === 'error' && <span className="gr-import-err">{t(errorKey)}</span>}
        {status === 'done' && result && (
          <span className="gr-import-ok">
            {t('onboarding.import.done', { count: result.total })}
            {result.truncated ? ' ' + t('onboarding.import.truncated') : ''}
          </span>
        )}
      </div>

      <details className="gr-import-help">
        <summary>{t('onboarding.import.whereIsId')}</summary>
        <p>{t('onboarding.import.whereIsIdBody')}</p>
      </details>
    </div>
  );
}
