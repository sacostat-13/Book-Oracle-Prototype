// vite.config.js
import {
  defineConfig
} from "file:///sessions/rcw-01jeqiob9vmknljjjjqx9grh/mnt/Book-Oracle-Prototype/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/rcw-01jeqiob9vmknljjjjqx9grh/mnt/Book-Oracle-Prototype/node_modules/@vitejs/plugin-react/dist/index.js";
import {
  VitePWA
} from "file:///sessions/rcw-01jeqiob9vmknljjjjqx9grh/mnt/Book-Oracle-Prototype/node_modules/vite-plugin-pwa/dist/index.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var __vite_injected_original_import_meta_url = "file:///sessions/rcw-01jeqiob9vmknljjjjqx9grh/mnt/Book-Oracle-Prototype/vite.config.js";
var ROOT = path.dirname(fileURLToPath(__vite_injected_original_import_meta_url));
var AVATARS_DIR = path.resolve(ROOT, "public/avatars");
function readCurrentVersionFromReleases() {
  const src = fs.readFileSync(path.resolve(ROOT, "src/lib/releases.js"), "utf8");
  const m = src.match(/export const CURRENT_VERSION\s*=\s*['"]v?([^'"]+)['"]/);
  if (!m) throw new Error("vite.config: could not read CURRENT_VERSION from src/lib/releases.js");
  return m[1];
}
function readAppVersion() {
  const expected = readCurrentVersionFromReleases();
  let declared;
  try {
    declared = JSON.parse(fs.readFileSync(path.resolve(ROOT, "public/app-version.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
  if (declared !== expected) {
    throw new Error(
      `vite.config: public/app-version.json says "${declared}" but releases.js CURRENT_VERSION is "${expected}". Bump app-version.json to "${expected}". A stale version here silently disables the stale-client check in PWAUpdatePrompt \u2014 see the note above.`
    );
  }
  return declared;
}
var AVATAR_MANIFEST_ID = "virtual:avatar-manifest";
var RESOLVED_AVATAR_MANIFEST_ID = "\0" + AVATAR_MANIFEST_ID;
function avatarManifest() {
  const list = () => {
    try {
      return fs.readdirSync(AVATARS_DIR).filter((f) => f.endsWith(".svg")).sort();
    } catch {
      return [];
    }
  };
  return {
    name: "avatar-manifest",
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
        if (!file.includes("avatars") || !file.endsWith(".svg")) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_AVATAR_MANIFEST_ID);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: "full-reload" });
        }
      };
      server.watcher.on("add", invalidate);
      server.watcher.on("unlink", invalidate);
    }
  };
}
var vite_config_default = defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion())
  },
  // Watch all SCSS partials in subdirectories so HMR triggers on any style change
  server: {
    watch: {
      usePolling: false,
      ignored: ["!**/src/styles/**"]
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Allows @use paths to resolve from the styles root
        loadPaths: ["src/styles"]
      }
    }
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
      registerType: "prompt",
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
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
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
          /^\/\.netlify\//
        ],
        // Share-card frame/art (public/cards/**) are large (2-3 MB each) and only
        // fetched on demand when a user shares — never needed offline. Keep them
        // out of the SW precache so they don't exceed the size limit (which fails
        // the build) or bloat the install with tens of MB of images.
        globIgnores: ["**/cards/**"],
        runtimeCaching: [
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Google Fonts files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
          // v0.44: the book-covers CacheFirst route was removed. When a cover
          // wasn't cached yet AND the host refused the fetch (Open Library
          // rate-limits hotlinks), workbox surfaced an unhandled "no-response"
          // rejection per image — pure console noise since BookCover already
          // falls back to a placeholder onError. Without the route, covers use
          // the normal browser HTTP cache; only offline cover display is lost.
        ]
      },
      manifest: false,
      devOptions: {
        enabled: false
      }
    })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvcmN3LTAxamVxaW9iOXZta25sampqanF4OWdyaC9tbnQvQm9vay1PcmFjbGUtUHJvdG90eXBlXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvcmN3LTAxamVxaW9iOXZta25sampqanF4OWdyaC9tbnQvQm9vay1PcmFjbGUtUHJvdG90eXBlL3ZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9yY3ctMDFqZXFpb2I5dm1rbmxqampqcXg5Z3JoL21udC9Cb29rLU9yYWNsZS1Qcm90b3R5cGUvdml0ZS5jb25maWcuanNcIjtpbXBvcnQge1xyXG4gIGRlZmluZUNvbmZpZ1xyXG59IGZyb20gJ3ZpdGUnO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xyXG5pbXBvcnQge1xyXG4gIFZpdGVQV0FcclxufSBmcm9tICd2aXRlLXBsdWdpbi1wd2EnO1xyXG5pbXBvcnQgZnMgZnJvbSAnbm9kZTpmcyc7XHJcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XHJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XHJcblxyXG4vLyB2MC41MjogdmlydHVhbCBtb2R1bGUgbGlzdGluZyBwdWJsaWMvYXZhdGFycy8qLnN2Zywgc28gdGhlIHByZXNldCBhdmF0YXJcclxuLy8gZ2FsbGVyeSBpcyBkcml2ZW4gYnkgdGhlIGZvbGRlcidzIGNvbnRlbnRzIFx1MjAxNCBkcm9wIGEgbmV3IFNWRyBpbiwgaXQgc2hvd3MgdXBcclxuLy8gaW4gdGhlIFByb2ZpbGUgcGlja2VyOyBubyBtYW5pZmVzdCBhcnJheSB0byBtYWludGFpbiAoc2VlIHNyYy9saWIvYXZhdGFycy5qc1xyXG4vLyBmb3IgdGhlIGZpbGVuYW1lIGNvbnZlbnRpb24pLiBEZXYgc2VydmVyIGludmFsaWRhdGVzIG9uIGFkZC9yZW1vdmUsIHNvIG5ld1xyXG4vLyBmaWxlcyBhcHBlYXIgd2l0aG91dCBhIHJlc3RhcnQ7IHByb2R1Y3Rpb24gYmFrZXMgdGhlIGxpc3QgYXQgYnVpbGQgdGltZVxyXG4vLyAoYWRkaW5nIGZpbGVzIG1lYW5zIGEgZGVwbG95IGFueXdheSBcdTIwMTQgdGhleSBsaXZlIGluIHRoZSByZXBvKS5cclxuY29uc3QgUk9PVCA9IHBhdGguZGlybmFtZShmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCkpO1xyXG5jb25zdCBBVkFUQVJTX0RJUiA9IHBhdGgucmVzb2x2ZShST09ULCAncHVibGljL2F2YXRhcnMnKTtcclxuXHJcbi8vIHYwLjU2OiBiYWtlIHRoZSBzaGlwcGVkIHZlcnNpb24gaW50byB0aGUgYnVuZGxlIHNvIGEgcnVubmluZyBjbGllbnQgY2FuIHRlbGxcclxuLy8gd2hldGhlciBpdCBpcyBzdGFsZS4gcHVibGljL2FwcC12ZXJzaW9uLmpzb24gaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggXHUyMDE0XHJcbi8vIGl0J3Mgc2VydmVkIHVuaGFzaGVkIGFuZCB1bmNhY2hlZCwgc28gYSBjbGllbnQgY29tcGFyZXMgdGhlIHZlcnNpb24gaXQgd2FzXHJcbi8vIEJVSUxUIHdpdGggKF9fQVBQX1ZFUlNJT05fXykgYWdhaW5zdCB0aGUgdmVyc2lvbiBjdXJyZW50bHkgZGVwbG95ZWQuIEFcclxuLy8gbWlzbWF0Y2ggbWVhbnMgdGhpcyBjbGllbnQgaXMgcnVubmluZyBvbGQgY29kZSwgd2hpY2ggaXMgdGhlIHNpZ25hbCB0aGUgb2xkXHJcbi8vIG5lZWRSZWZyZXNoLW9ubHkgcGF0aCBjb3VsZCBuZXZlciBwcm9kdWNlIGZvciBhIHJldHVybmluZyB2aXNpdG9yLlxyXG4vL1xyXG4vLyB2MC42My4zIFx1MjAxNCB0aGlzIGZpbGUgZHJpZnRlZCwgYW5kIHRoZSBkcmlmdCB3YXMgc2lsZW50IGFuZCBleHBlbnNpdmUuXHJcbi8vXHJcbi8vIEl0IHNhdCBhdCB7IHZlcnNpb246IFwiMC41OVwiLCBjcml0aWNhbDogdHJ1ZSB9IGZyb20gdGhlIHYwLjU5IGhvdGZpeCB1bnRpbFxyXG4vLyB2MC42My4yLiBUd28gY29uc2VxdWVuY2VzLCBuZWl0aGVyIG9mIHdoaWNoIHByb2R1Y2VkIGFuIGVycm9yIGFueXdoZXJlOlxyXG4vL1xyXG4vLyAgIDEuIGBjcml0aWNhbDogdHJ1ZWAgaXMgcmVhZCBieSBCT1RIIHBhdGhzIGluIFBXQVVwZGF0ZVByb21wdC4gT24gcGF0aCAxIGl0XHJcbi8vICAgICAgbWVhbnMgYSBuZXdseS1hcnJpdmVkIHNlcnZpY2Ugd29ya2VyIGF1dG8tYXBwbGllcyBpbnN0ZWFkIG9mIHNob3dpbmcgdGhlXHJcbi8vICAgICAgZGlzbWlzc2libGUgdG9hc3QgXHUyMDE0IHNvIGV2ZXJ5IGRlcGxveSBmb3JjZS1yZWxvYWRlZCBldmVyeSBvcGVuIHRhYiwgd2hpY2hcclxuLy8gICAgICBpcyBleGFjdGx5IHRoZSBiZWhhdmlvdXIgcmVnaXN0ZXJUeXBlOiAncHJvbXB0JyB3YXMgYWRvcHRlZCBpbiB2MC40NSB0b1xyXG4vLyAgICAgIHN0b3AuIEEgcmVhZGVyIHdobyBzdGVwcGVkIGF3YXkgbWlkLXNlc3Npb24gY2FtZSBiYWNrIHRvIGEgcmVsb2FkZWQgcGFnZVxyXG4vLyAgICAgIGFuZCBsb3N0IHdoYXRldmVyIHdhcyBpbiBjb21wb25lbnQgc3RhdGUuXHJcbi8vXHJcbi8vICAgMi4gQmVjYXVzZSB0aGUgdmVyc2lvbiBuZXZlciBtb3ZlZCwgX19BUFBfVkVSU0lPTl9fIChiYWtlZCBmcm9tIHRoaXMgZmlsZVxyXG4vLyAgICAgIGF0IGJ1aWxkIHRpbWUpIGFsd2F5cyBlcXVhbGxlZCB0aGUgZGVwbG95ZWQgdmFsdWUsIHNvIHBhdGggMiBcdTIwMTQgdGhlXHJcbi8vICAgICAgc3RhbGUtY2xpZW50IGNhdGNoIGFkZGVkIGluIHYwLjU2IFx1MjAxNCBjb3VsZCBuZXZlciBmaXJlIGF0IGFsbC4gVGhlIGZlYXR1cmVcclxuLy8gICAgICB3YXMgaW5lcnQgZm9yIGZvdXIgcmVsZWFzZXMuXHJcbi8vXHJcbi8vIEEgdmVyc2lvbiB0aGF0IG11c3QgYmUgaGFuZC1idW1wZWQgaW4gdHdvIHBsYWNlcyB3aWxsIGJlIHdyb25nIGV2ZW50dWFsbHkuXHJcbi8vIHJlbGVhc2VzLmpzIGFscmVhZHkgaGFzIENVUlJFTlRfVkVSU0lPTiBhbmQgaXMgZWRpdGVkIG9uIGV2ZXJ5IHJlbGVhc2VcclxuLy8gYmVjYXVzZSB0aGUgbm90ZXMgbW9kYWwgcmVhZHMgaXQsIHNvIGl0IGlzIHRoZSBob25lc3Qgc291cmNlIG9mIHRydXRoLiBUaGlzXHJcbi8vIGRlcml2ZXMgZnJvbSBpdCBhbmQgdHJlYXRzIGRpc2FncmVlbWVudCBhcyBhIGJ1aWxkIGZhaWx1cmUgcmF0aGVyIHRoYW5cclxuLy8gc29tZXRoaW5nIHRvIG5vdGljZSBsYXRlciBpbiBhIFJFQURNRSBmb290bm90ZS5cclxuZnVuY3Rpb24gcmVhZEN1cnJlbnRWZXJzaW9uRnJvbVJlbGVhc2VzKCkge1xyXG4gIGNvbnN0IHNyYyA9IGZzLnJlYWRGaWxlU3luYyhwYXRoLnJlc29sdmUoUk9PVCwgJ3NyYy9saWIvcmVsZWFzZXMuanMnKSwgJ3V0ZjgnKTtcclxuICBjb25zdCBtID0gc3JjLm1hdGNoKC9leHBvcnQgY29uc3QgQ1VSUkVOVF9WRVJTSU9OXFxzKj1cXHMqWydcIl12PyhbXidcIl0rKVsnXCJdLyk7XHJcbiAgaWYgKCFtKSB0aHJvdyBuZXcgRXJyb3IoJ3ZpdGUuY29uZmlnOiBjb3VsZCBub3QgcmVhZCBDVVJSRU5UX1ZFUlNJT04gZnJvbSBzcmMvbGliL3JlbGVhc2VzLmpzJyk7XHJcbiAgcmV0dXJuIG1bMV07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlYWRBcHBWZXJzaW9uKCkge1xyXG4gIGNvbnN0IGV4cGVjdGVkID0gcmVhZEN1cnJlbnRWZXJzaW9uRnJvbVJlbGVhc2VzKCk7XHJcbiAgbGV0IGRlY2xhcmVkO1xyXG4gIHRyeSB7XHJcbiAgICBkZWNsYXJlZCA9IEpTT04ucGFyc2UoZnMucmVhZEZpbGVTeW5jKHBhdGgucmVzb2x2ZShST09ULCAncHVibGljL2FwcC12ZXJzaW9uLmpzb24nKSwgJ3V0ZjgnKSkudmVyc2lvbjtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiAndW5rbm93bic7IC8vIHVucmVhZGFibGUgZmlsZSBuZXZlciBibG9ja3MgYSBidWlsZDsgdGhlIGNoZWNrIGp1c3Qgbm8tb3BzIChzZWUgUFdBVXBkYXRlUHJvbXB0KVxyXG4gIH1cclxuICBpZiAoZGVjbGFyZWQgIT09IGV4cGVjdGVkKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAgIGB2aXRlLmNvbmZpZzogcHVibGljL2FwcC12ZXJzaW9uLmpzb24gc2F5cyBcIiR7ZGVjbGFyZWR9XCIgYnV0IHJlbGVhc2VzLmpzIENVUlJFTlRfVkVSU0lPTiBpcyBgICtcclxuICAgICAgYFwiJHtleHBlY3RlZH1cIi4gQnVtcCBhcHAtdmVyc2lvbi5qc29uIHRvIFwiJHtleHBlY3RlZH1cIi4gQSBzdGFsZSB2ZXJzaW9uIGhlcmUgc2lsZW50bHkgZGlzYWJsZXMgYCArXHJcbiAgICAgIGB0aGUgc3RhbGUtY2xpZW50IGNoZWNrIGluIFBXQVVwZGF0ZVByb21wdCBcdTIwMTQgc2VlIHRoZSBub3RlIGFib3ZlLmBcclxuICAgICk7XHJcbiAgfVxyXG4gIHJldHVybiBkZWNsYXJlZDtcclxufVxyXG5jb25zdCBBVkFUQVJfTUFOSUZFU1RfSUQgPSAndmlydHVhbDphdmF0YXItbWFuaWZlc3QnO1xyXG5jb25zdCBSRVNPTFZFRF9BVkFUQVJfTUFOSUZFU1RfSUQgPSAnXFwwJyArIEFWQVRBUl9NQU5JRkVTVF9JRDtcclxuXHJcbmZ1bmN0aW9uIGF2YXRhck1hbmlmZXN0KCkge1xyXG4gIGNvbnN0IGxpc3QgPSAoKSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICByZXR1cm4gZnMucmVhZGRpclN5bmMoQVZBVEFSU19ESVIpLmZpbHRlcigoZikgPT4gZi5lbmRzV2l0aCgnLnN2ZycpKS5zb3J0KCk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG4gIH07XHJcbiAgcmV0dXJuIHtcclxuICAgIG5hbWU6ICdhdmF0YXItbWFuaWZlc3QnLFxyXG4gICAgcmVzb2x2ZUlkKGlkKSB7XHJcbiAgICAgIGlmIChpZCA9PT0gQVZBVEFSX01BTklGRVNUX0lEKSByZXR1cm4gUkVTT0xWRURfQVZBVEFSX01BTklGRVNUX0lEO1xyXG4gICAgfSxcclxuICAgIGxvYWQoaWQpIHtcclxuICAgICAgaWYgKGlkID09PSBSRVNPTFZFRF9BVkFUQVJfTUFOSUZFU1RfSUQpIHtcclxuICAgICAgICByZXR1cm4gYGV4cG9ydCBkZWZhdWx0ICR7SlNPTi5zdHJpbmdpZnkobGlzdCgpKX07YDtcclxuICAgICAgfVxyXG4gICAgfSxcclxuICAgIGNvbmZpZ3VyZVNlcnZlcihzZXJ2ZXIpIHtcclxuICAgICAgc2VydmVyLndhdGNoZXIuYWRkKEFWQVRBUlNfRElSKTtcclxuICAgICAgY29uc3QgaW52YWxpZGF0ZSA9IChmaWxlKSA9PiB7XHJcbiAgICAgICAgaWYgKCFmaWxlLmluY2x1ZGVzKCdhdmF0YXJzJykgfHwgIWZpbGUuZW5kc1dpdGgoJy5zdmcnKSkgcmV0dXJuO1xyXG4gICAgICAgIGNvbnN0IG1vZCA9IHNlcnZlci5tb2R1bGVHcmFwaC5nZXRNb2R1bGVCeUlkKFJFU09MVkVEX0FWQVRBUl9NQU5JRkVTVF9JRCk7XHJcbiAgICAgICAgaWYgKG1vZCkge1xyXG4gICAgICAgICAgc2VydmVyLm1vZHVsZUdyYXBoLmludmFsaWRhdGVNb2R1bGUobW9kKTtcclxuICAgICAgICAgIHNlcnZlci53cy5zZW5kKHsgdHlwZTogJ2Z1bGwtcmVsb2FkJyB9KTtcclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcbiAgICAgIHNlcnZlci53YXRjaGVyLm9uKCdhZGQnLCBpbnZhbGlkYXRlKTtcclxuICAgICAgc2VydmVyLndhdGNoZXIub24oJ3VubGluaycsIGludmFsaWRhdGUpO1xyXG4gICAgfSxcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xyXG4gIGRlZmluZToge1xyXG4gICAgX19BUFBfVkVSU0lPTl9fOiBKU09OLnN0cmluZ2lmeShyZWFkQXBwVmVyc2lvbigpKSxcclxuICB9LFxyXG5cclxuICAvLyBXYXRjaCBhbGwgU0NTUyBwYXJ0aWFscyBpbiBzdWJkaXJlY3RvcmllcyBzbyBITVIgdHJpZ2dlcnMgb24gYW55IHN0eWxlIGNoYW5nZVxyXG4gIHNlcnZlcjoge1xyXG4gICAgd2F0Y2g6IHtcclxuICAgICAgdXNlUG9sbGluZzogZmFsc2UsXHJcbiAgICAgIGlnbm9yZWQ6IFsnISoqL3NyYy9zdHlsZXMvKionXSxcclxuICAgIH0sXHJcbiAgfSxcclxuXHJcbiAgY3NzOiB7XHJcbiAgICBwcmVwcm9jZXNzb3JPcHRpb25zOiB7XHJcbiAgICAgIHNjc3M6IHtcclxuICAgICAgICAvLyBBbGxvd3MgQHVzZSBwYXRocyB0byByZXNvbHZlIGZyb20gdGhlIHN0eWxlcyByb290XHJcbiAgICAgICAgbG9hZFBhdGhzOiBbJ3NyYy9zdHlsZXMnXSxcclxuICAgICAgfSxcclxuICAgIH0sXHJcbiAgfSxcclxuXHJcbiAgcGx1Z2luczogW1xyXG4gICAgcmVhY3QoKSxcclxuICAgIGF2YXRhck1hbmlmZXN0KCksXHJcbiAgICBWaXRlUFdBKHtcclxuICAgICAgLy8gdjAuNDU6IHN3aXRjaGVkIGZyb20gJ2F1dG9VcGRhdGUnIHRvICdwcm9tcHQnLiBhdXRvVXBkYXRlIGZvcmNlLXJlbG9hZGVkXHJcbiAgICAgIC8vIGV2ZXJ5IG9wZW4gY2xpZW50IHRoZSBtb21lbnQgYSBuZXcgU1cgdG9vayBjb250cm9sIG9uIGVhY2ggZGVwbG95LiBUaGF0XHJcbiAgICAgIC8vIHJlbG9hZCByYWNlZCBTdXBhYmFzZSdzIHRva2VuIHJlZnJlc2g7IHdpdGggc2luZ2xlLXVzZSByZWZyZXNoLXRva2VuXHJcbiAgICAgIC8vIHJvdGF0aW9uLCB0aGUgbG9zaW5nIHJlcXVlc3QgZ290IFwiSW52YWxpZCBSZWZyZXNoIFRva2VuOiBBbHJlYWR5IFVzZWRcIlxyXG4gICAgICAvLyBhbmQgdGhlIGNsaWVudCBwdXJnZWQgc2ItPHJlZj4tYXV0aC10b2tlbiBmcm9tIGxvY2FsU3RvcmFnZSBcdTIwMTQgbG9nZ2luZ1xyXG4gICAgICAvLyB1c2VycyBvdXQgb24gZXZlcnkgZGVwbG95LiAncHJvbXB0JyBsZXRzIHRoZSB1c2VyIHVwZGF0ZSBvbiB0aGVpciB0ZXJtc1xyXG4gICAgICAvLyAoc2VlIFBXQVVwZGF0ZVByb21wdCksIHNvIG5vIG1pZC1zZXNzaW9uIHJlbG9hZCBhbmQgbm8gbG9zdCBzZXNzaW9uLlxyXG4gICAgICByZWdpc3RlclR5cGU6ICdwcm9tcHQnLFxyXG4gICAgICB3b3JrYm94OiB7XHJcbiAgICAgICAgLy8gdjAuNTY6IHNraXBXYWl0aW5nICsgY2xpZW50c0NsYWltLiBEZWxpYmVyYXRlbHkgTk9UIGEgd2Fsay1iYWNrIG9mIHRoZVxyXG4gICAgICAgIC8vIHYwLjQ1IGRlY2lzaW9uIGFib3ZlIFx1MjAxNCB0aGUgdHdvIHNldHRpbmdzIGRvIGRpZmZlcmVudCB0aGluZ3MsIGFuZCBpdFxyXG4gICAgICAgIC8vIHdhcyB0aGUgcmVsb2FkLCBub3QgdGhlIGFjdGl2YXRpb24sIHRoYXQgbG9nZ2VkIHBlb3BsZSBvdXQuXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvLyBCZWZvcmUgdGhpcywgYSBuZXcgU1cgaW5zdGFsbGVkIGFuZCB0aGVuIFdBSVRFRC4gQSB3YWl0aW5nIHdvcmtlciBvbmx5XHJcbiAgICAgICAgLy8gYWN0aXZhdGVzIG9uY2UgZXZlcnkgdGFiIGZvciB0aGUgb3JpZ2luIGNsb3Nlcywgc28gYW55b25lIGtlZXBpbmcgdGhlXHJcbiAgICAgICAgLy8gc2l0ZSBpbiBhIGJhY2tncm91bmQgdGFiIG9yIGFzIGEgaG9tZS1zY3JlZW4gaW5zdGFsbCBjb3VsZCBzaXQgb24gYVxyXG4gICAgICAgIC8vIHN0YWxlIHdvcmtlciBpbmRlZmluaXRlbHkuIFRoYXQncyB0aGUgY29ob3J0IHRoYXQga2VwdCBzZWVpbmcgdGhlIG9sZFxyXG4gICAgICAgIC8vIGxhbmRpbmcgcGFnZTogdGhlaXIgYnJvd3NlciBoYWQgYWxyZWFkeSBkb3dubG9hZGVkIHRoZSBuZXcgYnVpbGQgYW5kXHJcbiAgICAgICAgLy8gd2FzIHJlZnVzaW5nIHRvIGFjdGl2YXRlIGl0LlxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy8gc2tpcFdhaXRpbmcgYWN0aXZhdGVzIHRoZSBuZXcgd29ya2VyIG9uIGluc3RhbGw7IGNsaWVudHNDbGFpbSBsZXRzIGl0XHJcbiAgICAgICAgLy8gdGFrZSBjb250cm9sIG9mIGFscmVhZHktb3BlbiBwYWdlcy4gTmVpdGhlciByZWxvYWRzIGFueXRoaW5nIFx1MjAxNCB0aGVcclxuICAgICAgICAvLyBydW5uaW5nIHBhZ2Uga2VlcHMgdGhlIGJ1bmRsZSBpdCBhbHJlYWR5IGhhcyBpbiBtZW1vcnkgYW5kIHBpY2tzIHVwXHJcbiAgICAgICAgLy8gbmV3IGNvZGUgb24gaXRzIG5leHQgbmF2aWdhdGlvbi4gcmVnaXN0ZXJUeXBlIHN0YXlzICdwcm9tcHQnLCBzbyB0aGVcclxuICAgICAgICAvLyBmb3JjZWQtcmVsb2FkIGJlaGF2aW91ciB0aGF0IHJhY2VkIFN1cGFiYXNlJ3Mgc2luZ2xlLXVzZSByZWZyZXNoLXRva2VuXHJcbiAgICAgICAgLy8gcm90YXRpb24gaXMgc3RpbGwgZ29uZS4gVGhhdCByZWxvYWQgbm93IG9ubHkgZXZlciBoYXBwZW5zIHZpYVxyXG4gICAgICAgIC8vIFBXQVVwZGF0ZVByb21wdCwgd2hpY2ggYXdhaXRzIGdldFNlc3Npb24oKSBmaXJzdC5cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vIFNhZmUgaGVyZSBzcGVjaWZpY2FsbHkgYmVjYXVzZSB0aGUgYnVpbGQgZW1pdHMgb25lIEpTIGJ1bmRsZSAodGhlIGxvbmVcclxuICAgICAgICAvLyBkeW5hbWljIGltcG9ydCBpbiBlbnJpY2htZW50U2VydmljZS5qcyBpcyBpbmxpbmVkKS4gVGhlIHVzdWFsIGhhemFyZCBvZlxyXG4gICAgICAgIC8vIGFjdGl2YXRpbmcgbWlkLXNlc3Npb24gaXMgYSBydW5uaW5nIHBhZ2UgbGF6eS1sb2FkaW5nIGEgY2h1bmsgdGhhdCB0aGVcclxuICAgICAgICAvLyBuZXcgcHJlY2FjaGUganVzdCBldmljdGVkOyB3aXRoIG5vIHNwbGl0IGNodW5rcyB0aGVyZSBpcyBub3RoaW5nIHRvXHJcbiAgICAgICAgLy8gZXZpY3Qgb3V0IGZyb20gdW5kZXIgaXQuIFJldmlzaXQgdGhpcyBpZiBjb2RlIHNwbGl0dGluZyBpcyBpbnRyb2R1Y2VkLlxyXG4gICAgICAgIHNraXBXYWl0aW5nOiB0cnVlLFxyXG4gICAgICAgIGNsaWVudHNDbGFpbTogdHJ1ZSxcclxuICAgICAgICBnbG9iUGF0dGVybnM6IFsnKiovKi57anMsY3NzLGh0bWwsaWNvLHBuZyxzdmcsd29mZjJ9J10sXHJcbiAgICAgICAgLy8gdjAuNjEuMjoga2VlcCB0aGUgU1BBIG5hdmlnYXRpb24gZmFsbGJhY2sgb2ZmIHJvdXRlcyB0aGF0IGFyZSBzZXJ2ZWRcclxuICAgICAgICAvLyBieSBOZXRsaWZ5LCBub3QgYnkgdGhlIGFwcC5cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vIHZpdGUtcGx1Z2luLXB3YSByZWdpc3RlcnMgYSBOYXZpZ2F0aW9uUm91dGUgYm91bmQgdG8gaW5kZXguaHRtbCB3aXRoXHJcbiAgICAgICAgLy8gbm8gZGVueWxpc3QgYnkgZGVmYXVsdC4gVGhhdCBpcyBjb3JyZWN0IGZvciBjbGllbnQtc2lkZSByb3V0ZXMgXHUyMDE0IGl0XHJcbiAgICAgICAgLy8gaXMgd2hhdCBtYWtlcyAvd2lzaGxpc3Qgd29yayBvZmZsaW5lIFx1MjAxNCBidXQgYSBOYXZpZ2F0aW9uUm91dGUgbWF0Y2hlc1xyXG4gICAgICAgIC8vIEFOWSBuYXZpZ2F0aW9uIHJlcXVlc3QsIGluY2x1ZGluZyB0eXBpbmcgL3NpdGVtYXAueG1sIGludG8gdGhlXHJcbiAgICAgICAgLy8gYWRkcmVzcyBiYXIuIFRoZSB3b3JrZXIgYW5zd2VyZWQgd2l0aCBjYWNoZWQgaW5kZXguaHRtbCwgUmVhY3RcclxuICAgICAgICAvLyByb3V0ZWQgb24gYSBwYXRoIGl0IGRvZXNuJ3Qga25vdywgYW5kIHJlbmRlcmVkIHRoZSBhcHAncyBvd24gNDA0LlxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy8gVGhlIHNlcnZlciB3YXMgbmV2ZXIgd3Jvbmc6IC9zaXRlbWFwLnhtbCByZXR1cm5zIGFwcGxpY2F0aW9uL3htbCB3aXRoXHJcbiAgICAgICAgLy8gYSAyMDAgdGhlIHdob2xlIHRpbWUuIE9ubHkgYnJvd3NlcnMgdGhhdCBoYWQgcmVnaXN0ZXJlZCB0aGUgd29ya2VyXHJcbiAgICAgICAgLy8gc2F3IGEgNDA0LCB3aGljaCBtYWRlIHRoZSBzaXRlbWFwIGltcG9zc2libGUgdG8gdmVyaWZ5IGJ5IGV5ZSBcdTIwMTQgYW5kXHJcbiAgICAgICAgLy8gbWFkZSBpdCBsb29rIGxpa2UgdGhlIE5ldGxpZnkgcmVkaXJlY3QgaGFkIGJyb2tlbi5cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vIEdvb2dsZWJvdCBkb2VzIG5vdCBydW4gc2VydmljZSB3b3JrZXJzLCBzbyBpbmRleGluZyB3YXMgbmV2ZXJcclxuICAgICAgICAvLyBhZmZlY3RlZC4gVGhpcyBpcyBhIFwieW91IGNhbm5vdCBjaGVjayB5b3VyIG93biB3b3JrXCIgYnVnIHJhdGhlciB0aGFuXHJcbiAgICAgICAgLy8gYW4gU0VPIG9uZSwgd2hpY2ggaXMgZXhhY3RseSB3aHkgaXQgc3Vydml2ZWQgdGhpcyBsb25nLlxyXG4gICAgICAgIG5hdmlnYXRlRmFsbGJhY2tEZW55bGlzdDogW1xyXG4gICAgICAgICAgL15cXC9zaXRlbWFwXFwueG1sJC8sXHJcbiAgICAgICAgICAvXlxcL3JvYm90c1xcLnR4dCQvLFxyXG4gICAgICAgICAgLy8gRnVuY3Rpb24gYW5kIGVkZ2UtZnVuY3Rpb24gcGF0aHMuIHNoYXJlLWNhcmQgYW5kIG9nLXByZXJlbmRlciBhcmVcclxuICAgICAgICAgIC8vIHJlYWNoZWQgZGlyZWN0bHkgaW4gc29tZSBmbG93czsgbm9uZSBvZiB0aGVtIGFyZSBhcHAgcm91dGVzLlxyXG4gICAgICAgICAgL15cXC9cXC5uZXRsaWZ5XFwvLyxcclxuICAgICAgICBdLFxyXG4gICAgICAgIC8vIFNoYXJlLWNhcmQgZnJhbWUvYXJ0IChwdWJsaWMvY2FyZHMvKiopIGFyZSBsYXJnZSAoMi0zIE1CIGVhY2gpIGFuZCBvbmx5XHJcbiAgICAgICAgLy8gZmV0Y2hlZCBvbiBkZW1hbmQgd2hlbiBhIHVzZXIgc2hhcmVzIFx1MjAxNCBuZXZlciBuZWVkZWQgb2ZmbGluZS4gS2VlcCB0aGVtXHJcbiAgICAgICAgLy8gb3V0IG9mIHRoZSBTVyBwcmVjYWNoZSBzbyB0aGV5IGRvbid0IGV4Y2VlZCB0aGUgc2l6ZSBsaW1pdCAod2hpY2ggZmFpbHNcclxuICAgICAgICAvLyB0aGUgYnVpbGQpIG9yIGJsb2F0IHRoZSBpbnN0YWxsIHdpdGggdGVucyBvZiBNQiBvZiBpbWFnZXMuXHJcbiAgICAgICAgZ2xvYklnbm9yZXM6IFsnKiovY2FyZHMvKionXSxcclxuICAgICAgICBydW50aW1lQ2FjaGluZzogW3tcclxuICAgICAgICAgICAgLy8gR29vZ2xlIEZvbnRzIHN0eWxlc2hlZXRzXHJcbiAgICAgICAgICAgIHVybFBhdHRlcm46IC9eaHR0cHM6XFwvXFwvZm9udHNcXC5nb29nbGVhcGlzXFwuY29tXFwvLiovaSxcclxuICAgICAgICAgICAgaGFuZGxlcjogJ0NhY2hlRmlyc3QnLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgY2FjaGVOYW1lOiAnZ29vZ2xlLWZvbnRzLWNhY2hlJyxcclxuICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7XHJcbiAgICAgICAgICAgICAgICBtYXhFbnRyaWVzOiAxMCxcclxuICAgICAgICAgICAgICAgIG1heEFnZVNlY29uZHM6IDYwICogNjAgKiAyNCAqIDM2NVxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgY2FjaGVhYmxlUmVzcG9uc2U6IHtcclxuICAgICAgICAgICAgICAgIHN0YXR1c2VzOiBbMCwgMjAwXVxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICAvLyBHb29nbGUgRm9udHMgZmlsZXNcclxuICAgICAgICAgICAgdXJsUGF0dGVybjogL15odHRwczpcXC9cXC9mb250c1xcLmdzdGF0aWNcXC5jb21cXC8uKi9pLFxyXG4gICAgICAgICAgICBoYW5kbGVyOiAnQ2FjaGVGaXJzdCcsXHJcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICBjYWNoZU5hbWU6ICdnc3RhdGljLWZvbnRzLWNhY2hlJyxcclxuICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7XHJcbiAgICAgICAgICAgICAgICBtYXhFbnRyaWVzOiAxMCxcclxuICAgICAgICAgICAgICAgIG1heEFnZVNlY29uZHM6IDYwICogNjAgKiAyNCAqIDM2NVxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgY2FjaGVhYmxlUmVzcG9uc2U6IHtcclxuICAgICAgICAgICAgICAgIHN0YXR1c2VzOiBbMCwgMjAwXVxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgLy8gdjAuNDQ6IHRoZSBib29rLWNvdmVycyBDYWNoZUZpcnN0IHJvdXRlIHdhcyByZW1vdmVkLiBXaGVuIGEgY292ZXJcclxuICAgICAgICAgIC8vIHdhc24ndCBjYWNoZWQgeWV0IEFORCB0aGUgaG9zdCByZWZ1c2VkIHRoZSBmZXRjaCAoT3BlbiBMaWJyYXJ5XHJcbiAgICAgICAgICAvLyByYXRlLWxpbWl0cyBob3RsaW5rcyksIHdvcmtib3ggc3VyZmFjZWQgYW4gdW5oYW5kbGVkIFwibm8tcmVzcG9uc2VcIlxyXG4gICAgICAgICAgLy8gcmVqZWN0aW9uIHBlciBpbWFnZSBcdTIwMTQgcHVyZSBjb25zb2xlIG5vaXNlIHNpbmNlIEJvb2tDb3ZlciBhbHJlYWR5XHJcbiAgICAgICAgICAvLyBmYWxscyBiYWNrIHRvIGEgcGxhY2Vob2xkZXIgb25FcnJvci4gV2l0aG91dCB0aGUgcm91dGUsIGNvdmVycyB1c2VcclxuICAgICAgICAgIC8vIHRoZSBub3JtYWwgYnJvd3NlciBIVFRQIGNhY2hlOyBvbmx5IG9mZmxpbmUgY292ZXIgZGlzcGxheSBpcyBsb3N0LlxyXG4gICAgICAgIF0sXHJcbiAgICAgIH0sXHJcbiAgICAgIG1hbmlmZXN0OiBmYWxzZSxcclxuICAgICAgZGV2T3B0aW9uczoge1xyXG4gICAgICAgIGVuYWJsZWQ6IGZhbHNlXHJcbiAgICAgIH0sXHJcbiAgICB9KSxcclxuICBdLFxyXG59KTsiXSwKICAibWFwcGluZ3MiOiAiO0FBQWtYO0FBQUEsRUFDaFg7QUFBQSxPQUNLO0FBQ1AsT0FBTyxXQUFXO0FBQ2xCO0FBQUEsRUFDRTtBQUFBLE9BQ0s7QUFDUCxPQUFPLFFBQVE7QUFDZixPQUFPLFVBQVU7QUFDakIsU0FBUyxxQkFBcUI7QUFUME0sSUFBTSwyQ0FBMkM7QUFpQnpSLElBQU0sT0FBTyxLQUFLLFFBQVEsY0FBYyx3Q0FBZSxDQUFDO0FBQ3hELElBQU0sY0FBYyxLQUFLLFFBQVEsTUFBTSxnQkFBZ0I7QUErQnZELFNBQVMsaUNBQWlDO0FBQ3hDLFFBQU0sTUFBTSxHQUFHLGFBQWEsS0FBSyxRQUFRLE1BQU0scUJBQXFCLEdBQUcsTUFBTTtBQUM3RSxRQUFNLElBQUksSUFBSSxNQUFNLHVEQUF1RDtBQUMzRSxNQUFJLENBQUMsRUFBRyxPQUFNLElBQUksTUFBTSxzRUFBc0U7QUFDOUYsU0FBTyxFQUFFLENBQUM7QUFDWjtB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
