// vite.config.js
import {
  defineConfig
} from "file:///sessions/charming-nifty-heisenberg/mnt/Book-Oracle-Prototype/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/charming-nifty-heisenberg/mnt/Book-Oracle-Prototype/node_modules/@vitejs/plugin-react/dist/index.js";
import {
  VitePWA
} from "file:///sessions/charming-nifty-heisenberg/mnt/Book-Oracle-Prototype/node_modules/vite-plugin-pwa/dist/index.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var __vite_injected_original_import_meta_url = "file:///sessions/charming-nifty-heisenberg/mnt/Book-Oracle-Prototype/vite.config.js";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvY2hhcm1pbmctbmlmdHktaGVpc2VuYmVyZy9tbnQvQm9vay1PcmFjbGUtUHJvdG90eXBlXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvY2hhcm1pbmctbmlmdHktaGVpc2VuYmVyZy9tbnQvQm9vay1PcmFjbGUtUHJvdG90eXBlL3ZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9jaGFybWluZy1uaWZ0eS1oZWlzZW5iZXJnL21udC9Cb29rLU9yYWNsZS1Qcm90b3R5cGUvdml0ZS5jb25maWcuanNcIjtpbXBvcnQge1xyXG4gIGRlZmluZUNvbmZpZ1xyXG59IGZyb20gJ3ZpdGUnO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xyXG5pbXBvcnQge1xyXG4gIFZpdGVQV0FcclxufSBmcm9tICd2aXRlLXBsdWdpbi1wd2EnO1xyXG5pbXBvcnQgZnMgZnJvbSAnbm9kZTpmcyc7XHJcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XHJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XHJcblxyXG4vLyB2MC41MjogdmlydHVhbCBtb2R1bGUgbGlzdGluZyBwdWJsaWMvYXZhdGFycy8qLnN2Zywgc28gdGhlIHByZXNldCBhdmF0YXJcclxuLy8gZ2FsbGVyeSBpcyBkcml2ZW4gYnkgdGhlIGZvbGRlcidzIGNvbnRlbnRzIFx1MjAxNCBkcm9wIGEgbmV3IFNWRyBpbiwgaXQgc2hvd3MgdXBcclxuLy8gaW4gdGhlIFByb2ZpbGUgcGlja2VyOyBubyBtYW5pZmVzdCBhcnJheSB0byBtYWludGFpbiAoc2VlIHNyYy9saWIvYXZhdGFycy5qc1xyXG4vLyBmb3IgdGhlIGZpbGVuYW1lIGNvbnZlbnRpb24pLiBEZXYgc2VydmVyIGludmFsaWRhdGVzIG9uIGFkZC9yZW1vdmUsIHNvIG5ld1xyXG4vLyBmaWxlcyBhcHBlYXIgd2l0aG91dCBhIHJlc3RhcnQ7IHByb2R1Y3Rpb24gYmFrZXMgdGhlIGxpc3QgYXQgYnVpbGQgdGltZVxyXG4vLyAoYWRkaW5nIGZpbGVzIG1lYW5zIGEgZGVwbG95IGFueXdheSBcdTIwMTQgdGhleSBsaXZlIGluIHRoZSByZXBvKS5cclxuY29uc3QgUk9PVCA9IHBhdGguZGlybmFtZShmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCkpO1xyXG5jb25zdCBBVkFUQVJTX0RJUiA9IHBhdGgucmVzb2x2ZShST09ULCAncHVibGljL2F2YXRhcnMnKTtcclxuXHJcbi8vIHYwLjU2OiBiYWtlIHRoZSBzaGlwcGVkIHZlcnNpb24gaW50byB0aGUgYnVuZGxlIHNvIGEgcnVubmluZyBjbGllbnQgY2FuIHRlbGxcclxuLy8gd2hldGhlciBpdCBpcyBzdGFsZS4gcHVibGljL2FwcC12ZXJzaW9uLmpzb24gaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggXHUyMDE0XHJcbi8vIGl0J3Mgc2VydmVkIHVuaGFzaGVkIGFuZCB1bmNhY2hlZCwgc28gYSBjbGllbnQgY29tcGFyZXMgdGhlIHZlcnNpb24gaXQgd2FzXHJcbi8vIEJVSUxUIHdpdGggKF9fQVBQX1ZFUlNJT05fXykgYWdhaW5zdCB0aGUgdmVyc2lvbiBjdXJyZW50bHkgZGVwbG95ZWQuIEFcclxuLy8gbWlzbWF0Y2ggbWVhbnMgdGhpcyBjbGllbnQgaXMgcnVubmluZyBvbGQgY29kZSwgd2hpY2ggaXMgdGhlIHNpZ25hbCB0aGUgb2xkXHJcbi8vIG5lZWRSZWZyZXNoLW9ubHkgcGF0aCBjb3VsZCBuZXZlciBwcm9kdWNlIGZvciBhIHJldHVybmluZyB2aXNpdG9yLlxyXG5mdW5jdGlvbiByZWFkQXBwVmVyc2lvbigpIHtcclxuICB0cnkge1xyXG4gICAgcmV0dXJuIEpTT04ucGFyc2UoZnMucmVhZEZpbGVTeW5jKHBhdGgucmVzb2x2ZShST09ULCAncHVibGljL2FwcC12ZXJzaW9uLmpzb24nKSwgJ3V0ZjgnKSkudmVyc2lvbjtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiAndW5rbm93bic7IC8vIG5ldmVyIGJsb2NrcyBhIGJ1aWxkOyB0aGUgY2hlY2sganVzdCBuby1vcHMgKHNlZSBQV0FVcGRhdGVQcm9tcHQpXHJcbiAgfVxyXG59XHJcbmNvbnN0IEFWQVRBUl9NQU5JRkVTVF9JRCA9ICd2aXJ0dWFsOmF2YXRhci1tYW5pZmVzdCc7XHJcbmNvbnN0IFJFU09MVkVEX0FWQVRBUl9NQU5JRkVTVF9JRCA9ICdcXDAnICsgQVZBVEFSX01BTklGRVNUX0lEO1xyXG5cclxuZnVuY3Rpb24gYXZhdGFyTWFuaWZlc3QoKSB7XHJcbiAgY29uc3QgbGlzdCA9ICgpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIHJldHVybiBmcy5yZWFkZGlyU3luYyhBVkFUQVJTX0RJUikuZmlsdGVyKChmKSA9PiBmLmVuZHNXaXRoKCcuc3ZnJykpLnNvcnQoKTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcbiAgfTtcclxuICByZXR1cm4ge1xyXG4gICAgbmFtZTogJ2F2YXRhci1tYW5pZmVzdCcsXHJcbiAgICByZXNvbHZlSWQoaWQpIHtcclxuICAgICAgaWYgKGlkID09PSBBVkFUQVJfTUFOSUZFU1RfSUQpIHJldHVybiBSRVNPTFZFRF9BVkFUQVJfTUFOSUZFU1RfSUQ7XHJcbiAgICB9LFxyXG4gICAgbG9hZChpZCkge1xyXG4gICAgICBpZiAoaWQgPT09IFJFU09MVkVEX0FWQVRBUl9NQU5JRkVTVF9JRCkge1xyXG4gICAgICAgIHJldHVybiBgZXhwb3J0IGRlZmF1bHQgJHtKU09OLnN0cmluZ2lmeShsaXN0KCkpfTtgO1xyXG4gICAgICB9XHJcbiAgICB9LFxyXG4gICAgY29uZmlndXJlU2VydmVyKHNlcnZlcikge1xyXG4gICAgICBzZXJ2ZXIud2F0Y2hlci5hZGQoQVZBVEFSU19ESVIpO1xyXG4gICAgICBjb25zdCBpbnZhbGlkYXRlID0gKGZpbGUpID0+IHtcclxuICAgICAgICBpZiAoIWZpbGUuaW5jbHVkZXMoJ2F2YXRhcnMnKSB8fCAhZmlsZS5lbmRzV2l0aCgnLnN2ZycpKSByZXR1cm47XHJcbiAgICAgICAgY29uc3QgbW9kID0gc2VydmVyLm1vZHVsZUdyYXBoLmdldE1vZHVsZUJ5SWQoUkVTT0xWRURfQVZBVEFSX01BTklGRVNUX0lEKTtcclxuICAgICAgICBpZiAobW9kKSB7XHJcbiAgICAgICAgICBzZXJ2ZXIubW9kdWxlR3JhcGguaW52YWxpZGF0ZU1vZHVsZShtb2QpO1xyXG4gICAgICAgICAgc2VydmVyLndzLnNlbmQoeyB0eXBlOiAnZnVsbC1yZWxvYWQnIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuICAgICAgc2VydmVyLndhdGNoZXIub24oJ2FkZCcsIGludmFsaWRhdGUpO1xyXG4gICAgICBzZXJ2ZXIud2F0Y2hlci5vbigndW5saW5rJywgaW52YWxpZGF0ZSk7XHJcbiAgICB9LFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XHJcbiAgZGVmaW5lOiB7XHJcbiAgICBfX0FQUF9WRVJTSU9OX186IEpTT04uc3RyaW5naWZ5KHJlYWRBcHBWZXJzaW9uKCkpLFxyXG4gIH0sXHJcblxyXG4gIC8vIFdhdGNoIGFsbCBTQ1NTIHBhcnRpYWxzIGluIHN1YmRpcmVjdG9yaWVzIHNvIEhNUiB0cmlnZ2VycyBvbiBhbnkgc3R5bGUgY2hhbmdlXHJcbiAgc2VydmVyOiB7XHJcbiAgICB3YXRjaDoge1xyXG4gICAgICB1c2VQb2xsaW5nOiBmYWxzZSxcclxuICAgICAgaWdub3JlZDogWychKiovc3JjL3N0eWxlcy8qKiddLFxyXG4gICAgfSxcclxuICB9LFxyXG5cclxuICBjc3M6IHtcclxuICAgIHByZXByb2Nlc3Nvck9wdGlvbnM6IHtcclxuICAgICAgc2Nzczoge1xyXG4gICAgICAgIC8vIEFsbG93cyBAdXNlIHBhdGhzIHRvIHJlc29sdmUgZnJvbSB0aGUgc3R5bGVzIHJvb3RcclxuICAgICAgICBsb2FkUGF0aHM6IFsnc3JjL3N0eWxlcyddLFxyXG4gICAgICB9LFxyXG4gICAgfSxcclxuICB9LFxyXG5cclxuICBwbHVnaW5zOiBbXHJcbiAgICByZWFjdCgpLFxyXG4gICAgYXZhdGFyTWFuaWZlc3QoKSxcclxuICAgIFZpdGVQV0Eoe1xyXG4gICAgICAvLyB2MC40NTogc3dpdGNoZWQgZnJvbSAnYXV0b1VwZGF0ZScgdG8gJ3Byb21wdCcuIGF1dG9VcGRhdGUgZm9yY2UtcmVsb2FkZWRcclxuICAgICAgLy8gZXZlcnkgb3BlbiBjbGllbnQgdGhlIG1vbWVudCBhIG5ldyBTVyB0b29rIGNvbnRyb2wgb24gZWFjaCBkZXBsb3kuIFRoYXRcclxuICAgICAgLy8gcmVsb2FkIHJhY2VkIFN1cGFiYXNlJ3MgdG9rZW4gcmVmcmVzaDsgd2l0aCBzaW5nbGUtdXNlIHJlZnJlc2gtdG9rZW5cclxuICAgICAgLy8gcm90YXRpb24sIHRoZSBsb3NpbmcgcmVxdWVzdCBnb3QgXCJJbnZhbGlkIFJlZnJlc2ggVG9rZW46IEFscmVhZHkgVXNlZFwiXHJcbiAgICAgIC8vIGFuZCB0aGUgY2xpZW50IHB1cmdlZCBzYi08cmVmPi1hdXRoLXRva2VuIGZyb20gbG9jYWxTdG9yYWdlIFx1MjAxNCBsb2dnaW5nXHJcbiAgICAgIC8vIHVzZXJzIG91dCBvbiBldmVyeSBkZXBsb3kuICdwcm9tcHQnIGxldHMgdGhlIHVzZXIgdXBkYXRlIG9uIHRoZWlyIHRlcm1zXHJcbiAgICAgIC8vIChzZWUgUFdBVXBkYXRlUHJvbXB0KSwgc28gbm8gbWlkLXNlc3Npb24gcmVsb2FkIGFuZCBubyBsb3N0IHNlc3Npb24uXHJcbiAgICAgIHJlZ2lzdGVyVHlwZTogJ3Byb21wdCcsXHJcbiAgICAgIHdvcmtib3g6IHtcclxuICAgICAgICBnbG9iUGF0dGVybnM6IFsnKiovKi57anMsY3NzLGh0bWwsaWNvLHBuZyxzdmcsd29mZjJ9J10sXHJcbiAgICAgICAgLy8gU2hhcmUtY2FyZCBmcmFtZS9hcnQgKHB1YmxpYy9jYXJkcy8qKikgYXJlIGxhcmdlICgyLTMgTUIgZWFjaCkgYW5kIG9ubHlcclxuICAgICAgICAvLyBmZXRjaGVkIG9uIGRlbWFuZCB3aGVuIGEgdXNlciBzaGFyZXMgXHUyMDE0IG5ldmVyIG5lZWRlZCBvZmZsaW5lLiBLZWVwIHRoZW1cclxuICAgICAgICAvLyBvdXQgb2YgdGhlIFNXIHByZWNhY2hlIHNvIHRoZXkgZG9uJ3QgZXhjZWVkIHRoZSBzaXplIGxpbWl0ICh3aGljaCBmYWlsc1xyXG4gICAgICAgIC8vIHRoZSBidWlsZCkgb3IgYmxvYXQgdGhlIGluc3RhbGwgd2l0aCB0ZW5zIG9mIE1CIG9mIGltYWdlcy5cclxuICAgICAgICBnbG9iSWdub3JlczogWycqKi9jYXJkcy8qKiddLFxyXG4gICAgICAgIHJ1bnRpbWVDYWNoaW5nOiBbe1xyXG4gICAgICAgICAgICAvLyBHb29nbGUgRm9udHMgc3R5bGVzaGVldHNcclxuICAgICAgICAgICAgdXJsUGF0dGVybjogL15odHRwczpcXC9cXC9mb250c1xcLmdvb2dsZWFwaXNcXC5jb21cXC8uKi9pLFxyXG4gICAgICAgICAgICBoYW5kbGVyOiAnQ2FjaGVGaXJzdCcsXHJcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICBjYWNoZU5hbWU6ICdnb29nbGUtZm9udHMtY2FjaGUnLFxyXG4gICAgICAgICAgICAgIGV4cGlyYXRpb246IHtcclxuICAgICAgICAgICAgICAgIG1heEVudHJpZXM6IDEwLFxyXG4gICAgICAgICAgICAgICAgbWF4QWdlU2Vjb25kczogNjAgKiA2MCAqIDI0ICogMzY1XHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICBjYWNoZWFibGVSZXNwb25zZToge1xyXG4gICAgICAgICAgICAgICAgc3RhdHVzZXM6IFswLCAyMDBdXHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgIC8vIEdvb2dsZSBGb250cyBmaWxlc1xyXG4gICAgICAgICAgICB1cmxQYXR0ZXJuOiAvXmh0dHBzOlxcL1xcL2ZvbnRzXFwuZ3N0YXRpY1xcLmNvbVxcLy4qL2ksXHJcbiAgICAgICAgICAgIGhhbmRsZXI6ICdDYWNoZUZpcnN0JyxcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgIGNhY2hlTmFtZTogJ2dzdGF0aWMtZm9udHMtY2FjaGUnLFxyXG4gICAgICAgICAgICAgIGV4cGlyYXRpb246IHtcclxuICAgICAgICAgICAgICAgIG1heEVudHJpZXM6IDEwLFxyXG4gICAgICAgICAgICAgICAgbWF4QWdlU2Vjb25kczogNjAgKiA2MCAqIDI0ICogMzY1XHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICBjYWNoZWFibGVSZXNwb25zZToge1xyXG4gICAgICAgICAgICAgICAgc3RhdHVzZXM6IFswLCAyMDBdXHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICAvLyB2MC40NDogdGhlIGJvb2stY292ZXJzIENhY2hlRmlyc3Qgcm91dGUgd2FzIHJlbW92ZWQuIFdoZW4gYSBjb3ZlclxyXG4gICAgICAgICAgLy8gd2Fzbid0IGNhY2hlZCB5ZXQgQU5EIHRoZSBob3N0IHJlZnVzZWQgdGhlIGZldGNoIChPcGVuIExpYnJhcnlcclxuICAgICAgICAgIC8vIHJhdGUtbGltaXRzIGhvdGxpbmtzKSwgd29ya2JveCBzdXJmYWNlZCBhbiB1bmhhbmRsZWQgXCJuby1yZXNwb25zZVwiXHJcbiAgICAgICAgICAvLyByZWplY3Rpb24gcGVyIGltYWdlIFx1MjAxNCBwdXJlIGNvbnNvbGUgbm9pc2Ugc2luY2UgQm9va0NvdmVyIGFscmVhZHlcclxuICAgICAgICAgIC8vIGZhbGxzIGJhY2sgdG8gYSBwbGFjZWhvbGRlciBvbkVycm9yLiBXaXRob3V0IHRoZSByb3V0ZSwgY292ZXJzIHVzZVxyXG4gICAgICAgICAgLy8gdGhlIG5vcm1hbCBicm93c2VyIEhUVFAgY2FjaGU7IG9ubHkgb2ZmbGluZSBjb3ZlciBkaXNwbGF5IGlzIGxvc3QuXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgICAgbWFuaWZlc3Q6IGZhbHNlLFxyXG4gICAgICBkZXZPcHRpb25zOiB7XHJcbiAgICAgICAgZW5hYmxlZDogZmFsc2VcclxuICAgICAgfSxcclxuICAgIH0pLFxyXG4gIF0sXHJcbn0pOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBeVc7QUFBQSxFQUN2VztBQUFBLE9BQ0s7QUFDUCxPQUFPLFdBQVc7QUFDbEI7QUFBQSxFQUNFO0FBQUEsT0FDSztBQUNQLE9BQU8sUUFBUTtBQUNmLE9BQU8sVUFBVTtBQUNqQixTQUFTLHFCQUFxQjtBQVRvTSxJQUFNLDJDQUEyQztBQWlCblIsSUFBTSxPQUFPLEtBQUssUUFBUSxjQUFjLHdDQUFlLENBQUM7QUFDeEQsSUFBTSxjQUFjLEtBQUssUUFBUSxNQUFNLGdCQUFnQjtBQVF2RCxTQUFTLGlCQUFpQjtBQUN4QixNQUFJO0FBQ0YsV0FBTyxLQUFLLE1BQU0sR0FBRyxhQUFhLEtBQUssUUFBUSxNQUFNLHlCQUF5QixHQUFHLE1BQU0sQ0FBQyxFQUFFO0FBQUEsRUFDNUYsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFDQSxJQUFNLHFCQUFxQjtBQUMzQixJQUFNLDhCQUE4QixPQUFPO0FBRTNDLFNBQVMsaUJBQWlCO0FBQ3hCLFFBQU0sT0FBTyxNQUFNO0FBQ2pCLFFBQUk7QUFDRixhQUFPLEdBQUcsWUFBWSxXQUFXLEVBQUUsT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLE1BQU0sQ0FBQyxFQUFFLEtBQUs7QUFBQSxJQUM1RSxRQUFRO0FBQ04sYUFBTyxDQUFDO0FBQUEsSUFDVjtBQUFBLEVB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
