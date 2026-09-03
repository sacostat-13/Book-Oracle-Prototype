// GenresIndex.jsx — /genres
//
// The sixteen families, and the entry point for a reader who does not yet know
// what they want. Replaces nothing: before this there was no genre route at
// all. Genre pills on book cards had a cursor and no href, and no genre or
// family URL appeared in the sitemap or anywhere in the app.
//
// PUBLIC AND PRERENDERED. Everything here reads `genres` and `genre_families`,
// both granted to anon, and nothing touches user state — so the logged-out
// render is the complete page. That is not a nicety: an empty prerender is what
// Search Console judged and declined in August, when every prerendered page
// carried exactly one link, `<a href="/">`.

import { useEffect, useState } from 'react';
import { RouteLink } from '../lib/RouterContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { fetchFamilies } from '../lib/genreService';

export default function GenresIndex() {
  const [families, setFamilies] = useState([]);
  const [loading, setLoading] = useState(true);

  useDocumentMeta({
    title: 'Browse by Genre — The Books Oracle',
    description:
      'Sixteen shelves and every genre on them — fantasy, horror, gothic, crime, poetry and more. Find your next book by the kind of book it is.',
  });

  useEffect(() => {
    let alive = true;
    fetchFamilies().then((f) => { if (alive) { setFamilies(f); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  return (
    <div className="container genre-index">
      <div className="page-head">
        <div className="page-head__eyebrow">Browse</div>
        <h1 className="page-head__title">Every shelf in the library</h1>
        <p className="page-head__sub">
          Sixteen families, and every genre on them. Start broad and narrow, or
          go straight to the one you already know you want.
        </p>
      </div>

      {loading && <div className="fp-empty">Reading the shelves…</div>}

      <div className="family-grid">
        {families.map((f) => (
          <RouteLink
            key={f.slug}
            to="family-page"
            params={{ familySlug: f.slug }}
            className="family-card"
          >
            <h2 className="family-card__name">{f.name}</h2>
            {f.description && <p className="family-card__desc">{f.description}</p>}
            {/* No count. A number here cannot answer the question it invites —
                "books in my wishlist, my library, or the whole catalogue?" —
                and the honest answer (the whole shared catalogue) is not what
                a reader assumes. The Library already tells them what they own. */}
          </RouteLink>
        ))}
      </div>
    </div>
  );
}
