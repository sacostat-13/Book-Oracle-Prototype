import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import CurrentReleaseFooter from '../components/CurrentReleaseFooter';

// Reusable section heading + body block, styled to match Profile.jsx voice
function Section({ title, children }) {
  return (
    <section style={{ marginTop: '2rem' }}>
      <h2
        style={{
          fontFamily: 'var(--ro-font-display)',
          fontStyle: 'italic',
          fontSize: '1.6rem',
          color: 'var(--paper)',
          marginBottom: '1rem',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Paragraph({ children }) {
  return (
    <p
      style={{
        color: 'var(--paper-aged)',
        marginBottom: '1rem',
        lineHeight: 1.7,
      }}
    >
      {children}
    </p>
  );
}

function VersionEntry({ title, body }) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div
        style={{
          color: 'var(--gilt)',
          fontFamily: 'var(--ro-font-display)',
          fontStyle: 'italic',
          fontSize: '1.05rem',
          marginBottom: '0.35rem',
        }}
      >
        {title}
      </div>
      <div style={{ color: 'var(--paper-aged)', lineHeight: 1.65 }}>{body}</div>
    </div>
  );
}

function Feature({ title, children }) {
  return (
    <div
      style={{
        padding: '1.25rem 1.4rem',
        marginBottom: '1rem',
        borderLeft: '2px solid rgba(176, 140, 63, 0.35)',
        background: 'rgba(176, 140, 63, 0.04)',
        borderRadius: '0 4px 4px 0',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--ro-font-display)',
          fontStyle: 'italic',
          fontSize: '1.15rem',
          color: 'var(--paper)',
          marginBottom: '0.5rem',
        }}
      >
        {title}
      </div>
      <div style={{ color: 'var(--paper-aged)', lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function RoadmapTier({ heading, items }) {
  return (
    <div style={{ marginBottom: '1.75rem' }}>
      <div
        style={{
          fontFamily: 'var(--ro-font-mono)',
          fontSize: '0.65rem',
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: 'var(--gilt)',
          opacity: 0.7,
          marginBottom: '0.75rem',
        }}
      >
        {heading}
      </div>
      {items.map(({ title, body }, i) => (
        <div
          key={i}
          style={{
            paddingLeft: '1rem',
            borderLeft: '1px solid rgba(176, 140, 63, 0.2)',
            marginBottom: '0.85rem',
          }}
        >
          <div
            style={{
              color: 'var(--paper)',
              fontFamily: 'var(--ro-font-display)',
              fontStyle: 'italic',
              fontSize: '1.05rem',
              marginBottom: '0.2rem',
            }}
          >
            {title}
          </div>
          <div style={{ color: 'var(--paper-aged)', lineHeight: 1.65, fontSize: '0.93rem' }}>
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
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>{t('about.breadcrumb')}</a> · {t('about.eyebrow')}
      </div>

      <div className="page-header">
        <div className="page-eyebrow">{t('about.eyebrow')}</div>
        <h1 className="page-title">
          {t('about.title', {
            accent: <span className="accent">{t('about.titleAccent')}</span>,
          })}
        </h1>
        <p className="page-subtitle">{t('about.subtitle')}</p>
      </div>

      <div className="onboarding-card" style={{ maxWidth: '760px' }}>
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
            <div style={{ marginBottom: '0.75rem' }}>{t('about.featureOracleBody')}</div>
            <div style={{ marginLeft: '1rem', marginBottom: '0.75rem' }}>
              <div style={{ color: 'var(--gilt)', fontStyle: 'italic', marginBottom: '0.25rem' }}>
                {t('about.featureOracleCategoriesTitle')}
              </div>
              <div>{t('about.featureOracleCategoriesBody')}</div>
            </div>
            <div style={{ marginLeft: '1rem', marginBottom: '0.75rem' }}>
              <div style={{ color: 'var(--gilt)', fontStyle: 'italic', marginBottom: '0.25rem' }}>
                {t('about.featureOracleSimilarTitle')}
              </div>
              <div>{t('about.featureOracleSimilarBody')}</div>
            </div>
            <div style={{ marginTop: '0.75rem' }}>{t('about.featureOracleModes')}</div>
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
        <div id="pricing" style={{ scrollMarginTop: '5rem' }}>
          <Section title={t('about.pricingHeading')}>
            <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '1.5rem', opacity: 0.8 }}>
              {t('about.pricingEyebrow')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
              {/* Free */}
              <div style={{ border: '1px solid rgba(201,162,75,0.2)', borderRadius: 'var(--ro-radius-sm)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--paper-aged)' }}>{t('about.pricingFreeTitle')}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                  <span style={{ fontFamily: 'var(--ro-font-display)', fontSize: '2.4rem', color: 'var(--paper)', lineHeight: 1 }}>{t('about.pricingFreePrice')}</span>
                  <span style={{ color: 'var(--paper-aged)', fontSize: '0.85rem', opacity: 0.6 }}>{t('about.pricingFreePeriod')}</span>
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {['pricingFreeFeature1','pricingFreeFeature2','pricingFreeFeature3','pricingFreeFeature4','pricingFreeFeature5'].map((k) => (
                    <li key={k} style={{ fontSize: '0.88rem', color: 'var(--paper-aged)', display: 'flex', gap: '0.5rem' }}>
                      <span style={{ color: 'var(--gilt)', flexShrink: 0 }}>·</span>{t(`about.${k}`)}
                    </li>
                  ))}
                </ul>
              </div>
              {/* Pro */}
              <div style={{ border: '1px solid rgba(201,162,75,0.5)', borderRadius: 'var(--ro-radius-sm)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(201,162,75,0.04)' }}>
                <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)' }}>✦ {t('about.pricingProTitle')}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                  <span style={{ fontFamily: 'var(--ro-font-display)', fontSize: '2.4rem', color: 'var(--paper)', lineHeight: 1 }}>{t('about.pricingProPrice')}</span>
                  <span style={{ color: 'var(--paper-aged)', fontSize: '0.85rem', opacity: 0.6 }}>{t('about.pricingProPeriod')}</span>
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {['pricingProFeature1','pricingProFeature2','pricingProFeature3','pricingProFeature4','pricingProFeature5'].map((k) => (
                    <li key={k} style={{ fontSize: '0.88rem', color: 'var(--paper-aged)', display: 'flex', gap: '0.5rem' }}>
                      <span style={{ color: 'var(--gilt)', flexShrink: 0 }}>❦</span>{t(`about.${k}`)}
                    </li>
                  ))}
                </ul>
                <button className="btn" style={{ marginTop: '0.5rem' }} onClick={() => go('profile')}>
                  {t('about.pricingProCta')}
                </button>
              </div>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--paper-aged)', opacity: 0.5, fontStyle: 'italic' }}>
              {t('about.pricingNote')}
            </div>
          </Section>
        </div>

        {/* ── Legal ──────────────────────────────────────────────────────── */}
        <Section title={t('about.legalHeading')}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            {[['privacy', t('about.privacyLink')], ['terms', t('about.termsLink')], ['refund', t('about.refundLink')]].map(([route, label]) => (
              <a key={route} onClick={() => go(route)} style={{ color: 'var(--gilt)', cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'none', borderBottom: '1px solid rgba(201,162,75,0.3)', paddingBottom: '1px' }}>
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
