// vite.config.js
import {
  defineConfig
} from "file:///sessions/rcw-01aswanq4sa9tvxsrgxkbhiy/mnt/Book-Oracle-Prototype/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/rcw-01aswanq4sa9tvxsrgxkbhiy/mnt/Book-Oracle-Prototype/node_modules/@vitejs/plugin-react/dist/index.js";
import {
  VitePWA
} from "file:///sessions/rcw-01aswanq4sa9tvxsrgxkbhiy/mnt/Book-Oracle-Prototype/node_modules/vite-plugin-pwa/dist/index.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var __vite_injected_original_import_meta_url = "file:///sessions/rcw-01aswanq4sa9tvxsrgxkbhiy/mnt/Book-Oracle-Prototype/vite.config.js";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvcmN3LTAxYXN3YW5xNHNhOXR2eHNyZ3hrYmhpeS9tbnQvQm9vay1PcmFjbGUtUHJvdG90eXBlXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvcmN3LTAxYXN3YW5xNHNhOXR2eHNyZ3hrYmhpeS9tbnQvQm9vay1PcmFjbGUtUHJvdG90eXBlL3ZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9yY3ctMDFhc3dhbnE0c2E5dHZ4c3JneGtiaGl5L21udC9Cb29rLU9yYWNsZS1Qcm90b3R5cGUvdml0ZS5jb25maWcuanNcIjtpbXBvcnQge1xyXG4gIGRlZmluZUNvbmZpZ1xyXG59IGZyb20gJ3ZpdGUnO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xyXG5pbXBvcnQge1xyXG4gIFZpdGVQV0FcclxufSBmcm9tICd2aXRlLXBsdWdpbi1wd2EnO1xyXG5pbXBvcnQgZnMgZnJvbSAnbm9kZTpmcyc7XHJcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XHJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XHJcblxyXG4vLyB2MC41MjogdmlydHVhbCBtb2R1bGUgbGlzdGluZyBwdWJsaWMvYXZhdGFycy8qLnN2Zywgc28gdGhlIHByZXNldCBhdmF0YXJcclxuLy8gZ2FsbGVyeSBpcyBkcml2ZW4gYnkgdGhlIGZvbGRlcidzIGNvbnRlbnRzIFx1MjAxNCBkcm9wIGEgbmV3IFNWRyBpbiwgaXQgc2hvd3MgdXBcclxuLy8gaW4gdGhlIFByb2ZpbGUgcGlja2VyOyBubyBtYW5pZmVzdCBhcnJheSB0byBtYWludGFpbiAoc2VlIHNyYy9saWIvYXZhdGFycy5qc1xyXG4vLyBmb3IgdGhlIGZpbGVuYW1lIGNvbnZlbnRpb24pLiBEZXYgc2VydmVyIGludmFsaWRhdGVzIG9uIGFkZC9yZW1vdmUsIHNvIG5ld1xyXG4vLyBmaWxlcyBhcHBlYXIgd2l0aG91dCBhIHJlc3RhcnQ7IHByb2R1Y3Rpb24gYmFrZXMgdGhlIGxpc3QgYXQgYnVpbGQgdGltZVxyXG4vLyAoYWRkaW5nIGZpbGVzIG1lYW5zIGEgZGVwbG95IGFueXdheSBcdTIwMTQgdGhleSBsaXZlIGluIHRoZSByZXBvKS5cclxuY29uc3QgUk9PVCA9IHBhdGguZGlybmFtZShmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCkpO1xyXG5jb25zdCBBVkFUQVJTX0RJUiA9IHBhdGgucmVzb2x2ZShST09ULCAncHVibGljL2F2YXRhcnMnKTtcclxuXHJcbi8vIHYwLjU2OiBiYWtlIHRoZSBzaGlwcGVkIHZlcnNpb24gaW50byB0aGUgYnVuZGxlIHNvIGEgcnVubmluZyBjbGllbnQgY2FuIHRlbGxcclxuLy8gd2hldGhlciBpdCBpcyBzdGFsZS4gcHVibGljL2FwcC12ZXJzaW9uLmpzb24gaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggXHUyMDE0XHJcbi8vIGl0J3Mgc2VydmVkIHVuaGFzaGVkIGFuZCB1bmNhY2hlZCwgc28gYSBjbGllbnQgY29tcGFyZXMgdGhlIHZlcnNpb24gaXQgd2FzXHJcbi8vIEJVSUxUIHdpdGggKF9fQVBQX1ZFUlNJT05fXykgYWdhaW5zdCB0aGUgdmVyc2lvbiBjdXJyZW50bHkgZGVwbG95ZWQuIEFcclxuLy8gbWlzbWF0Y2ggbWVhbnMgdGhpcyBjbGllbnQgaXMgcnVubmluZyBvbGQgY29kZSwgd2hpY2ggaXMgdGhlIHNpZ25hbCB0aGUgb2xkXHJcbi8vIG5lZWRSZWZyZXNoLW9ubHkgcGF0aCBjb3VsZCBuZXZlciBwcm9kdWNlIGZvciBhIHJldHVybmluZyB2aXNpdG9yLlxyXG4vL1xyXG4vLyB2MC42NCBcdTIwMTQgdGhpcyBmaWxlIGRyaWZ0ZWQsIGFuZCB0aGUgZHJpZnQgd2FzIHNpbGVudCBhbmQgZXhwZW5zaXZlLlxyXG4vL1xyXG4vLyBJdCBzYXQgYXQgeyB2ZXJzaW9uOiBcIjAuNTlcIiwgY3JpdGljYWw6IHRydWUgfSBmcm9tIHRoZSB2MC41OSBob3RmaXggdW50aWxcclxuLy8gdjAuNjMuMi4gVHdvIGNvbnNlcXVlbmNlcywgbmVpdGhlciBvZiB3aGljaCBwcm9kdWNlZCBhbiBlcnJvciBhbnl3aGVyZTpcclxuLy9cclxuLy8gICAxLiBgY3JpdGljYWw6IHRydWVgIGlzIHJlYWQgYnkgQk9USCBwYXRocyBpbiBQV0FVcGRhdGVQcm9tcHQuIE9uIHBhdGggMSBpdFxyXG4vLyAgICAgIG1lYW5zIGEgbmV3bHktYXJyaXZlZCBzZXJ2aWNlIHdvcmtlciBhdXRvLWFwcGxpZXMgaW5zdGVhZCBvZiBzaG93aW5nIHRoZVxyXG4vLyAgICAgIGRpc21pc3NpYmxlIHRvYXN0IFx1MjAxNCBzbyBldmVyeSBkZXBsb3kgZm9yY2UtcmVsb2FkZWQgZXZlcnkgb3BlbiB0YWIsIHdoaWNoXHJcbi8vICAgICAgaXMgZXhhY3RseSB0aGUgYmVoYXZpb3VyIHJlZ2lzdGVyVHlwZTogJ3Byb21wdCcgd2FzIGFkb3B0ZWQgaW4gdjAuNDUgdG9cclxuLy8gICAgICBzdG9wLiBBIHJlYWRlciB3aG8gc3RlcHBlZCBhd2F5IG1pZC1zZXNzaW9uIGNhbWUgYmFjayB0byBhIHJlbG9hZGVkIHBhZ2VcclxuLy8gICAgICBhbmQgbG9zdCB3aGF0ZXZlciB3YXMgaW4gY29tcG9uZW50IHN0YXRlLlxyXG4vL1xyXG4vLyAgIDIuIEJlY2F1c2UgdGhlIHZlcnNpb24gbmV2ZXIgbW92ZWQsIF9fQVBQX1ZFUlNJT05fXyAoYmFrZWQgZnJvbSB0aGlzIGZpbGVcclxuLy8gICAgICBhdCBidWlsZCB0aW1lKSBhbHdheXMgZXF1YWxsZWQgdGhlIGRlcGxveWVkIHZhbHVlLCBzbyBwYXRoIDIgXHUyMDE0IHRoZVxyXG4vLyAgICAgIHN0YWxlLWNsaWVudCBjYXRjaCBhZGRlZCBpbiB2MC41NiBcdTIwMTQgY291bGQgbmV2ZXIgZmlyZSBhdCBhbGwuIFRoZSBmZWF0dXJlXHJcbi8vICAgICAgd2FzIGluZXJ0IGZvciBmb3VyIHJlbGVhc2VzLlxyXG4vL1xyXG4vLyBBIHZlcnNpb24gdGhhdCBtdXN0IGJlIGhhbmQtYnVtcGVkIGluIHR3byBwbGFjZXMgd2lsbCBiZSB3cm9uZyBldmVudHVhbGx5LlxyXG4vLyByZWxlYXNlcy5qcyBhbHJlYWR5IGhhcyBDVVJSRU5UX1ZFUlNJT04gYW5kIGlzIGVkaXRlZCBvbiBldmVyeSByZWxlYXNlXHJcbi8vIGJlY2F1c2UgdGhlIG5vdGVzIG1vZGFsIHJlYWRzIGl0LCBzbyBpdCBpcyB0aGUgaG9uZXN0IHNvdXJjZSBvZiB0cnV0aC4gVGhpc1xyXG4vLyBkZXJpdmVzIGZyb20gaXQgYW5kIHRyZWF0cyBkaXNhZ3JlZW1lbnQgYXMgYSBidWlsZCBmYWlsdXJlIHJhdGhlciB0aGFuXHJcbi8vIHNvbWV0aGluZyB0byBub3RpY2UgbGF0ZXIgaW4gYSBSRUFETUUgZm9vdG5vdGUuXHJcbmZ1bmN0aW9uIHJlYWRDdXJyZW50VmVyc2lvbkZyb21SZWxlYXNlcygpIHtcclxuICBjb25zdCBzcmMgPSBmcy5yZWFkRmlsZVN5bmMocGF0aC5yZXNvbHZlKFJPT1QsICdzcmMvbGliL3JlbGVhc2VzLmpzJyksICd1dGY4Jyk7XHJcbiAgY29uc3QgbSA9IHNyYy5tYXRjaCgvZXhwb3J0IGNvbnN0IENVUlJFTlRfVkVSU0lPTlxccyo9XFxzKlsnXCJddj8oW14nXCJdKylbJ1wiXS8pO1xyXG4gIGlmICghbSkgdGhyb3cgbmV3IEVycm9yKCd2aXRlLmNvbmZpZzogY291bGQgbm90IHJlYWQgQ1VSUkVOVF9WRVJTSU9OIGZyb20gc3JjL2xpYi9yZWxlYXNlcy5qcycpO1xyXG4gIHJldHVybiBtWzFdO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZWFkQXBwVmVyc2lvbigpIHtcclxuICBjb25zdCBleHBlY3RlZCA9IHJlYWRDdXJyZW50VmVyc2lvbkZyb21SZWxlYXNlcygpO1xyXG4gIGxldCBkZWNsYXJlZDtcclxuICB0cnkge1xyXG4gICAgZGVjbGFyZWQgPSBKU09OLnBhcnNlKGZzLnJlYWRGaWxlU3luYyhwYXRoLnJlc29sdmUoUk9PVCwgJ3B1YmxpYy9hcHAtdmVyc2lvbi5qc29uJyksICd1dGY4JykpLnZlcnNpb247XHJcbiAgfSBjYXRjaCB7XHJcbiAgICByZXR1cm4gJ3Vua25vd24nOyAvLyB1bnJlYWRhYmxlIGZpbGUgbmV2ZXIgYmxvY2tzIGEgYnVpbGQ7IHRoZSBjaGVjayBqdXN0IG5vLW9wcyAoc2VlIFBXQVVwZGF0ZVByb21wdClcclxuICB9XHJcbiAgaWYgKGRlY2xhcmVkICE9PSBleHBlY3RlZCkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICBgdml0ZS5jb25maWc6IHB1YmxpYy9hcHAtdmVyc2lvbi5qc29uIHNheXMgXCIke2RlY2xhcmVkfVwiIGJ1dCByZWxlYXNlcy5qcyBDVVJSRU5UX1ZFUlNJT04gaXMgYCArXHJcbiAgICAgIGBcIiR7ZXhwZWN0ZWR9XCIuIEJ1bXAgYXBwLXZlcnNpb24uanNvbiB0byBcIiR7ZXhwZWN0ZWR9XCIuIEEgc3RhbGUgdmVyc2lvbiBoZXJlIHNpbGVudGx5IGRpc2FibGVzIGAgK1xyXG4gICAgICBgdGhlIHN0YWxlLWNsaWVudCBjaGVjayBpbiBQV0FVcGRhdGVQcm9tcHQgXHUyMDE0IHNlZSB0aGUgbm90ZSBhYm92ZS5gXHJcbiAgICApO1xyXG4gIH1cclxuICByZXR1cm4gZGVjbGFyZWQ7XHJcbn1cclxuY29uc3QgQVZBVEFSX01BTklGRVNUX0lEID0gJ3ZpcnR1YWw6YXZhdGFyLW1hbmlmZXN0JztcclxuY29uc3QgUkVTT0xWRURfQVZBVEFSX01BTklGRVNUX0lEID0gJ1xcMCcgKyBBVkFUQVJfTUFOSUZFU1RfSUQ7XHJcblxyXG5mdW5jdGlvbiBhdmF0YXJNYW5pZmVzdCgpIHtcclxuICBjb25zdCBsaXN0ID0gKCkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgcmV0dXJuIGZzLnJlYWRkaXJTeW5jKEFWQVRBUlNfRElSKS5maWx0ZXIoKGYpID0+IGYuZW5kc1dpdGgoJy5zdmcnKSkuc29ydCgpO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuICB9O1xyXG4gIHJldHVybiB7XHJcbiAgICBuYW1lOiAnYXZhdGFyLW1hbmlmZXN0JyxcclxuICAgIHJlc29sdmVJZChpZCkge1xyXG4gICAgICBpZiAoaWQgPT09IEFWQVRBUl9NQU5JRkVTVF9JRCkgcmV0dXJuIFJFU09MVkVEX0FWQVRBUl9NQU5JRkVTVF9JRDtcclxuICAgIH0sXHJcbiAgICBsb2FkKGlkKSB7XHJcbiAgICAgIGlmIChpZCA9PT0gUkVTT0xWRURfQVZBVEFSX01BTklGRVNUX0lEKSB7XHJcbiAgICAgICAgcmV0dXJuIGBleHBvcnQgZGVmYXVsdCAke0pTT04uc3RyaW5naWZ5KGxpc3QoKSl9O2A7XHJcbiAgICAgIH1cclxuICAgIH0sXHJcbiAgICBjb25maWd1cmVTZXJ2ZXIoc2VydmVyKSB7XHJcbiAgICAgIHNlcnZlci53YXRjaGVyLmFkZChBVkFUQVJTX0RJUik7XHJcbiAgICAgIGNvbnN0IGludmFsaWRhdGUgPSAoZmlsZSkgPT4ge1xyXG4gICAgICAgIGlmICghZmlsZS5pbmNsdWRlcygnYXZhdGFycycpIHx8ICFmaWxlLmVuZHNXaXRoKCcuc3ZnJykpIHJldHVybjtcclxuICAgICAgICBjb25zdCBtb2QgPSBzZXJ2ZXIubW9kdWxlR3JhcGguZ2V0TW9kdWxlQnlJZChSRVNPTFZFRF9BVkFUQVJfTUFOSUZFU1RfSUQpO1xyXG4gICAgICAgIGlmIChtb2QpIHtcclxuICAgICAgICAgIHNlcnZlci5tb2R1bGVHcmFwaC5pbnZhbGlkYXRlTW9kdWxlKG1vZCk7XHJcbiAgICAgICAgICBzZXJ2ZXIud3Muc2VuZCh7IHR5cGU6ICdmdWxsLXJlbG9hZCcgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9O1xyXG4gICAgICBzZXJ2ZXIud2F0Y2hlci5vbignYWRkJywgaW52YWxpZGF0ZSk7XHJcbiAgICAgIHNlcnZlci53YXRjaGVyLm9uKCd1bmxpbmsnLCBpbnZhbGlkYXRlKTtcclxuICAgIH0sXHJcbiAgfTtcclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICBkZWZpbmU6IHtcclxuICAgIF9fQVBQX1ZFUlNJT05fXzogSlNPTi5zdHJpbmdpZnkocmVhZEFwcFZlcnNpb24oKSksXHJcbiAgfSxcclxuXHJcbiAgLy8gV2F0Y2ggYWxsIFNDU1MgcGFydGlhbHMgaW4gc3ViZGlyZWN0b3JpZXMgc28gSE1SIHRyaWdnZXJzIG9uIGFueSBzdHlsZSBjaGFuZ2VcclxuICBzZXJ2ZXI6IHtcclxuICAgIHdhdGNoOiB7XHJcbiAgICAgIHVzZVBvbGxpbmc6IGZhbHNlLFxyXG4gICAgICBpZ25vcmVkOiBbJyEqKi9zcmMvc3R5bGVzLyoqJ10sXHJcbiAgICB9LFxyXG4gIH0sXHJcblxyXG4gIGNzczoge1xyXG4gICAgcHJlcHJvY2Vzc29yT3B0aW9uczoge1xyXG4gICAgICBzY3NzOiB7XHJcbiAgICAgICAgLy8gQWxsb3dzIEB1c2UgcGF0aHMgdG8gcmVzb2x2ZSBmcm9tIHRoZSBzdHlsZXMgcm9vdFxyXG4gICAgICAgIGxvYWRQYXRoczogWydzcmMvc3R5bGVzJ10sXHJcbiAgICAgIH0sXHJcbiAgICB9LFxyXG4gIH0sXHJcblxyXG4gIHBsdWdpbnM6IFtcclxuICAgIHJlYWN0KCksXHJcbiAgICBhdmF0YXJNYW5pZmVzdCgpLFxyXG4gICAgVml0ZVBXQSh7XHJcbiAgICAgIC8vIHYwLjQ1OiBzd2l0Y2hlZCBmcm9tICdhdXRvVXBkYXRlJyB0byAncHJvbXB0Jy4gYXV0b1VwZGF0ZSBmb3JjZS1yZWxvYWRlZFxyXG4gICAgICAvLyBldmVyeSBvcGVuIGNsaWVudCB0aGUgbW9tZW50IGEgbmV3IFNXIHRvb2sgY29udHJvbCBvbiBlYWNoIGRlcGxveS4gVGhhdFxyXG4gICAgICAvLyByZWxvYWQgcmFjZWQgU3VwYWJhc2UncyB0b2tlbiByZWZyZXNoOyB3aXRoIHNpbmdsZS11c2UgcmVmcmVzaC10b2tlblxyXG4gICAgICAvLyByb3RhdGlvbiwgdGhlIGxvc2luZyByZXF1ZXN0IGdvdCBcIkludmFsaWQgUmVmcmVzaCBUb2tlbjogQWxyZWFkeSBVc2VkXCJcclxuICAgICAgLy8gYW5kIHRoZSBjbGllbnQgcHVyZ2VkIHNiLTxyZWY+LWF1dGgtdG9rZW4gZnJvbSBsb2NhbFN0b3JhZ2UgXHUyMDE0IGxvZ2dpbmdcclxuICAgICAgLy8gdXNlcnMgb3V0IG9uIGV2ZXJ5IGRlcGxveS4gJ3Byb21wdCcgbGV0cyB0aGUgdXNlciB1cGRhdGUgb24gdGhlaXIgdGVybXNcclxuICAgICAgLy8gKHNlZSBQV0FVcGRhdGVQcm9tcHQpLCBzbyBubyBtaWQtc2Vzc2lvbiByZWxvYWQgYW5kIG5vIGxvc3Qgc2Vzc2lvbi5cclxuICAgICAgcmVnaXN0ZXJUeXBlOiAncHJvbXB0JyxcclxuICAgICAgd29ya2JveDoge1xyXG4gICAgICAgIC8vIHYwLjU2OiBza2lwV2FpdGluZyArIGNsaWVudHNDbGFpbS4gRGVsaWJlcmF0ZWx5IE5PVCBhIHdhbGstYmFjayBvZiB0aGVcclxuICAgICAgICAvLyB2MC40NSBkZWNpc2lvbiBhYm92ZSBcdTIwMTQgdGhlIHR3byBzZXR0aW5ncyBkbyBkaWZmZXJlbnQgdGhpbmdzLCBhbmQgaXRcclxuICAgICAgICAvLyB3YXMgdGhlIHJlbG9hZCwgbm90IHRoZSBhY3RpdmF0aW9uLCB0aGF0IGxvZ2dlZCBwZW9wbGUgb3V0LlxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy8gQmVmb3JlIHRoaXMsIGEgbmV3IFNXIGluc3RhbGxlZCBhbmQgdGhlbiBXQUlURUQuIEEgd2FpdGluZyB3b3JrZXIgb25seVxyXG4gICAgICAgIC8vIGFjdGl2YXRlcyBvbmNlIGV2ZXJ5IHRhYiBmb3IgdGhlIG9yaWdpbiBjbG9zZXMsIHNvIGFueW9uZSBrZWVwaW5nIHRoZVxyXG4gICAgICAgIC8vIHNpdGUgaW4gYSBiYWNrZ3JvdW5kIHRhYiBvciBhcyBhIGhvbWUtc2NyZWVuIGluc3RhbGwgY291bGQgc2l0IG9uIGFcclxuICAgICAgICAvLyBzdGFsZSB3b3JrZXIgaW5kZWZpbml0ZWx5LiBUaGF0J3MgdGhlIGNvaG9ydCB0aGF0IGtlcHQgc2VlaW5nIHRoZSBvbGRcclxuICAgICAgICAvLyBsYW5kaW5nIHBhZ2U6IHRoZWlyIGJyb3dzZXIgaGFkIGFscmVhZHkgZG93bmxvYWRlZCB0aGUgbmV3IGJ1aWxkIGFuZFxyXG4gICAgICAgIC8vIHdhcyByZWZ1c2luZyB0byBhY3RpdmF0ZSBpdC5cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vIHNraXBXYWl0aW5nIGFjdGl2YXRlcyB0aGUgbmV3IHdvcmtlciBvbiBpbnN0YWxsOyBjbGllbnRzQ2xhaW0gbGV0cyBpdFxyXG4gICAgICAgIC8vIHRha2UgY29udHJvbCBvZiBhbHJlYWR5LW9wZW4gcGFnZXMuIE5laXRoZXIgcmVsb2FkcyBhbnl0aGluZyBcdTIwMTQgdGhlXHJcbiAgICAgICAgLy8gcnVubmluZyBwYWdlIGtlZXBzIHRoZSBidW5kbGUgaXQgYWxyZWFkeSBoYXMgaW4gbWVtb3J5IGFuZCBwaWNrcyB1cFxyXG4gICAgICAgIC8vIG5ldyBjb2RlIG9uIGl0cyBuZXh0IG5hdmlnYXRpb24uIHJlZ2lzdGVyVHlwZSBzdGF5cyAncHJvbXB0Jywgc28gdGhlXHJcbiAgICAgICAgLy8gZm9yY2VkLXJlbG9hZCBiZWhhdmlvdXIgdGhhdCByYWNlZCBTdXBhYmFzZSdzIHNpbmdsZS11c2UgcmVmcmVzaC10b2tlblxyXG4gICAgICAgIC8vIHJvdGF0aW9uIGlzIHN0aWxsIGdvbmUuIFRoYXQgcmVsb2FkIG5vdyBvbmx5IGV2ZXIgaGFwcGVucyB2aWFcclxuICAgICAgICAvLyBQV0FVcGRhdGVQcm9tcHQsIHdoaWNoIGF3YWl0cyBnZXRTZXNzaW9uKCkgZmlyc3QuXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvLyBTYWZlIGhlcmUgc3BlY2lmaWNhbGx5IGJlY2F1c2UgdGhlIGJ1aWxkIGVtaXRzIG9uZSBKUyBidW5kbGUgKHRoZSBsb25lXHJcbiAgICAgICAgLy8gZHluYW1pYyBpbXBvcnQgaW4gZW5yaWNobWVudFNlcnZpY2UuanMgaXMgaW5saW5lZCkuIFRoZSB1c3VhbCBoYXphcmQgb2ZcclxuICAgICAgICAvLyBhY3RpdmF0aW5nIG1pZC1zZXNzaW9uIGlzIGEgcnVubmluZyBwYWdlIGxhenktbG9hZGluZyBhIGNodW5rIHRoYXQgdGhlXHJcbiAgICAgICAgLy8gbmV3IHByZWNhY2hlIGp1c3QgZXZpY3RlZDsgd2l0aCBubyBzcGxpdCBjaHVua3MgdGhlcmUgaXMgbm90aGluZyB0b1xyXG4gICAgICAgIC8vIGV2aWN0IG91dCBmcm9tIHVuZGVyIGl0LiBSZXZpc2l0IHRoaXMgaWYgY29kZSBzcGxpdHRpbmcgaXMgaW50cm9kdWNlZC5cclxuICAgICAgICBza2lwV2FpdGluZzogdHJ1ZSxcclxuICAgICAgICBjbGllbnRzQ2xhaW06IHRydWUsXHJcbiAgICAgICAgZ2xvYlBhdHRlcm5zOiBbJyoqLyoue2pzLGNzcyxodG1sLGljbyxwbmcsc3ZnLHdvZmYyfSddLFxyXG4gICAgICAgIC8vIHYwLjYxLjI6IGtlZXAgdGhlIFNQQSBuYXZpZ2F0aW9uIGZhbGxiYWNrIG9mZiByb3V0ZXMgdGhhdCBhcmUgc2VydmVkXHJcbiAgICAgICAgLy8gYnkgTmV0bGlmeSwgbm90IGJ5IHRoZSBhcHAuXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvLyB2aXRlLXBsdWdpbi1wd2EgcmVnaXN0ZXJzIGEgTmF2aWdhdGlvblJvdXRlIGJvdW5kIHRvIGluZGV4Lmh0bWwgd2l0aFxyXG4gICAgICAgIC8vIG5vIGRlbnlsaXN0IGJ5IGRlZmF1bHQuIFRoYXQgaXMgY29ycmVjdCBmb3IgY2xpZW50LXNpZGUgcm91dGVzIFx1MjAxNCBpdFxyXG4gICAgICAgIC8vIGlzIHdoYXQgbWFrZXMgL3dpc2hsaXN0IHdvcmsgb2ZmbGluZSBcdTIwMTQgYnV0IGEgTmF2aWdhdGlvblJvdXRlIG1hdGNoZXNcclxuICAgICAgICAvLyBBTlkgbmF2aWdhdGlvbiByZXF1ZXN0LCBpbmNsdWRpbmcgdHlwaW5nIC9zaXRlbWFwLnhtbCBpbnRvIHRoZVxyXG4gICAgICAgIC8vIGFkZHJlc3MgYmFyLiBUaGUgd29ya2VyIGFuc3dlcmVkIHdpdGggY2FjaGVkIGluZGV4Lmh0bWwsIFJlYWN0XHJcbiAgICAgICAgLy8gcm91dGVkIG9uIGEgcGF0aCBpdCBkb2Vzbid0IGtub3csIGFuZCByZW5kZXJlZCB0aGUgYXBwJ3Mgb3duIDQwNC5cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vIFRoZSBzZXJ2ZXIgd2FzIG5ldmVyIHdyb25nOiAvc2l0ZW1hcC54bWwgcmV0dXJucyBhcHBsaWNhdGlvbi94bWwgd2l0aFxyXG4gICAgICAgIC8vIGEgMjAwIHRoZSB3aG9sZSB0aW1lLiBPbmx5IGJyb3dzZXJzIHRoYXQgaGFkIHJlZ2lzdGVyZWQgdGhlIHdvcmtlclxyXG4gICAgICAgIC8vIHNhdyBhIDQwNCwgd2hpY2ggbWFkZSB0aGUgc2l0ZW1hcCBpbXBvc3NpYmxlIHRvIHZlcmlmeSBieSBleWUgXHUyMDE0IGFuZFxyXG4gICAgICAgIC8vIG1hZGUgaXQgbG9vayBsaWtlIHRoZSBOZXRsaWZ5IHJlZGlyZWN0IGhhZCBicm9rZW4uXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvLyBHb29nbGVib3QgZG9lcyBub3QgcnVuIHNlcnZpY2Ugd29ya2Vycywgc28gaW5kZXhpbmcgd2FzIG5ldmVyXHJcbiAgICAgICAgLy8gYWZmZWN0ZWQuIFRoaXMgaXMgYSBcInlvdSBjYW5ub3QgY2hlY2sgeW91ciBvd24gd29ya1wiIGJ1ZyByYXRoZXIgdGhhblxyXG4gICAgICAgIC8vIGFuIFNFTyBvbmUsIHdoaWNoIGlzIGV4YWN0bHkgd2h5IGl0IHN1cnZpdmVkIHRoaXMgbG9uZy5cclxuICAgICAgICBuYXZpZ2F0ZUZhbGxiYWNrRGVueWxpc3Q6IFtcclxuICAgICAgICAgIC9eXFwvc2l0ZW1hcFxcLnhtbCQvLFxyXG4gICAgICAgICAgL15cXC9yb2JvdHNcXC50eHQkLyxcclxuICAgICAgICAgIC8vIEZ1bmN0aW9uIGFuZCBlZGdlLWZ1bmN0aW9uIHBhdGhzLiBzaGFyZS1jYXJkIGFuZCBvZy1wcmVyZW5kZXIgYXJlXHJcbiAgICAgICAgICAvLyByZWFjaGVkIGRpcmVjdGx5IGluIHNvbWUgZmxvd3M7IG5vbmUgb2YgdGhlbSBhcmUgYXBwIHJvdXRlcy5cclxuICAgICAgICAgIC9eXFwvXFwubmV0bGlmeVxcLy8sXHJcbiAgICAgICAgXSxcclxuICAgICAgICAvLyBTaGFyZS1jYXJkIGZyYW1lL2FydCAocHVibGljL2NhcmRzLyoqKSBhcmUgbGFyZ2UgKDItMyBNQiBlYWNoKSBhbmQgb25seVxyXG4gICAgICAgIC8vIGZldGNoZWQgb24gZGVtYW5kIHdoZW4gYSB1c2VyIHNoYXJlcyBcdTIwMTQgbmV2ZXIgbmVlZGVkIG9mZmxpbmUuIEtlZXAgdGhlbVxyXG4gICAgICAgIC8vIG91dCBvZiB0aGUgU1cgcHJlY2FjaGUgc28gdGhleSBkb24ndCBleGNlZWQgdGhlIHNpemUgbGltaXQgKHdoaWNoIGZhaWxzXHJcbiAgICAgICAgLy8gdGhlIGJ1aWxkKSBvciBibG9hdCB0aGUgaW5zdGFsbCB3aXRoIHRlbnMgb2YgTUIgb2YgaW1hZ2VzLlxyXG4gICAgICAgIGdsb2JJZ25vcmVzOiBbJyoqL2NhcmRzLyoqJ10sXHJcbiAgICAgICAgcnVudGltZUNhY2hpbmc6IFt7XHJcbiAgICAgICAgICAgIC8vIEdvb2dsZSBGb250cyBzdHlsZXNoZWV0c1xyXG4gICAgICAgICAgICB1cmxQYXR0ZXJuOiAvXmh0dHBzOlxcL1xcL2ZvbnRzXFwuZ29vZ2xlYXBpc1xcLmNvbVxcLy4qL2ksXHJcbiAgICAgICAgICAgIGhhbmRsZXI6ICdDYWNoZUZpcnN0JyxcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgIGNhY2hlTmFtZTogJ2dvb2dsZS1mb250cy1jYWNoZScsXHJcbiAgICAgICAgICAgICAgZXhwaXJhdGlvbjoge1xyXG4gICAgICAgICAgICAgICAgbWF4RW50cmllczogMTAsXHJcbiAgICAgICAgICAgICAgICBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgKiAzNjVcclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgIGNhY2hlYWJsZVJlc3BvbnNlOiB7XHJcbiAgICAgICAgICAgICAgICBzdGF0dXNlczogWzAsIDIwMF1cclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgLy8gR29vZ2xlIEZvbnRzIGZpbGVzXHJcbiAgICAgICAgICAgIHVybFBhdHRlcm46IC9eaHR0cHM6XFwvXFwvZm9udHNcXC5nc3RhdGljXFwuY29tXFwvLiovaSxcclxuICAgICAgICAgICAgaGFuZGxlcjogJ0NhY2hlRmlyc3QnLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgY2FjaGVOYW1lOiAnZ3N0YXRpYy1mb250cy1jYWNoZScsXHJcbiAgICAgICAgICAgICAgZXhwaXJhdGlvbjoge1xyXG4gICAgICAgICAgICAgICAgbWF4RW50cmllczogMTAsXHJcbiAgICAgICAgICAgICAgICBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgKiAzNjVcclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgIGNhY2hlYWJsZVJlc3BvbnNlOiB7XHJcbiAgICAgICAgICAgICAgICBzdGF0dXNlczogWzAsIDIwMF1cclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIC8vIHYwLjQ0OiB0aGUgYm9vay1jb3ZlcnMgQ2FjaGVGaXJzdCByb3V0ZSB3YXMgcmVtb3ZlZC4gV2hlbiBhIGNvdmVyXHJcbiAgICAgICAgICAvLyB3YXNuJ3QgY2FjaGVkIHlldCBBTkQgdGhlIGhvc3QgcmVmdXNlZCB0aGUgZmV0Y2ggKE9wZW4gTGlicmFyeVxyXG4gICAgICAgICAgLy8gcmF0ZS1saW1pdHMgaG90bGlua3MpLCB3b3JrYm94IHN1cmZhY2VkIGFuIHVuaGFuZGxlZCBcIm5vLXJlc3BvbnNlXCJcclxuICAgICAgICAgIC8vIHJlamVjdGlvbiBwZXIgaW1hZ2UgXHUyMDE0IHB1cmUgY29uc29sZSBub2lzZSBzaW5jZSBCb29rQ292ZXIgYWxyZWFkeVxyXG4gICAgICAgICAgLy8gZmFsbHMgYmFjayB0byBhIHBsYWNlaG9sZGVyIG9uRXJyb3IuIFdpdGhvdXQgdGhlIHJvdXRlLCBjb3ZlcnMgdXNlXHJcbiAgICAgICAgICAvLyB0aGUgbm9ybWFsIGJyb3dzZXIgSFRUUCBjYWNoZTsgb25seSBvZmZsaW5lIGNvdmVyIGRpc3BsYXkgaXMgbG9zdC5cclxuICAgICAgICBdLFxyXG4gICAgICB9LFxyXG4gICAgICBtYW5pZmVzdDogZmFsc2UsXHJcbiAgICAgIGRldk9wdGlvbnM6IHtcclxuICAgICAgICBlbmFibGVkOiBmYWxzZVxyXG4gICAgICB9LFxyXG4gICAgfSksXHJcbiAgXSxcclxufSk7Il0sCiAgIm1hcHBpbmdzIjogIjtBQUFrWDtBQUFBLEVBQ2hYO0FBQUEsT0FDSztBQUNQLE9BQU8sV0FBVztBQUNsQjtBQUFBLEVBQ0U7QUFBQSxPQUNLO0FBQ1AsT0FBTyxRQUFRO0FBQ2YsT0FBTyxVQUFVO0FBQ2pCLFNBQVMscUJBQXFCO0FBVDBNLElBQU0sMkNBQTJDO0FBaUJ6UixJQUFNLE9BQU8sS0FBSyxRQUFRLGNBQWMsd0NBQWUsQ0FBQztBQUN4RCxJQUFNLGNBQWMsS0FBSyxRQUFRLE1BQU0sZ0JBQWdCO0FBK0J2RCxTQUFTLGlDQUFpQztBQUN4QyxRQUFNLE1BQU0sR0FBRyxhQUFhLEtBQUssUUFBUSxNQUFNLHFCQUFxQixHQUFHLE1BQU07QUFDN0UsUUFBTSxJQUFJLElBQUksTUFBTSx1REFBdUQ7QUFDM0UsTUFBSSxDQUFDLEVBQUcsT0FBTSxJQUFJLE1BQU0sc0VBQXNFO0FBQzlGLFNBQU8sRUFBRSxDQUFDO0FBQ1o7QUFF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
