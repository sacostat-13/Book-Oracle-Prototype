// build-output.test.js — files that must reach dist/, not just the repo.
//
// THE BUG THIS EXISTS FOR: robots.txt sat at the repo root for months. Vite
// copies only public/ into dist/, and netlify.toml publishes dist/ — so the file
// was tracked in git, referenced by a comment in index.html as one of four
// places the domain is written down, and never deployed. /robots.txt fell
// through the SPA catch-all and returned the 404 PAGE with a 200 status.
//
// Nothing failed. The build was green, the file existed, and a crawler asking
// for the rules got HTML. The only way to catch this class is to assert on the
// BUILD OUTPUT rather than on the source tree — "the file exists" was true the
// whole time and was never the question.
//
// Skips itself when dist/ is absent, so `npm test` is useful without a build
// first; CI runs the build before the tests, so there it always executes.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const built = existsSync(dist);

describe.skipIf(!built)('dist/ carries what the crawlers ask for', () => {
  it('robots.txt is published', () => {
    expect(
      existsSync(join(dist, 'robots.txt')),
      'robots.txt is missing from dist/. It probably lives at the repo root — ' +
      'Vite only copies public/. A request for it will return the SPA 404 page ' +
      'with a 200 status, and the Sitemap: directive will reach nobody.'
    ).toBe(true);
  });

  it('robots.txt points at the sitemap on the canonical host', () => {
    const txt = readFileSync(join(dist, 'robots.txt'), 'utf8');
    expect(txt).toMatch(/^\s*Sitemap:\s*https:\/\/www\.thebooksoracle\.com\/sitemap\.xml\s*$/m);
    // www, matching Netlify's primary domain. The apex 301s here, and Google
    // treats a redirecting sitemap reference as a weaker signal than the real
    // one. Changing the primary domain means changing it in four files.
  });

  it('app-version.json is published and parseable', () => {
    // The update prompt reads this at runtime; a malformed or missing file
    // silently disables it for everyone.
    const raw = readFileSync(join(dist, 'app-version.json'), 'utf8');
    const json = JSON.parse(raw);
    expect(typeof json.version).toBe('string');
    expect(typeof json.critical).toBe('boolean');
  });

  it('the version in dist matches the one the app announces', () => {
    // vite.config.js already guards this at build time; the test states the
    // contract in a place a human reads, and catches the guard being removed.
    const built = JSON.parse(readFileSync(join(dist, 'app-version.json'), 'utf8')).version;
    const announced = readFileSync(join(root, 'src/lib/releases.js'), 'utf8')
      .match(/export const CURRENT_VERSION = 'v([^']+)'/)[1];
    expect(built).toBe(announced);
  });

  it('index.html ships a canonical and a title', () => {
    // The prerender REPLACES these per page; index.html's copies are what every
    // non-prerendered route serves, so an empty head here is an empty head on
    // most of the site.
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/www\./);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
  });

  it('the family card plates are published', () => {
    // The illustrator's plates are looked up by family slug at render time; a
    // missing folder degrades to the generic plate silently.
    const cards = join(dist, 'cards');
    expect(existsSync(cards), 'public/cards is missing from dist/').toBe(true);
    const folders = readdirSync(cards);
    for (const slug of ['horror', 'fantasy', 'gothic', 'generic']) {
      expect(folders, `no card folder for "${slug}"`).toContain(slug);
    }
  });
});
