import { useState } from 'react';
import { useT } from '../lib/I18nContext';
import { useInstallPrompt } from '../lib/installPrompt';

// "Keep the Oracle within reach" — Profile → Account.
// Renders one of four states; see useInstallPrompt for what each means.
export default function InstallAppSection() {
  const t = useT();
  const { status, install } = useInstallPrompt();
  const [busy, setBusy] = useState(false);

  return (
    <div className="pf-section" id="pf-install">
      <h2 className="pf-section__title">{t('profile.installTitle')}</h2>
      <p className="pf-section__hint">{t('profile.installHint')}</p>

      {status === 'installed' && (
        <p className="pf-text"><span className="lv-hl">{t('profile.installDone')}</span></p>
      )}

      {status === 'available' && (
        <div>
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await install(); } finally { setBusy(false); }
            }}
          >
            {t('profile.installButton')}
          </button>
        </div>
      )}

      {status === 'ios' && (
        <ol className="pf-install-steps">
          <li>{t('profile.installIosStep1')}</li>
          <li>{t('profile.installIosStep2')}</li>
          <li>{t('profile.installIosStep3')}</li>
        </ol>
      )}

      {status === 'unsupported' && (
        <p className="pf-text">{t('profile.installUnsupported')}</p>
      )}
    </div>
  );
}
