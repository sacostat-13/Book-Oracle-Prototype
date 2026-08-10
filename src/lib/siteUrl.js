// Canonical site origin, in one place.
//
// v0.61.2: this constant existed in four files independently (index.html,
// robots.txt, netlify/functions/sitemap.js, netlify/edge-functions/
// og-prerender.js) and they had already drifted apart once — three said the
// apex while Netlify served www, so every sitemap URL and every canonical
// pointed at a redirect. The two client-side users are now consolidated here
// so at least the bundle cannot disagree with itself.
//
// The three non-JS copies cannot import this (raw HTML, a Deno edge bundle,
// and a plain text file), so they carry a comment pointing back here. If the
// Netlify primary domain ever changes, all four still move together.
export const SITE_ORIGIN = 'https://www.thebooksoracle.com';

/**
 * The canonical URL for a path — always the www origin, always without query
 * or hash.
 *
 * Query strings are stripped deliberately. `?lang=en` is a UI preference, not
 * a different document, and letting it into og:url or rel=canonical invites
 * Google to treat `/`, `/?lang=en` and `/?lang=es` as three competing copies
 * of the same page. Routes here are real paths, so nothing content-bearing
 * lives in the query string.
 */
export function canonicalUrl(pathname = window.location.pathname) {
  return SITE_ORIGIN + pathname;
}
