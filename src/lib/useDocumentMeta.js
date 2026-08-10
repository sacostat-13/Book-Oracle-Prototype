import { useEffect } from 'react';
import { canonicalUrl } from './siteUrl';

// v0.39: sets document.title + <meta name="description"> + basic OG tags for
// the current view.
//
// v0.61.2: index.html now ships a full static <head> — canonical, OG, Twitter,
// hreflang, JSON-LD — so this hook is no longer the only source of any of it.
// That changed what "correct" means here. Previously it could set whatever it
// liked into an otherwise empty head; now it OVERRIDES a good static default,
// and anything it half-updates leaves the page internally inconsistent.
//
// Three bugs that followed directly from that, all visible in Search Console's
// rendered HTML for `/`:
//
//   1. og:url was window.location.href — so `/?lang=en` shipped as og:url,
//      inviting Google to treat the language toggle as a separate document.
//      Now the canonical form: www origin, pathname only, no query.
//   2. The robots meta was REMOVED on every non-noindex page. That was
//      harmless when nothing else set one; it now deletes the static
//      `max-image-preview:large, max-snippet:-1` from index.html, silently
//      costing rich snippets on every route. It now restores the default
//      instead of removing the tag.
//   3. og:* was updated while twitter:* was left at the index.html values, so
//      the two told different stories about the same page. Twitter tags are
//      now kept in step.
function upsertMeta(attr, key, content) {
  if (!content) return;
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

// Mirrors index.html. `max-snippet:-1` and `max-image-preview:large` opt into
// full-length snippets and large thumbnails; without them Google uses its own
// conservative defaults.
const DEFAULT_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1';

export function useDocumentMeta({ title, description, image, noindex = false }) {
  useEffect(() => {
    if (title) document.title = title;
    if (description) upsertMeta('name', 'description', description);

    if (title) upsertMeta('property', 'og:title', title);
    if (description) upsertMeta('property', 'og:description', description);
    if (image) upsertMeta('property', 'og:image', image);
    upsertMeta('property', 'og:url', canonicalUrl());

    // Keep Twitter in step with OG. These used to be set once in index.html
    // and never touched again, so every route after the landing page served
    // Twitter tags describing a different page than its OG tags did.
    if (title) upsertMeta('name', 'twitter:title', title);
    if (description) upsertMeta('name', 'twitter:description', description);
    if (image) upsertMeta('name', 'twitter:image', image);

    // v0.39: noindex for pages that shouldn't be indexed (404s, etc.).
    // v0.61.2: the non-noindex branch sets the default directives rather than
    // removing the element. Removing it deleted index.html's static robots tag
    // and left the page with no snippet directives at all.
    let robotsMeta = document.querySelector('meta[name="robots"]');
    if (!robotsMeta) {
      robotsMeta = document.createElement('meta');
      robotsMeta.setAttribute('name', 'robots');
      document.head.appendChild(robotsMeta);
    }
    robotsMeta.setAttribute('content', noindex ? 'noindex, nofollow' : DEFAULT_ROBOTS);
  }, [title, description, image, noindex]);
}
