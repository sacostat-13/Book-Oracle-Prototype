import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import CurrentReleaseFooter from '../components/CurrentReleaseFooter';

// Reusable section heading + body block, styled to match Profile.jsx voice
function Section({ title, children }) {
  return (
    <section className="about-section"><h2 className="about-section__title">{title}</h2>
      {children}
    </section>
  );
}

function Paragraph({ children }) {
  return (
    <p className="about-section__body">
      {children}
    </p>
  );
}

function VersionEntry({ title, body }) {
  return (
    <div className="about-section">
      <div
        className="about-section__title" style={{ fontSize: "1.05rem" }}
      >
        {title}
      </div>
      <div className="about-section__body">{body}</div>
    </div>
  );
}

function Feature({ title, children }) {
  return (
    <div className="session-prompt">
      <div
        className="session-prompt__label" style={{ fontSize: "1.15rem", fontFamily: "var(--ro-font-display)", fontStyle: "italic" }}
      >
        {title}
      </div>
      <div className="session-prompt__text">{children}</div>
    </div>
  );
}

function RoadmapTier({ heading, items }) {
  return (
    <div className="about-section">
      <div
        className="pf-overline pf-overline--gold" style={{ opacity: .7 }}
      >
        {heading}
      </div>
      {items.map(({ title, body }, i) => (
        <div
          key={i} className="legal-list__item" style={{ flexDirection: "column" }}
        >
          <div
            className="session-card__title"
          >
            {title}
          </div>
          <div className="about-section__body" style={{ fontSize: "0.93rem" }}>
            {body}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function About() {
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();

  return (
    <>


      <div className="page-header">
        <div className="page-head__eyebrow">
          <a onClick={() => go('dashboard')}>{t('about.breadcrumb')}</a> · {t('about.eyebrow')}
        </div>
        <h1 className="page-head__title">
          {t('about.eyebrow', {
            accent: <span className="accent">{t('about.titleAccent')}</span>,
          })}
        </h1>
        <p className="page-head__lead">{t('about.subtitle')}</p>
      </div>

      <div className="about-container">
        <Section title={t('about.originHeading')}>
          <Paragraph>{t('about.originBody1')}</Paragraph>
          <Paragraph>{t('about.originBody2')}</Paragraph>
          <Paragraph>{t('about.originBody3')}</Paragraph>
        </Section>

        <Section title={t('about.evolutionHeading')}>
          <VersionEntry
            title={t('about.evolutionItem1Title')}
            body={t('about.evolutionItem1Body')}
          />
          <VersionEntry
            title={t('about.evolutionItem2Title')}
            body={t('about.evolutionItem2Body')}
          />
          <VersionEntry
            title={t('about.evolutionItem3Title')}
            body={t('about.evolutionItem3Body')}
          />
        </Section>

        <Section title={t('about.featuresHeading')}>
          <Paragraph>{t('about.featuresIntro')}</Paragraph>

          <Feature title={t('about.featureWishlistTitle')}>
            {t('about.featureWishlistBody')}
          </Feature>

          <Feature title={t('about.featureLibraryTitle')}>
            {t('about.featureLibraryBody')}
          </Feature>

          <Feature title={t('about.featureReadNextTitle')}>
            {t('about.featureReadNextBody')}
          </Feature>

          <Feature title={t('about.featureCurrentlyReadingTitle')}>
            {t('about.featureCurrentlyReadingBody')}
          </Feature>

          <Feature title={t('about.featureOracleTitle')}>
            <div className="about-section__body">{t('about.featureOracleBody')}</div>
            <div className="plan-step-eyebrow">
              <div className="session-section-label">
                {t('about.featureOracleCategoriesTitle')}
              </div>
              <div>{t('about.featureOracleCategoriesBody')}</div>
            </div>
            <div className="plan-step-eyebrow">
              <div className="session-section-label">
                {t('about.featureOracleSimilarTitle')}
              </div>
              <div>{t('about.featureOracleSimilarBody')}</div>
            </div>
            <div >{t('about.featureOracleModes')}</div>
          </Feature>

          <Feature title={t('about.featurePlansTitle')}>
            {t('about.featurePlansBody')}
          </Feature>

          <Feature title={t('about.featureListsTitle')}>
            {t('about.featureListsBody')}
          </Feature>

          <Feature title={t('about.featureClubsTitle')}>
            {t('about.featureClubsBody')}
          </Feature>

          <Feature title={t('about.featureDiscussionTitle')}>
            {t('about.featureDiscussionBody')}
          </Feature>

          <Feature title={t('about.featureDashboardTitle')}>
            {t('about.featureDashboardBody')}
          </Feature>
        </Section>

        <Section title={t('about.roadmapHeading')}>
          <Paragraph>{t('about.roadmapBody')}</Paragraph>

          <RoadmapTier
            heading={t('about.roadmapTierNearHeading')}
            items={[
              { title: t('about.roadmapTierNear1Title'), body: t('about.roadmapTierNear1Body') },
              { title: t('about.roadmapTierNear2Title'), body: t('about.roadmapTierNear2Body') },
              { title: t('about.roadmapTierNear3Title'), body: t('about.roadmapTierNear3Body') },
            ]}
          />

          <RoadmapTier
            heading={t('about.roadmapTierMedHeading')}
            items={[
              { title: t('about.roadmapTierMed1Title'), body: t('about.roadmapTierMed1Body') },
              { title: t('about.roadmapTierMed2Title'), body: t('about.roadmapTierMed2Body') },
              { title: t('about.roadmapTierMed3Title'), body: t('about.roadmapTierMed3Body') },
            ]}
          />

          <RoadmapTier
            heading={t('about.roadmapTierFutureHeading')}
            items={[
              { title: t('about.roadmapTierFuture1Title'), body: t('about.roadmapTierFuture1Body') },
              { title: t('about.roadmapTierFuture2Title'), body: t('about.roadmapTierFuture2Body') },
              { title: t('about.roadmapTierFuture3Title'), body: t('about.roadmapTierFuture3Body') },
            ]}
          />
        </Section>

        <Section title={t('about.feedbackHeading')}>
          <Paragraph>{t('about.feedbackBody')}</Paragraph>
        </Section>

        {/* ── Pricing ────────────────────────────────────────────────────── */}
        <div id="pricing" style={{ scrollMarginTop: "5rem" }}>
          <Section title={t('about.pricingHeading')}>
            <div className="pf-overline pf-overline--gold" style={{ opacity: .8 }}>
              {t('about.pricingEyebrow')}
            </div>
            <div className="about-credits-grid">
              {/* Free */}
              <div className="about-credit-card">
                <div className="pf-overline">{t('about.pricingFreeTitle')}</div>
                <div className="pf-author-line">
                  <span className="pf-stat-value" style={{ fontSize: "2.4rem" }}>{t('about.pricingFreePrice')}</span>
                  <span className="pf-author-count">{t('about.pricingFreePeriod')}</span>
                </div>
                <ul className="legal-list">
                  {['pricingFreeFeature1', 'pricingFreeFeature2', 'pricingFreeFeature3', 'pricingFreeFeature4', 'pricingFreeFeature5'].map((k) => (
                    <li key={k} className="legal-list__item">
                      <span className="lv-hl" style={{ flexShrink: 0 }}>·</span>{t(`about.${k}`)}
                    </li>
                  ))}
                </ul>
              </div>
              {/* Pro */}
              <div className="about-credit-card" style={{ borderColor: "var(--ro-gold)" }}>
                <div className="pf-overline pf-overline--gold">✦ {t('about.pricingProTitle')}</div>
                <div className="pf-author-line">
                  <span className="pf-stat-value" style={{ fontSize: "2.4rem" }}>{t('about.pricingProPrice')}</span>
                  <span className="pf-author-count">{t('about.pricingProPeriod')}</span>
                </div>
                <ul className="legal-list">
                  {['pricingProFeature1', 'pricingProFeature2', 'pricingProFeature3', 'pricingProFeature4', 'pricingProFeature5'].map((k) => (
                    <li key={k} className="legal-list__item">
                      <span className="lv-hl" style={{ flexShrink: 0 }}>❦</span>{t(`about.${k}`)}
                    </li>
                  ))}
                </ul>
                <button className="btn-primary" style={{ marginTop: "0.5rem" }} onClick={() => go('profile')}>
                  {t('about.pricingProCta')}
                </button>
              </div>
            </div>
            <div className="about-section__body" style={{ fontSize: "0.78rem", opacity: .5 }}>
              {t('about.pricingNote')}
            </div>
          </Section>
        </div>

        {/* ── Legal ──────────────────────────────────────────────────────── */}
        <Section title={t('about.legalHeading')}>
          <div className="about-links">
            {[['privacy', t('about.privacyLink')], ['terms', t('about.termsLink')], ['refund', t('about.refundLink')]].map(([route, label]) => (
              <a key={route} onClick={() => go(route)} className="footer-link lv-hl">
                {label}
              </a>
            ))}
          </div>
        </Section>

        {/* v0.13: current version + "what's new" entry point. The footer
            keeps its own state for the modal; About stays simple. The
            content is fully bilingual via i18n, sourced from releases.js. */}
        <CurrentReleaseFooter />
      </div>
    </>
  );
}
