import {
  defineConfig
} from 'vite';
import react from '@vitejs/plugin-react';
import {
  VitePWA
} from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// v0.52: virtual module listing public/avatars/*.svg, so the preset avatar
// gallery is driven by the folder's contents — drop a new SVG in, it shows up
// in the Profile picker; no manifest array to maintain (see src/lib/avatars.js
// for the filename convention). Dev server invalidates on add/remove, so new
// files appear without a restart; production bakes the list at build time
// (adding files means a deploy anyway — they live in the repo).
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const AVATARS_DIR = path.resolve(ROOT, 'public/avatars');

// v0.56: bake the shipped version into the bundle so a running client can tell
// whether it is stale. public/app-version.json is the single source of truth —
// it's served unhashed and uncached, so a client compares the version it was
// BUILT with (__APP_VERSION__) against the version currently deployed. A
// mismatch means this client is running old code, which is the signal the old
// needRefresh-only path could never produce for a returning visitor.
//
// v0.63.3 — this file drifted, and the drift was silent and expensive.
//
// It sat at { version: "0.59", critical: true } from the v0.59 hotfix until
// v0.63.2. Two consequences, neither of which produced an error anywhere:
//
//   1. `critical: true` is read by BOTH paths in PWAUpdatePrompt. On path 1 it
//      means a newly-arrived service worker auto-applies instead of showing the
//      dismissible toast — so every deploy force-reloaded every open tab, which
//      is exactly the behaviour registerType: 'prompt' was adopted in v0.45 to
//      stop. A reader who stepped away mid-session came back to a reloaded page
//      and lost whatever was in component state.
//
//   2. Because the version never moved, __APP_VERSION__ (baked from this file
//      at build time) always equalled the deployed value, so path 2 — the
//      stale-client catch added in v0.56 — could never fire at all. The feature
//      was inert for four releases.
//
// A version that must be hand-bumped in two places will be wrong eventually.
// releases.js already has CURRENT_VERSION and is edited on every release
// because the notes modal reads it, so it is the honest source of truth. This
// derives from it and treats disagreement as a build failure rather than
// something to notice later in a README footnote.
function readCurrentVersionFromReleases() {
  const src = fs.readFileSync(path.resolve(ROOT, 'src/lib/releases.js'), 'utf8');
  const m = src.match(/export const CURRENT_VERSION\s*=\s*['"]v?([^'"]+)['"]/);
  if (!m) throw new Error('vite.config: could not read CURRENT_VERSION from src/lib/releases.js');
  return m[1];
}

function readAppVersion() {
  const expected = readCurrentVersionFromReleases();
  let declared;
  try {
    declared = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'public/app-version.json'), 'utf8')).version;
  } catch {
    return 'unknown'; // unreadable file never blocks a build; the check just no-ops (see PWAUpdatePrompt)
  }
  if (declared !== expected) {
    throw new Error(
      `vite.config: public/app-version.json says "${declared}" but releases.js CURRENT_VERSION is ` +
      `"${expected}". Bump app-version.json to "${expected}". A stale version here silently disables ` +
      `the stale-client check in PWAUpdatePrompt — see the note above.`
    );
  }
  return declared;
}
const AVATAR_MANIFEST_ID = 'virtual:avatar-manifest';
const RESOLVED_AVATAR_MANIFEST_ID = '\0' + AVATAR_MANIFEST_ID;

