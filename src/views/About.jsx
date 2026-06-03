import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';

// Reusable section heading + body block, styled to match Profile.jsx voice
function Section({ title, children }) {
  return (
    <section style={{ marginTop: '2rem' }}>
      <h2
        style={{
          fontFamily: "'Cormorant Garamond', serif",
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
          fontFamily: "'Cormorant Garamond', serif",
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
          fontFamily: "'Cormorant Garamond', serif",
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

export default function About() {
  const { go } = useRouter();
  const t = useT();

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

          <Feature title={t('about.featureDashboardTitle')}>
            {t('about.featureDashboardBody')}
          </Feature>
        </Section>

        <Section title={t('about.roadmapHeading')}>
          <Paragraph>{t('about.roadmapBody')}</Paragraph>
          <ul style={{ color: 'var(--paper-aged)', lineHeight: 1.75, paddingLeft: '1.25rem' }}>
            <li>{t('about.roadmapItem1')}</li>
            <li>{t('about.roadmapItem2')}</li>
            <li>{t('about.roadmapItem3')}</li>
            <li>{t('about.roadmapItem4')}</li>
          </ul>
        </Section>

        <Section title={t('about.feedbackHeading')}>
          <Paragraph>{t('about.feedbackBody')}</Paragraph>
        </Section>
      </div>
    </>
  );
}
