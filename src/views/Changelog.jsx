// src/views/Changelog.jsx — v0.46
//
// Public, indexable changelog (docs/feature-discovery-v1-spec.md, Move 3).
// The same bilingual content as the ReleaseNotesModal, but on its own crawlable
// route (/changelog) with real per-version headings — an SEO asset that
// captures product- and feature-name searches, rather than a modal buried in
// About. No login required; reads straight from releases.js.

import { useRouter } from '../lib/RouterContext';
import { useI18n, useT } from '../lib/I18nContext';
import { publishedReleases, CURRENT_VERSION } from '../lib/releases';

export default function Changelog() {
  const { go } = useRouter();
  const { lang } = useI18n();
  const t = useT();
  const isSpanish = lang === 'es';
  const releases = publishedReleases();

  return (
    <>
      <div className="page-head">
        <div className="page-head__eyebrow">
          <a onClick={() => go('dashboard')}>{t('changelog.breadcrumb')}</a> · {t('changelog.eyebrow')}
        </div>
        <h1 className="page-head__title">{t('changelog.pageTitle')}</h1>
        <p className="page-head__lead">{t('changelog.subtitle')}</p>
      </div>

      <div className="changelog-list">
        {releases.map((r) => {
          const title = isSpanish ? r.titleEs : r.titleEn;
          const body = isSpanish ? r.bodyEs : r.bodyEn;
          const isCurrent = r.version === CURRENT_VERSION;
          return (
            <section className="rn-section" key={r.version}>
              <div className="pf-username-row">
                <span className={`rn-version${isCurrent ? ' club-card__badge club-card__badge--active' : ''}`}>
                  {r.version}
                </span>
                {isCurrent && (
                  <span className="rn-version">{t('releaseNotes.currentBadge')}</span>
                )}
                {r.date && (
                  <span className="pf-overline pf-overline--inline">{r.date}</span>
                )}
              </div>
              <h2 className="pf-account-card__section-title">{title}</h2>
              <ul className="legal-list">
                {body.map((line, i) => (
                  <li key={i} className="legal-list__item">{line}</li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