function avatarManifest() {
  const list = () => {
    try {
      return fs.readdirSync(AVATARS_DIR).filter((f) => f.endsWith('.svg')).sort();
    } catch {
      return [];
    }
  };
  return {
    name: 'avatar-manifest',
    resolveId(id) {
      if (id === AVATAR_MANIFEST_ID) return RESOLVED_AVATAR_MANIFEST_ID;
    },
    load(id) {
      if (id === RESOLVED_AVATAR_MANIFEST_ID) {
        return `export default ${JSON.stringify(list())};`;
      }
    },
    configureServer(server) {
      server.watcher.add(AVATARS_DIR);
      const invalidate = (file) => {
        if (!file.includes('avatars') || !file.endsWith('.svg')) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_AVATAR_MANIFEST_ID);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: 'full-reload' });
        }
      };
      server.watcher.on('add', invalidate);
      server.watcher.on('unlink', invalidate);
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion()),
  },

  // Watch all SCSS partials in subdirectories so HMR triggers on any style change
  server: {
    watch: {
      usePolling: false,
      ignored: ['!**/src/styles/**'],
    },
  },

  css: {
    preprocessorOptions: {
      scss: {
        // Allows @use paths to resolve from the styles root
        loadPaths: ['src/styles'],
      },
    },
  },

  plugins: [
    react(),
    avatarManifest(),
    VitePWA({
      // v0.45: switched from 'autoUpdate' to 'prompt'. autoUpdate force-reloaded
      // every open client the moment a new SW took control on each deploy. That
      // reload raced Supabase's token refresh; with single-use refresh-token
      // rotation, the losing request got "Invalid Refresh Token: Already Used"
      // and the client purged sb-<ref>-auth-token from localStorage — logging
      // users out on every deploy. 'prompt' lets the user update on their terms
      // (see PWAUpdatePrompt), so no mid-session reload and no lost session.
      registerType: 'prompt',
      workbox: {
        // v0.56: skipWaiting + clientsClaim. Deliberately NOT a walk-back of the
        // v0.45 decision above — the two settings do different things, and it
        // was the reload, not the activation, that logged people out.
        //
        // Before this, a new SW installed and then WAITED. A waiting worker only
        // activates once every tab for the origin closes, so anyone keeping the
        // site in a background tab or as a home-screen install could sit on a
        // stale worker indefinitely. That's the cohort that kept seeing the old
        // landing page: their browser had already downloaded the new build and
        // was refusing to activate it.
        //
        // skipWaiting activates the new worker on install; clientsClaim lets it
        // take control of already-open pages. Neither reloads anything — the
        // running page keeps the bundle it already has in memory and picks up
        // new code on its next navigation. registerType stays 'prompt', so the
        // forced-reload behaviour that raced Supabase's single-use refresh-token
        // rotation is still gone. That reload now only ever happens via
        // PWAUpdatePrompt, which awaits getSession() first.
        //
        // Safe here specifically because the build emits one JS bundle (the lone
        // dynamic import in enrichmentService.js is inlined). The usual hazard of
        // activating mid-session is a running page lazy-loading a chunk that the
        // new precache just evicted; with no split chunks there is nothing to
        // evict out from under it. Revisit this if code splitting is introduced.
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // v0.61.2: keep the SPA navigation fallback off routes that are served
        // by Netlify, not by the app.
        //
        // vite-plugin-pwa registers a NavigationRoute bound to index.html with
        // no denylist by default. That is correct for client-side routes — it
        // is what makes /wishlist work offline — but a NavigationRoute matches
        // ANY navigation request, including typing /sitemap.xml into the
        // address bar. The worker answered with cached index.html, React
        // routed on a path it doesn't know, and rendered the app's own 404.
        //
        // The server was never wrong: /sitemap.xml returns application/xml with
        // a 200 the whole time. Only browsers that had registered the worker
        // saw a 404, which made the sitemap impossible to verify by eye — and
        // made it look like the Netlify redirect had broken.
        //
        // Googlebot does not run service workers, so indexing was never
        // affected. This is a "you cannot check your own work" bug rather than
        // an SEO one, which is exactly why it survived this long.
        navigateFallbackDenylist: [
          /^\/sitemap\.xml$/,
          /^\/robots\.txt$/,
          // Function and edge-function paths. share-card and og-prerender are
          // reached directly in some flows; none of them are app routes.
          /^\/\.netlify\//,
        ],
        // Share-card frame/art (public/cards/**) are large (2-3 MB each) and only
        // fetched on demand when a user shares — never needed offline. Keep them
        // out of the SW precache so they don't exceed the size limit (which fails
        // the build) or bloat the install with tens of MB of images.
        globIgnores: ['**/cards/**'],
        runtimeCaching: [{
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              },
            },
          },
          {
            // Google Fonts files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              },
            },
          },
          // v0.44: the book-covers CacheFirst route was removed. When a cover
          // wasn't cached yet AND the host refused the fetch (Open Library
          // rate-limits hotlinks), workbox surfaced an unhandled "no-response"
          // rejection per image — pure console noise since BookCover already
          // falls back to a placeholder onError. Without the route, covers use
          // the normal browser HTTP cache; only offline cover display is lost.
        ],
      },
      manifest: false,
      devOptions: {
        enabled: false
      },
    }),
  ],
});