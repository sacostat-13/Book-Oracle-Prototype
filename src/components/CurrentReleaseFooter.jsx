import { useState } from 'react';
import { useI18n } from '../lib/I18nContext';
import { publishedReleases, CURRENT_VERSION } from '../lib/releases';
import { useT } from '../lib/I18nContext';

import ReleaseNotesModal from './ReleaseNotesModal';

// Small block intended for the bottom of the About page. Shows the current
// version and a brief teaser of the latest release, with a "See all" button
// that opens the full release-notes modal.
//
// Visual weight is deliberately light — this is wayfinding, not the main
// content of the page. A dotted gilt rule above keeps it distinct from the
// "Feedback" section that precedes it.
export default function CurrentReleaseFooter() {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const t = useT();

  const releases = publishedReleases();
  const current = releases.find((r) => r.version === CURRENT_VERSION) || releases[0];
  if (!current) return null;

  const title = t('releaseNotes.changelog');

  return (
    <>
      <div className="release-footer" style={{ marginTop: "3rem", paddingTop: "1.6rem", border: "none", borderTop: "1px dotted var(--ro-border)" }}>
        <div className="pf-username-row">
          <span className="session-section-label" style={{ marginBottom: 0 }}>
            {current.version}
            {' · '}
            {t('releaseNotes.currentVersion')}
          </span>
        </div>
        <div className="session-card__title">
          {title}
        </div>
        <button
          onClick={() => setOpen(true)}
          className="btn-tertiary btn--sm"
        >
          {t('releaseNotes.seeAllReleases')}
        </button>
      </div>

      {open && <ReleaseNotesModal onClose={() => setOpen(false)} />}
    </>
  );
}
