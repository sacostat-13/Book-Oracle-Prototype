import { useEffect, useState } from 'react';
import { RouteLink } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { fetchFamilies } from '../lib/genreService';

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
      { route: 'changelog', label: 'What’s New' },
      { route: 'oracle', label: 'The Oracle' },
      { route: 'oracle-categories', label: 'Explore by genre' },
      { route: 'oracle-similar', label: 'Find similar books' },
      { route: 'oracle-ask', label: 'Ask the Oracle' },
      { route: 'plan-list', label: 'Reading plans' },
      { route: 'book-clubs', label: 'Book clubs' },
      // v0.68: both public routes, both missing from this page since they
      // shipped. /genres especially — it is the highest-priority non-home URL
      // in the XML sitemap, and this page is where a reader (and a crawler
      // following the footer) would look for it.
      { route: 'genres-index', label: 'Browse by genre' },
      { route: 'lists-discover', label: 'Reading lists' },
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
  const t = useT();
  // The sixteen shelves, listed by name. A "Sitemap" page that names its
  // sections but not the sixteen hubs beneath them is a map with the largest
  // region left blank — and these are sixteen real links from a page Google
  // already crawls, which is the cheapest internal linking on the site.
  //
  // Degrades to nothing on failure: fetchFamilies() warns and returns [], the
  // section disappears, and the rest of the map still renders.
  const [families, setFamilies] = useState([]);
  useEffect(() => {
    let alive = true;
    fetchFamilies().then((f) => { if (alive) setFamilies(f); });
    return () => { alive = false; };
  }, []);

  useDocumentMeta({
    title: t('sitemapPage.title') || 'Sitemap — The Books Oracle',
    description: t('sitemapPage.desc') || 'A map of every section of The Books Oracle.',
  });

  return (
    <div className="about-container">
      <div className="page-head">
        <div className="page-head__eyebrow">
          <RouteLink to="dashboard">{t('about.breadcrumb') || 'Home'}</RouteLink> · {t('sitemapPage.heading') || 'Sitemap'}
        </div>
        <h1 className="page-head__title">{t('sitemapPage.heading') || 'Sitemap'}</h1>
        <p className="page-head__lead">
          {t('sitemapPage.intro') || "Everything The Books Oracle has to offer. Wishlist, library, and profile pages are personal to each reader, so you won't find those listed here — sign in to see your own."}
        </p>
      </div>
      {families.length > 0 && (
        <section className="about-section">
          <h2 className="about-section__title">
            {t('sitemapPage.section.shelves') || 'The sixteen shelves'}
          </h2>
          <ul className="legal-list">
            {families.map((f) => (
              <li className="legal-list__item" key={f.slug}>
                <RouteLink
                  to="family-page"
                  params={{ familySlug: f.slug }}
                  className="footer-link lv-hl"
                >
                  {f.name}
                </RouteLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {SECTIONS.map((section) => (
        <section className="about-section" key={section.heading}>
          <h2 className="about-section__title">
            {t(`sitemapPage.section.${section.heading}`) || section.fallbackHeading}
          </h2>
          <ul className="legal-list">
            {section.links.map((link) => (
              <li className="legal-list__item" key={link.route}>
                <RouteLink to={link.route} className="footer-link lv-hl">
                  {link.label}
                </RouteLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
