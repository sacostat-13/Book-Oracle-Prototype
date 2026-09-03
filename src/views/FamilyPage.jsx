// FamilyPage.jsx — /genres/:familySlug
//
// The missing middle. A reader picks Gothic, sees its seven genres with their
// descriptions, and chooses. Three jobs, one page: browse entry point, the
// Ledger's drill-down target, and the canonical thing a family share card
// points at.
//
// Public and prerendered — see the note in GenresIndex.jsx.

import { useEffect, useState } from 'react';
import { useRouter, RouteLink } from '../lib/RouterContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { fetchFamily } from '../lib/genreService';

export default function FamilyPage() {
  const { route } = useRouter();
  const slug = route.params?.familySlug;
  const [family, setFamily] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchFamily(slug).then((f) => { if (alive) { setFamily(f); setLoading(false); } });
    return () => { alive = false; };
  }, [slug]);

  useDocumentMeta(
    family
      ? {
          title: `${family.name} — The Books Oracle`,
          description: family.description
            ? `${family.description} Every genre on the ${family.name} shelf.`
            : `Every genre on the ${family.name} shelf.`,
        }
      : { title: 'Browse by Genre — The Books Oracle' }
  );

  if (loading) return <div className="container"><div className="fp-empty">Reading the shelf…</div></div>;
  if (!family) {
    return (
      <div className="container">
        <div className="fp-empty">
          No such shelf. <RouteLink to="genres-index">See all sixteen</RouteLink>.
        </div>
      </div>
    );
  }

  return (
    <div className="container family-page">
      <div className="page-head">
        <div className="page-head__eyebrow">
          <RouteLink to="genres-index">Browse</RouteLink>
        </div>
        <h1 className="page-head__title">{family.name}</h1>
        {family.description && <p className="page-head__sub">{family.description}</p>}
      </div>

      <div className="genre-list">
        {family.genres.map((g) => (
          <RouteLink
            key={g.normalized_name}
            to="genre-page"
            params={{ genreSlug: g.normalized_name }}
            className="genre-list__row"
          >
            <span className="genre-list__name">☩ {g.name}</span>
            {g.description && <span className="genre-list__desc">{g.description}</span>}
          </RouteLink>
        ))}
      </div>
    </div>
  );
}
