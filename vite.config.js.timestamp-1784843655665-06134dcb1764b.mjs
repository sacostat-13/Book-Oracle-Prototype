// vite.config.js
import {
  defineConfig
} from "file:///sessions/nifty-exciting-turing/mnt/Book-Oracle-Prototype/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/nifty-exciting-turing/mnt/Book-Oracle-Prototype/node_modules/@vitejs/plugin-react/dist/index.js";
import {
  VitePWA
} from "file:///sessions/nifty-exciting-turing/mnt/Book-Oracle-Prototype/node_modules/vite-plugin-pwa/dist/index.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var __vite_injected_original_import_meta_url = "file:///sessions/nifty-exciting-turing/mnt/Book-Oracle-Prototype/vite.config.js";
var ROOT = path.dirname(fileURLToPath(__vite_injected_original_import_meta_url));
var AVATARS_DIR = path.resolve(ROOT, "public/avatars");
function readAppVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(ROOT, "public/app-version.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvbmlmdHktZXhjaXRpbmctdHVyaW5nL21udC9Cb29rLU9yYWNsZS1Qcm90b3R5cGVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9zZXNzaW9ucy9uaWZ0eS1leGNpdGluZy10dXJpbmcvbW50L0Jvb2stT3JhY2xlLVByb3RvdHlwZS92aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vc2Vzc2lvbnMvbmlmdHktZXhjaXRpbmctdHVyaW5nL21udC9Cb29rLU9yYWNsZS1Qcm90b3R5cGUvdml0ZS5jb25maWcuanNcIjtpbXBvcnQge1xyXG4gIGRlZmluZUNvbmZpZ1xyXG59IGZyb20gJ3ZpdGUnO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xyXG5pbXBvcnQge1xyXG4gIFZpdGVQV0FcclxufSBmcm9tICd2aXRlLXBsdWdpbi1wd2EnO1xyXG5pbXBvcnQgZnMgZnJvbSAnbm9kZTpmcyc7XHJcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XHJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XHJcblxyXG4vLyB2MC41MjogdmlydHVhbCBtb2R1bGUgbGlzdGluZyBwdWJsaWMvYXZhdGFycy8qLnN2Zywgc28gdGhlIHByZXNldCBhdmF0YXJcclxuLy8gZ2FsbGVyeSBpcyBkcml2ZW4gYnkgdGhlIGZvbGRlcidzIGNvbnRlbnRzIFx1MjAxNCBkcm9wIGEgbmV3IFNWRyBpbiwgaXQgc2hvd3MgdXBcclxuLy8gaW4gdGhlIFByb2ZpbGUgcGlja2VyOyBubyBtYW5pZmVzdCBhcnJheSB0byBtYWludGFpbiAoc2VlIHNyYy9saWIvYXZhdGFycy5qc1xyXG4vLyBmb3IgdGhlIGZpbGVuYW1lIGNvbnZlbnRpb24pLiBEZXYgc2VydmVyIGludmFsaWRhdGVzIG9uIGFkZC9yZW1vdmUsIHNvIG5ld1xyXG4vLyBmaWxlcyBhcHBlYXIgd2l0aG91dCBhIHJlc3RhcnQ7IHByb2R1Y3Rpb24gYmFrZXMgdGhlIGxpc3QgYXQgYnVpbGQgdGltZVxyXG4vLyAoYWRkaW5nIGZpbGVzIG1lYW5zIGEgZGVwbG95IGFueXdheSBcdTIwMTQgdGhleSBsaXZlIGluIHRoZSByZXBvKS5cclxuY29uc3QgUk9PVCA9IHBhdGguZGlybmFtZShmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCkpO1xyXG5jb25zdCBBVkFUQVJTX0RJUiA9IHBhdGgucmVzb2x2ZShST09ULCAncHVibGljL2F2YXRhcnMnKTtcclxuXHJcbi8vIHYwLjU2OiBiYWtlIHRoZSBzaGlwcGVkIHZlcnNpb24gaW50byB0aGUgYnVuZGxlIHNvIGEgcnVubmluZyBjbGllbnQgY2FuIHRlbGxcclxuLy8gd2hldGhlciBpdCBpcyBzdGFsZS4gcHVibGljL2FwcC12ZXJzaW9uLmpzb24gaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggXHUyMDE0XHJcbi8vIGl0J3Mgc2VydmVkIHVuaGFzaGVkIGFuZCB1bmNhY2hlZCwgc28gYSBjbGllbnQgY29tcGFyZXMgdGhlIHZlcnNpb24gaXQgd2FzXHJcbi8vIEJVSUxUIHdpdGggKF9fQVBQX1ZFUlNJT05fXykgYWdhaW5zdCB0aGUgdmVyc2lvbiBjdXJyZW50bHkgZGVwbG95ZWQuIEFcclxuLy8gbWlzbWF0Y2ggbWVhbnMgdGhpcyBjbGllbnQgaXMgcnVubmluZyBvbGQgY29kZSwgd2hpY2ggaXMgdGhlIHNpZ25hbCB0aGUgb2xkXHJcbi8vIG5lZWRSZWZyZXNoLW9ubHkgcGF0aCBjb3VsZCBuZXZlciBwcm9kdWNlIGZvciBhIHJldHVybmluZyB2aXNpdG9yLlxyXG5mdW5jdGlvbiByZWFkQXBwVmVyc2lvbigpIHtcclxuICB0cnkge1xyXG4gICAgcmV0dXJuIEpTT04ucGFyc2UoZnMucmVhZEZpbGVTeW5jKHBhdGgucmVzb2x2ZShST09ULCAncHVibGljL2FwcC12ZXJzaW9uLmpzb24nKSwgJ3V0ZjgnKSkudmVyc2lvbjtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiAndW5rbm93bic7IC8vIG5ldmVyIGJsb2NrcyBhIGJ1aWxkOyB0aGUgY2hlY2sganVzdCBuby1vcHMgKHNlZSBQV0FVcGRhdGVQcm9tcHQpXHJcbiAgfVxyXG59XHJcbmNvbnN0IEFWQVRBUl9NQU5JRkVTVF9JRCA9ICd2aXJ0dWFsOmF2YXRhci1tYW5pZmVzdCc7XHJcbmNvbnN0IFJFU09MVkVEX0FWQVRBUl9NQU5JRkVTVF9JRCA9ICdcXDAnICsgQVZBVEFSX01BTklGRVNUX0lEO1xyXG5cclxuZnVuY3Rpb24gYXZhdGFyTWFuaWZlc3QoKSB7XHJcbiAgY29uc3QgbGlzdCA9ICgpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIHJldHVybiBmcy5yZWFkZGlyU3luYyhBVkFUQVJTX0RJUikuZmlsdGVyKChmKSA9PiBmLmVuZHNXaXRoKCcuc3ZnJykpLnNvcnQoKTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcbiAgfTtcclxuICByZXR1cm4ge1xyXG4gICAgbmFtZTogJ2F2YXRhci1tYW5pZmVzdCcsXHJcbiAgICByZXNvbHZlSWQoaWQpIHtcclxuICAgICAgaWYgKGlkID09PSBBVkFUQVJfTUFOSUZFU1RfSUQpIHJldHVybiBSRVNPTFZFRF9BVkFUQVJfTUFOSUZFU1RfSUQ7XHJcbiAgICB9LFxyXG4gICAgbG9hZChpZCkge1xyXG4gICAgICBpZiAoaWQgPT09IFJFU09MVkVEX0FWQVRBUl9NQU5JRkVTVF9JRCkge1xyXG4gICAgICAgIHJldHVybiBgZXhwb3J0IGRlZmF1bHQgJHtKU09OLnN0cmluZ2lmeShsaXN0KCkpfTtgO1xyXG4gICAgICB9XHJcbiAgICB9LFxyXG4gICAgY29uZmlndXJlU2VydmVyKHNlcnZlcikge1xyXG4gICAgICBzZXJ2ZXIud2F0Y2hlci5hZGQoQVZBVEFSU19ESVIpO1xyXG4gICAgICBjb25zdCBpbnZhbGlkYXRlID0gKGZpbGUpID0+IHtcclxuICAgICAgICBpZiAoIWZpbGUuaW5jbHVkZXMoJ2F2YXRhcnMnKSB8fCAhZmlsZS5lbmRzV2l0aCgnLnN2ZycpKSByZXR1cm47XHJcbiAgICAgICAgY29uc3QgbW9kID0gc2VydmVyLm1vZHVsZUdyYXBoLmdldE1vZHVsZUJ5SWQoUkVTT0xWRURfQVZBVEFSX01BTklGRVNUX0lEKTtcclxuICAgICAgICBpZiAobW9kKSB7XHJcbiAgICAgICAgICBzZXJ2ZXIubW9kdWxlR3JhcGguaW52YWxpZGF0ZU1vZHVsZShtb2QpO1xyXG4gICAgICAgICAgc2VydmVyLndzLnNlbmQoeyB0eXBlOiAnZnVsbC1yZWxvYWQnIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuICAgICAgc2VydmVyLndhdGNoZXIub24oJ2FkZCcsIGludmFsaWRhdGUpO1xyXG4gICAgICBzZXJ2ZXIud2F0Y2hlci5vbigndW5saW5rJywgaW52YWxpZGF0ZSk7XHJcbiAgICB9LFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XHJcbiAgZGVmaW5lOiB7XHJcbiAgICBfX0FQUF9WRVJTSU9OX186IEpTT04uc3RyaW5naWZ5KHJlYWRBcHBWZXJzaW9uKCkpLFxyXG4gIH0sXHJcblxyXG4gIC8vIFdhdGNoIGFsbCBTQ1NTIHBhcnRpYWxzIGluIHN1YmRpcmVjdG9yaWVzIHNvIEhNUiB0cmlnZ2VycyBvbiBhbnkgc3R5bGUgY2hhbmdlXHJcbiAgc2VydmVyOiB7XHJcbiAgICB3YXRjaDoge1xyXG4gICAgICB1c2VQb2xsaW5nOiBmYWxzZSxcclxuICAgICAgaWdub3JlZDogWychKiovc3JjL3N0eWxlcy8qKiddLFxyXG4gICAgfSxcclxuICB9LFxyXG5cclxuICBjc3M6IHtcclxuICAgIHByZXByb2Nlc3Nvck9wdGlvbnM6IHtcclxuICAgICAgc2Nzczoge1xyXG4gICAgICAgIC8vIEFsbG93cyBAdXNlIHBhdGhzIHRvIHJlc29sdmUgZnJvbSB0aGUgc3R5bGVzIHJvb3RcclxuICAgICAgICBsb2FkUGF0aHM6IFsnc3JjL3N0eWxlcyddLFxyXG4gICAgICB9LFxyXG4gICAgfSxcclxuICB9LFxyXG5cclxuICBwbHVnaW5zOiBbXHJcbiAgICByZWFjdCgpLFxyXG4gICAgYXZhdGFyTWFuaWZlc3QoKSxcclxuICAgIFZpdGVQV0Eoe1xyXG4gICAgICAvLyB2MC40NTogc3dpdGNoZWQgZnJvbSAnYXV0b1VwZGF0ZScgdG8gJ3Byb21wdCcuIGF1dG9VcGRhdGUgZm9yY2UtcmVsb2FkZWRcclxuICAgICAgLy8gZXZlcnkgb3BlbiBjbGllbnQgdGhlIG1vbWVudCBhIG5ldyBTVyB0b29rIGNvbnRyb2wgb24gZWFjaCBkZXBsb3kuIFRoYXRcclxuICAgICAgLy8gcmVsb2FkIHJhY2VkIFN1cGFiYXNlJ3MgdG9rZW4gcmVmcmVzaDsgd2l0aCBzaW5nbGUtdXNlIHJlZnJlc2gtdG9rZW5cclxuICAgICAgLy8gcm90YXRpb24sIHRoZSBsb3NpbmcgcmVxdWVzdCBnb3QgXCJJbnZhbGlkIFJlZnJlc2ggVG9rZW46IEFscmVhZHkgVXNlZFwiXHJcbiAgICAgIC8vIGFuZCB0aGUgY2xpZW50IHB1cmdlZCBzYi08cmVmPi1hdXRoLXRva2VuIGZyb20gbG9jYWxTdG9yYWdlIFx1MjAxNCBsb2dnaW5nXHJcbiAgICAgIC8vIHVzZXJzIG91dCBvbiBldmVyeSBkZXBsb3kuICdwcm9tcHQnIGxldHMgdGhlIHVzZXIgdXBkYXRlIG9uIHRoZWlyIHRlcm1zXHJcbiAgICAgIC8vIChzZWUgUFdBVXBkYXRlUHJvbXB0KSwgc28gbm8gbWlkLXNlc3Npb24gcmVsb2FkIGFuZCBubyBsb3N0IHNlc3Npb24uXHJcbiAgICAgIHJlZ2lzdGVyVHlwZTogJ3Byb21wdCcsXHJcbiAgICAgIHdvcmtib3g6IHtcclxuICAgICAgICAvLyB2MC41Njogc2tpcFdhaXRpbmcgKyBjbGllbnRzQ2xhaW0uIERlbGliZXJhdGVseSBOT1QgYSB3YWxrLWJhY2sgb2YgdGhlXHJcbiAgICAgICAgLy8gdjAuNDUgZGVjaXNpb24gYWJvdmUgXHUyMDE0IHRoZSB0d28gc2V0dGluZ3MgZG8gZGlmZmVyZW50IHRoaW5ncywgYW5kIGl0XHJcbiAgICAgICAgLy8gd2FzIHRoZSByZWxvYWQsIG5vdCB0aGUgYWN0aXZhdGlvbiwgdGhhdCBsb2dnZWQgcGVvcGxlIG91dC5cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vIEJlZm9yZSB0aGlzLCBhIG5ldyBTVyBpbnN0YWxsZWQgYW5kIHRoZW4gV0FJVEVELiBBIHdhaXRpbmcgd29ya2VyIG9ubHlcclxuICAgICAgICAvLyBhY3RpdmF0ZXMgb25jZSBldmVyeSB0YWIgZm9yIHRoZSBvcmlnaW4gY2xvc2VzLCBzbyBhbnlvbmUga2VlcGluZyB0aGVcclxuICAgICAgICAvLyBzaXRlIGluIGEgYmFja2dyb3VuZCB0YWIgb3IgYXMgYSBob21lLXNjcmVlbiBpbnN0YWxsIGNvdWxkIHNpdCBvbiBhXHJcbiAgICAgICAgLy8gc3RhbGUgd29ya2VyIGluZGVmaW5pdGVseS4gVGhhdCdzIHRoZSBjb2hvcnQgdGhhdCBrZXB0IHNlZWluZyB0aGUgb2xkXHJcbiAgICAgICAgLy8gbGFuZGluZyBwYWdlOiB0aGVpciBicm93c2VyIGhhZCBhbHJlYWR5IGRvd25sb2FkZWQgdGhlIG5ldyBidWlsZCBhbmRcclxuICAgICAgICAvLyB3YXMgcmVmdXNpbmcgdG8gYWN0aXZhdGUgaXQuXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvLyBza2lwV2FpdGluZyBhY3RpdmF0ZXMgdGhlIG5ldyB3b3JrZXIgb24gaW5zdGFsbDsgY2xpZW50c0NsYWltIGxldHMgaXRcclxuICAgICAgICAvLyB0YWtlIGNvbnRyb2wgb2YgYWxyZWFkeS1vcGVuIHBhZ2VzLiBOZWl0aGVyIHJlbG9hZHMgYW55dGhpbmcgXHUyMDE0IHRoZVxyXG4gICAgICAgIC8vIHJ1bm5pbmcgcGFnZSBrZWVwcyB0aGUgYnVuZGxlIGl0IGFscmVhZHkgaGFzIGluIG1lbW9yeSBhbmQgcGlja3MgdXBcclxuICAgICAgICAvLyBuZXcgY29kZSBvbiBpdHMgbmV4dCBuYXZpZ2F0aW9uLiByZWdpc3RlclR5cGUgc3RheXMgJ3Byb21wdCcsIHNvIHRoZVxyXG4gICAgICAgIC8vIGZvcmNlZC1yZWxvYWQgYmVoYXZpb3VyIHRoYXQgcmFjZWQgU3VwYWJhc2UncyBzaW5nbGUtdXNlIHJlZnJlc2gtdG9rZW5cclxuICAgICAgICAvLyByb3RhdGlvbiBpcyBzdGlsbCBnb25lLiBUaGF0IHJlbG9hZCBub3cgb25seSBldmVyIGhhcHBlbnMgdmlhXHJcbiAgICAgICAgLy8gUFdBVXBkYXRlUHJvbXB0LCB3aGljaCBhd2FpdHMgZ2V0U2Vzc2lvbigpIGZpcnN0LlxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy8gU2FmZSBoZXJlIHNwZWNpZmljYWxseSBiZWNhdXNlIHRoZSBidWlsZCBlbWl0cyBvbmUgSlMgYnVuZGxlICh0aGUgbG9uZVxyXG4gICAgICAgIC8vIGR5bmFtaWMgaW1wb3J0IGluIGVucmljaG1lbnRTZXJ2aWNlLmpzIGlzIGlubGluZWQpLiBUaGUgdXN1YWwgaGF6YXJkIG9mXHJcbiAgICAgICAgLy8gYWN0aXZhdGluZyBtaWQtc2Vzc2lvbiBpcyBhIHJ1bm5pbmcgcGFnZSBsYXp5LWxvYWRpbmcgYSBjaHVuayB0aGF0IHRoZVxyXG4gICAgICAgIC8vIG5ldyBwcmVjYWNoZSBqdXN0IGV2aWN0ZWQ7IHdpdGggbm8gc3BsaXQgY2h1bmtzIHRoZXJlIGlzIG5vdGhpbmcgdG9cclxuICAgICAgICAvLyBldmljdCBvdXQgZnJvbSB1bmRlciBpdC4gUmV2aXNpdCB0aGlzIGlmIGNvZGUgc3BsaXR0aW5nIGlzIGludHJvZHVjZWQuXHJcbiAgICAgICAgc2tpcFdhaXRpbmc6IHRydWUsXHJcbiAgICAgICAgY2xpZW50c0NsYWltOiB0cnVlLFxyXG4gICAgICAgIGdsb2JQYXR0ZXJuczogWycqKi8qLntqcyxjc3MsaHRtbCxpY28scG5nLHN2Zyx3b2ZmMn0nXSxcclxuICAgICAgICAvLyBTaGFyZS1jYXJkIGZyYW1lL2FydCAocHVibGljL2NhcmRzLyoqKSBhcmUgbGFyZ2UgKDItMyBNQiBlYWNoKSBhbmQgb25seVxyXG4gICAgICAgIC8vIGZldGNoZWQgb24gZGVtYW5kIHdoZW4gYSB1c2VyIHNoYXJlcyBcdTIwMTQgbmV2ZXIgbmVlZGVkIG9mZmxpbmUuIEtlZXAgdGhlbVxyXG4gICAgICAgIC8vIG91dCBvZiB0aGUgU1cgcHJlY2FjaGUgc28gdGhleSBkb24ndCBleGNlZWQgdGhlIHNpemUgbGltaXQgKHdoaWNoIGZhaWxzXHJcbiAgICAgICAgLy8gdGhlIGJ1aWxkKSBvciBibG9hdCB0aGUgaW5zdGFsbCB3aXRoIHRlbnMgb2YgTUIgb2YgaW1hZ2VzLlxyXG4gICAgICAgIGdsb2JJZ25vcmVzOiBbJyoqL2NhcmRzLyoqJ10sXHJcbiAgICAgICAgcnVudGltZUNhY2hpbmc6IFt7XHJcbiAgICAgICAgICAgIC8vIEdvb2dsZSBGb250cyBzdHlsZXNoZWV0c1xyXG4gICAgICAgICAgICB1cmxQYXR0ZXJuOiAvXmh0dHBzOlxcL1xcL2ZvbnRzXFwuZ29vZ2xlYXBpc1xcLmNvbVxcLy4qL2ksXHJcbiAgICAgICAgICAgIGhhbmRsZXI6ICdDYWNoZUZpcnN0JyxcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgIGNhY2hlTmFtZTogJ2dvb2dsZS1mb250cy1jYWNoZScsXHJcbiAgICAgICAgICAgICAgZXhwaXJhdGlvbjoge1xyXG4gICAgICAgICAgICAgICAgbWF4RW50cmllczogMTAsXHJcbiAgICAgICAgICAgICAgICBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgKiAzNjVcclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgIGNhY2hlYWJsZVJlc3BvbnNlOiB7XHJcbiAgICAgICAgICAgICAgICBzdGF0dXNlczogWzAsIDIwMF1cclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgLy8gR29vZ2xlIEZvbnRzIGZpbGVzXHJcbiAgICAgICAgICAgIHVybFBhdHRlcm46IC9eaHR0cHM6XFwvXFwvZm9udHNcXC5nc3RhdGljXFwuY29tXFwvLiovaSxcclxuICAgICAgICAgICAgaGFuZGxlcjogJ0NhY2hlRmlyc3QnLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgY2FjaGVOYW1lOiAnZ3N0YXRpYy1mb250cy1jYWNoZScsXHJcbiAgICAgICAgICAgICAgZXhwaXJhdGlvbjoge1xyXG4gICAgICAgICAgICAgICAgbWF4RW50cmllczogMTAsXHJcbiAgICAgICAgICAgICAgICBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgKiAzNjVcclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgIGNhY2hlYWJsZVJlc3BvbnNlOiB7XHJcbiAgICAgICAgICAgICAgICBzdGF0dXNlczogWzAsIDIwMF1cclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIC8vIHYwLjQ0OiB0aGUgYm9vay1jb3ZlcnMgQ2FjaGVGaXJzdCByb3V0ZSB3YXMgcmVtb3ZlZC4gV2hlbiBhIGNvdmVyXHJcbiAgICAgICAgICAvLyB3YXNuJ3QgY2FjaGVkIHlldCBBTkQgdGhlIGhvc3QgcmVmdXNlZCB0aGUgZmV0Y2ggKE9wZW4gTGlicmFyeVxyXG4gICAgICAgICAgLy8gcmF0ZS1saW1pdHMgaG90bGlua3MpLCB3b3JrYm94IHN1cmZhY2VkIGFuIHVuaGFuZGxlZCBcIm5vLXJlc3BvbnNlXCJcclxuICAgICAgICAgIC8vIHJlamVjdGlvbiBwZXIgaW1hZ2UgXHUyMDE0IHB1cmUgY29uc29sZSBub2lzZSBzaW5jZSBCb29rQ292ZXIgYWxyZWFkeVxyXG4gICAgICAgICAgLy8gZmFsbHMgYmFjayB0byBhIHBsYWNlaG9sZGVyIG9uRXJyb3IuIFdpdGhvdXQgdGhlIHJvdXRlLCBjb3ZlcnMgdXNlXHJcbiAgICAgICAgICAvLyB0aGUgbm9ybWFsIGJyb3dzZXIgSFRUUCBjYWNoZTsgb25seSBvZmZsaW5lIGNvdmVyIGRpc3BsYXkgaXMgbG9zdC5cclxuICAgICAgICBdLFxyXG4gICAgICB9LFxyXG4gICAgICBtYW5pZmVzdDogZmFsc2UsXHJcbiAgICAgIGRldk9wdGlvbnM6IHtcclxuICAgICAgICBlbmFibGVkOiBmYWxzZVxyXG4gICAgICB9LFxyXG4gICAgfSksXHJcbiAgXSxcclxufSk7Il0sCiAgIm1hcHBpbmdzIjogIjtBQUE2VjtBQUFBLEVBQzNWO0FBQUEsT0FDSztBQUNQLE9BQU8sV0FBVztBQUNsQjtBQUFBLEVBQ0U7QUFBQSxPQUNLO0FBQ1AsT0FBTyxRQUFRO0FBQ2YsT0FBTyxVQUFVO0FBQ2pCLFNBQVMscUJBQXFCO0FBVDRMLElBQU0sMkNBQTJDO0FBaUIzUSxJQUFNLE9BQU8sS0FBSyxRQUFRLGNBQWMsd0NBQWUsQ0FBQztBQUN4RCxJQUFNLGNBQWMsS0FBSyxRQUFRLE1BQU0sZ0JBQWdCO0FBUXZELFNBQVMsaUJBQWlCO0FBQ3hCLE1BQUk7QUFDRixXQUFPLEtBQUssTUFBTSxHQUFHLGFBQWEsS0FBSyxRQUFRLE1BQU0seUJBQXlCLEdBQUcsTUFBTSxDQUFDLEVBQUU7QUFBQSxFQUM1RixRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQUNBLElBQU0scUJBQXFCO0FBQzNCLElBQU0sOEJBQThCLE9BQU87QUFFM0MsU0FBUyxpQkFBaUI7QUFDeEIsUUFBTSxPQUFPLE1BQU07QUFDakIsUUFBSTtBQUNGLGFBQU8sR0FBRyxZQUFZLFdBQVcsRUFBRSxPQUFPLENBQUMsTUFBTSxFQUFFLFNBQVMsTUFBTSxDQUFDLEVBQUUsS0FBSztBQUFBLElBQzVFLFFBQVE7QUFDTixhQUFPLENBQUM7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFBQSxJ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
