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
      <div
        style={{
          marginTop: '3rem',
          paddingTop: '1.6rem',
          borderTop: '1px dotted rgba(176, 140, 63, 0.25)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '0.7rem',
            marginBottom: '0.4rem',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontFamily: "'Special Elite', monospace",
              fontSize: '0.75rem',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--gilt)',
            }}
          >
            {current.version}
            {' · '}
            {t('releaseNotes.currentVersion')}
          </span>
        </div>
        <div
          style={{
            color: 'var(--paper)',
            fontFamily: "'Cormorant Garamond', serif",
            fontStyle: 'italic',
            fontSize: '1.15rem',
            marginBottom: '0.8rem',
          }}
        >
          {title}
        </div>
        <button
          onClick={() => setOpen(true)}
          className="btn btn-ghost"
          style={{ fontSize: '0.85rem' }}
        >
          {t('releaseNotes.seeAllReleases')}
        </button>
      </div>

      {open && <ReleaseNotesModal onClose={() => setOpen(false)} />}
    </>
  );
}
