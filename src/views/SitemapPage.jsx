import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';

// A plain link list, grouped. Deliberately excludes personal/auth-gated
// views (wishlist, library, currently-reading, profile settings) — those
// are per-user data, not stable pages worth listing on a public map or
// pointing crawlers at. This lists app *sections* instead, so it still
// works as a useful "what's in here" page for a signed-out visitor.
const SECTIONS = [
  {
    heading: 'explore',
    fallbackHeading: 'Explore',
    links: [
      { route: 'dashboard', label: 'Home' },
      { route: 'about', label: 'About' },
      { route: 'oracle', label: 'The Oracle' },
      { route: 'oracle-categories', label: 'Explore by genre' },
      { route: 'oracle-similar', label: 'Find similar books' },
      { route: 'oracle-ask', label: 'Ask the Oracle' },
      { route: 'plan-list', label: 'Reading plans' },
      { route: 'book-clubs', label: 'Book clubs' },
    ],
  },
  {
    heading: 'legal',
    fallbackHeading: 'Legal',
    links: [
      { route: 'privacy', label: 'Privacy Policy' },
      { route: 'terms', label: 'Terms of Service' },
      { route: 'refund', label: 'Refund Policy' },
    ],
  },
];

export default function SitemapPage() {
  const { go } = useRouter();
  const t = useT();

  useDocumentMeta({
    title: t('sitemapPage.title') || 'Sitemap — The Books Oracle',
    description: t('sitemapPage.desc') || 'A map of every section of The Books Oracle.',
  });

  return (
    <div className="about-container">
      <div className="page-head">
        <div className="page-head__eyebrow">
          <a onClick={() => go('dashboard')}>{t('about.breadcrumb') || 'Home'}</a> · {t('sitemapPage.heading') || 'Sitemap'}
        </div>
        <h1 className="page-head__title">{t('sitemapPage.heading') || 'Sitemap'}</h1>
        <p className="page-head__lead">
          {t('sitemapPage.intro') || "Everything The Books Oracle has to offer. Wishlist, library, and profile pages are personal to each reader, so you won't find those listed here — sign in to see your own."}
        </p>
      </div>
      {SECTIONS.map((section) => (
        <section className="about-section" key={section.heading}>
          <h2 className="about-section__title">
            {t(`sitemapPage.section.${section.heading}`) || section.fallbackHeading}
          </h2>
          <ul className="legal-list">
            {section.links.map((link) => (
              <li className="legal-list__item" key={link.route}>
                <button className="footer-link lv-hl" onClick={() => go(link.route)}>
                  {link.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
