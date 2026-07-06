import { useEffect } from 'react';

// v0.39: sets document.title + <meta name="description"> + basic OG tags for
// the current view. Client-side only — this helps Google (which renders JS)
// and gives every page a correct browser-tab title, but does NOT help
// non-JS social preview bots (Slack/Twitter/Facebook unfurls); those need
// server-side injection, which is handled separately for /book/:bookKey via
// the og-prerender edge function for the highest-value shareable pages.
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

export function useDocumentMeta({ title, description, image, noindex = false }) {
  useEffect(() => {
    if (title) document.title = title;
    if (description) upsertMeta('name', 'description', description);
    if (title) upsertMeta('property', 'og:title', title);
    if (description) upsertMeta('property', 'og:description', description);
    if (image) upsertMeta('property', 'og:image', image);
    upsertMeta('property', 'og:url', window.location.href);

    // v0.39: noindex for pages that shouldn't be indexed (404s, etc.) —
    // explicitly cleared on every other page so it doesn't linger from a
    // previous navigation.
    let robotsMeta = document.querySelector('meta[name="robots"]');
    if (noindex) {
      if (!robotsMeta) {
        robotsMeta = document.createElement('meta');
        robotsMeta.setAttribute('name', 'robots');
        document.head.appendChild(robotsMeta);
      }
      robotsMeta.setAttribute('content', 'noindex, nofollow');
    } else if (robotsMeta) {
      robotsMeta.remove();
    }
  }, [title, description, image, noindex]);
}
