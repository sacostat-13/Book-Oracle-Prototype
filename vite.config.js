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
function readAppVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(ROOT, 'public/app-version.json'), 'utf8')).version;
  } catch {
    return 'unknown'; // never blocks a build; the check just no-ops (see PWAUpdatePrompt)
  }
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