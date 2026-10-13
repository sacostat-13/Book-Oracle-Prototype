// src/views/profile/AccountTab.jsx — Profile's Account tab: identity, reading
// preferences, avatar and title, the Goodreads import, install, and reset.

import { useRef } from 'react';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter } from '../../contexts/RouterContext';
import { useT } from '../../contexts/I18nContext';
import { parseGoodreadsCSV } from '../../lib/sources/goodreadsImport';
import { findBookByTitle } from '../../lib/book/bookHelpers';
import { titleLabel } from '../../lib/achievements/readerRanks';
import GoodreadsImportPanel from '../../components/GoodreadsImportPanel';
import ReaderSettings from '../../components/ReaderSettings';
import InstallAppSection from '../../components/InstallAppSection';
import { useConfirm } from '../../components/primitives/ConfirmDialog';
import UsernameSection from './sections/UsernameSection';
import AvatarSection from './sections/AvatarSection';
import TitlesSection from './sections/TitlesSection';
import PasswordSection from './sections/PasswordSection';
import DisplayNameSection from './sections/DisplayNameSection';
import ReaderPrefsSection from './sections/ReaderPrefsSection';

export default function AccountTab() {
  const { state, resetAll, importGoodreads, runGoodreadsImport, showToast, updateUsername, updateDisplayName, updateAvatar, setProfile } = useData();
  const { user } = useAuth();
  const { go } = useRouter();
  const t = useT();
  const confirm = useConfirm();
  const fileRef = useRef(null);

  async function handleReimport(file) {
    try {
      const text = await file.text();
      const books = parseGoodreadsCSV(text);
      if (books.length === 0) {
        showToast(t('profile.csvErrorNoBooks'), true);
        return;
      }
      const enriched = books.map((gb) => {
        const match = findBookByTitle(gb.t);
        return match ? { ...match, ...gb } : { ...gb, g: 'Imported' };
      });
      await importGoodreads(enriched);
    } catch {
      showToast(t('profile.csvReadError'), true);
    }
  }

  // v0.59: same shared job as onboarding. Progress and the completion
  // notice are rendered globally by ImportProgressToast, so the reader can
  // navigate away mid-import and still see where it got to.
  function handleRssReimport({ read, toRead, currentlyReading }) {
    const enrich = (gb) => {
      const match = findBookByTitle(gb.t);
      return match ? { ...match, ...gb } : { ...gb, g: 'Imported' };
    };
    runGoodreadsImport({ read, toRead, currentlyReading }, enrich);
  }

  return (
    <>
        {user && (
          <>
            <h2 className="pf-section__title">
              {t('profile.sectionAccount')}
            </h2>
            <p className="pf-text">
              {state.profile.displayName || user.email}
              {titleLabel(state.profile.displayTitle, t) && (
                <>
                  <br />
                  <span className="reader-title">{titleLabel(state.profile.displayTitle, t)}</span>
                </>
              )}
              <br />
              <span className="lv-hl">
                {t('profile.accountSynced')}
              </span>
            </p>
          </>
        )}

        <UsernameSection profile={state.profile} user={user} updateUsername={updateUsername} t={t} />
        <DisplayNameSection profile={state.profile} updateDisplayName={updateDisplayName} t={t} />
        <PasswordSection user={user} showToast={showToast} t={t} />
        <ReaderPrefsSection state={state} setProfile={setProfile} t={t} />
        {/* v0.66: "About you" and the curator request. Filed here rather than
            under Privacy — a bio is identity, and it sits with the username,
            display name and favourite genres it will be read alongside. */}
        {user && <ReaderSettings section="identity" />}
        {user && <AvatarSection state={state} user={user} updateAvatar={updateAvatar} showToast={showToast} t={t} />}
        <TitlesSection state={state} setProfile={setProfile} t={t} />

        <div className="pf-section" id="pf-library">
        <h2 className="pf-section__title">
          {t('profile.labelLibrary')}
        </h2>
        <p className="pf-text">
          {t('profile.librarySummary', { books: state.library.length, queued: state.readNext.length })}
          {state.profile.goodreadsImported && (
            <><br /><span className="lv-hl">{t('profile.goodreadsImported')}</span></>
          )}
        </p>

        {/* v0.59: Goodreads import lives here now, and here only — the CSV
            tabs were removed from the Library and Wishlist bulk-import
            modals. Direct import is primary; CSV stays folded away beneath it
            because it is still the only route for a private profile. */}
        <div id="pf-goodreads">
          <GoodreadsImportPanel onImported={handleRssReimport} />

          <details className="gr-csv-fallback">
            <summary>{t('onboarding.import.csvFallback')}</summary>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files[0];
                if (f) handleReimport(f);
              }}
            />
            <button
              className="btn-secondary"
             
              onClick={() => fileRef.current?.click()}
            >
              {state.profile.goodreadsImported
                ? t('profile.reimportGoodreads') : t('profile.importGoodreads')}
            </button>
          </details>
        </div>
        </div>

        {/* Install to home screen — Profile only for now. */}
        <InstallAppSection />

        {/* ── Danger zone — lives at the bottom of the Account tab ─────────── */}
        <div className="pf-section">
          <button
            className="btn-danger"
            onClick={async () => {
              if (await confirm({ message: t('profile.confirmReset'), confirmLabel: t('profile.resetProfile'), danger: true })) {
                resetAll();
                go('dashboard');
              }
            }}
          >
            {t('profile.resetProfile')}
          </button>
        </div>
    </>
  );
}
