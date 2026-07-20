// vite.config.js
import {
  defineConfig
} from "file:///sessions/magical-exciting-planck/mnt/Book-Oracle-Prototype/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/magical-exciting-planck/mnt/Book-Oracle-Prototype/node_modules/@vitejs/plugin-react/dist/index.js";
import {
  VitePWA
} from "file:///sessions/magical-exciting-planck/mnt/Book-Oracle-Prototype/node_modules/vite-plugin-pwa/dist/index.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var __vite_injected_original_import_meta_url = "file:///sessions/magical-exciting-planck/mnt/Book-Oracle-Prototype/vite.config.js";
var AVATARS_DIR = path.resolve(path.dirname(fileURLToPath(__vite_injected_original_import_meta_url)), "public/avatars");
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvbWFnaWNhbC1leGNpdGluZy1wbGFuY2svbW50L0Jvb2stT3JhY2xlLVByb3RvdHlwZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3Nlc3Npb25zL21hZ2ljYWwtZXhjaXRpbmctcGxhbmNrL21udC9Cb29rLU9yYWNsZS1Qcm90b3R5cGUvdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Nlc3Npb25zL21hZ2ljYWwtZXhjaXRpbmctcGxhbmNrL21udC9Cb29rLU9yYWNsZS1Qcm90b3R5cGUvdml0ZS5jb25maWcuanNcIjtpbXBvcnQge1xyXG4gIGRlZmluZUNvbmZpZ1xyXG59IGZyb20gJ3ZpdGUnO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xyXG5pbXBvcnQge1xyXG4gIFZpdGVQV0FcclxufSBmcm9tICd2aXRlLXBsdWdpbi1wd2EnO1xyXG5pbXBvcnQgZnMgZnJvbSAnbm9kZTpmcyc7XHJcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XHJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XHJcblxyXG4vLyB2MC41MjogdmlydHVhbCBtb2R1bGUgbGlzdGluZyBwdWJsaWMvYXZhdGFycy8qLnN2Zywgc28gdGhlIHByZXNldCBhdmF0YXJcclxuLy8gZ2FsbGVyeSBpcyBkcml2ZW4gYnkgdGhlIGZvbGRlcidzIGNvbnRlbnRzIFx1MjAxNCBkcm9wIGEgbmV3IFNWRyBpbiwgaXQgc2hvd3MgdXBcclxuLy8gaW4gdGhlIFByb2ZpbGUgcGlja2VyOyBubyBtYW5pZmVzdCBhcnJheSB0byBtYWludGFpbiAoc2VlIHNyYy9saWIvYXZhdGFycy5qc1xyXG4vLyBmb3IgdGhlIGZpbGVuYW1lIGNvbnZlbnRpb24pLiBEZXYgc2VydmVyIGludmFsaWRhdGVzIG9uIGFkZC9yZW1vdmUsIHNvIG5ld1xyXG4vLyBmaWxlcyBhcHBlYXIgd2l0aG91dCBhIHJlc3RhcnQ7IHByb2R1Y3Rpb24gYmFrZXMgdGhlIGxpc3QgYXQgYnVpbGQgdGltZVxyXG4vLyAoYWRkaW5nIGZpbGVzIG1lYW5zIGEgZGVwbG95IGFueXdheSBcdTIwMTQgdGhleSBsaXZlIGluIHRoZSByZXBvKS5cclxuY29uc3QgQVZBVEFSU19ESVIgPSBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKSksICdwdWJsaWMvYXZhdGFycycpO1xyXG5jb25zdCBBVkFUQVJfTUFOSUZFU1RfSUQgPSAndmlydHVhbDphdmF0YXItbWFuaWZlc3QnO1xyXG5jb25zdCBSRVNPTFZFRF9BVkFUQVJfTUFOSUZFU1RfSUQgPSAnXFwwJyArIEFWQVRBUl9NQU5JRkVTVF9JRDtcclxuXHJcbmZ1bmN0aW9uIGF2YXRhck1hbmlmZXN0KCkge1xyXG4gIGNvbnN0IGxpc3QgPSAoKSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICByZXR1cm4gZnMucmVhZGRpclN5bmMoQVZBVEFSU19ESVIpLmZpbHRlcigoZikgPT4gZi5lbmRzV2l0aCgnLnN2ZycpKS5zb3J0KCk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG4gIH07XHJcbiAgcmV0dXJuIHtcclxuICAgIG5hbWU6ICdhdmF0YXItbWFuaWZlc3QnLFxyXG4gICAgcmVzb2x2ZUlkKGlkKSB7XHJcbiAgICAgIGlmIChpZCA9PT0gQVZBVEFSX01BTklGRVNUX0lEKSByZXR1cm4gUkVTT0xWRURfQVZBVEFSX01BTklGRVNUX0lEO1xyXG4gICAgfSxcclxuICAgIGxvYWQoaWQpIHtcclxuICAgICAgaWYgKGlkID09PSBSRVNPTFZFRF9BVkFUQVJfTUFOSUZFU1RfSUQpIHtcclxuICAgICAgICByZXR1cm4gYGV4cG9ydCBkZWZhdWx0ICR7SlNPTi5zdHJpbmdpZnkobGlzdCgpKX07YDtcclxuICAgICAgfVxyXG4gICAgfSxcclxuICAgIGNvbmZpZ3VyZVNlcnZlcihzZXJ2ZXIpIHtcclxuICAgICAgc2VydmVyLndhdGNoZXIuYWRkKEFWQVRBUlNfRElSKTtcclxuICAgICAgY29uc3QgaW52YWxpZGF0ZSA9IChmaWxlKSA9PiB7XHJcbiAgICAgICAgaWYgKCFmaWxlLmluY2x1ZGVzKCdhdmF0YXJzJykgfHwgIWZpbGUuZW5kc1dpdGgoJy5zdmcnKSkgcmV0dXJuO1xyXG4gICAgICAgIGNvbnN0IG1vZCA9IHNlcnZlci5tb2R1bGVHcmFwaC5nZXRNb2R1bGVCeUlkKFJFU09MVkVEX0FWQVRBUl9NQU5JRkVTVF9JRCk7XHJcbiAgICAgICAgaWYgKG1vZCkge1xyXG4gICAgICAgICAgc2VydmVyLm1vZHVsZUdyYXBoLmludmFsaWRhdGVNb2R1bGUobW9kKTtcclxuICAgICAgICAgIHNlcnZlci53cy5zZW5kKHsgdHlwZTogJ2Z1bGwtcmVsb2FkJyB9KTtcclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcbiAgICAgIHNlcnZlci53YXRjaGVyLm9uKCdhZGQnLCBpbnZhbGlkYXRlKTtcclxuICAgICAgc2VydmVyLndhdGNoZXIub24oJ3VubGluaycsIGludmFsaWRhdGUpO1xyXG4gICAgfSxcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xyXG4gIC8vIFdhdGNoIGFsbCBTQ1NTIHBhcnRpYWxzIGluIHN1YmRpcmVjdG9yaWVzIHNvIEhNUiB0cmlnZ2VycyBvbiBhbnkgc3R5bGUgY2hhbmdlXHJcbiAgc2VydmVyOiB7XHJcbiAgICB3YXRjaDoge1xyXG4gICAgICB1c2VQb2xsaW5nOiBmYWxzZSxcclxuICAgICAgaWdub3JlZDogWychKiovc3JjL3N0eWxlcy8qKiddLFxyXG4gICAgfSxcclxuICB9LFxyXG5cclxuICBjc3M6IHtcclxuICAgIHByZXByb2Nlc3Nvck9wdGlvbnM6IHtcclxuICAgICAgc2Nzczoge1xyXG4gICAgICAgIC8vIEFsbG93cyBAdXNlIHBhdGhzIHRvIHJlc29sdmUgZnJvbSB0aGUgc3R5bGVzIHJvb3RcclxuICAgICAgICBsb2FkUGF0aHM6IFsnc3JjL3N0eWxlcyddLFxyXG4gICAgICB9LFxyXG4gICAgfSxcclxuICB9LFxyXG5cclxuICBwbHVnaW5zOiBbXHJcbiAgICByZWFjdCgpLFxyXG4gICAgYXZhdGFyTWFuaWZlc3QoKSxcclxuICAgIFZpdGVQV0Eoe1xyXG4gICAgICAvLyB2MC40NTogc3dpdGNoZWQgZnJvbSAnYXV0b1VwZGF0ZScgdG8gJ3Byb21wdCcuIGF1dG9VcGRhdGUgZm9yY2UtcmVsb2FkZWRcclxuICAgICAgLy8gZXZlcnkgb3BlbiBjbGllbnQgdGhlIG1vbWVudCBhIG5ldyBTVyB0b29rIGNvbnRyb2wgb24gZWFjaCBkZXBsb3kuIFRoYXRcclxuICAgICAgLy8gcmVsb2FkIHJhY2VkIFN1cGFiYXNlJ3MgdG9rZW4gcmVmcmVzaDsgd2l0aCBzaW5nbGUtdXNlIHJlZnJlc2gtdG9rZW5cclxuICAgICAgLy8gcm90YXRpb24sIHRoZSBsb3NpbmcgcmVxdWVzdCBnb3QgXCJJbnZhbGlkIFJlZnJlc2ggVG9rZW46IEFscmVhZHkgVXNlZFwiXHJcbiAgICAgIC8vIGFuZCB0aGUgY2xpZW50IHB1cmdlZCBzYi08cmVmPi1hdXRoLXRva2VuIGZyb20gbG9jYWxTdG9yYWdlIFx1MjAxNCBsb2dnaW5nXHJcbiAgICAgIC8vIHVzZXJzIG91dCBvbiBldmVyeSBkZXBsb3kuICdwcm9tcHQnIGxldHMgdGhlIHVzZXIgdXBkYXRlIG9uIHRoZWlyIHRlcm1zXHJcbiAgICAgIC8vIChzZWUgUFdBVXBkYXRlUHJvbXB0KSwgc28gbm8gbWlkLXNlc3Npb24gcmVsb2FkIGFuZCBubyBsb3N0IHNlc3Npb24uXHJcbiAgICAgIHJlZ2lzdGVyVHlwZTogJ3Byb21wdCcsXHJcbiAgICAgIHdvcmtib3g6IHtcclxuICAgICAgICBnbG9iUGF0dGVybnM6IFsnKiovKi57anMsY3NzLGh0bWwsaWNvLHBuZyxzdmcsd29mZjJ9J10sXHJcbiAgICAgICAgLy8gU2hhcmUtY2FyZCBmcmFtZS9hcnQgKHB1YmxpYy9jYXJkcy8qKikgYXJlIGxhcmdlICgyLTMgTUIgZWFjaCkgYW5kIG9ubHlcclxuICAgICAgICAvLyBmZXRjaGVkIG9uIGRlbWFuZCB3aGVuIGEgdXNlciBzaGFyZXMgXHUyMDE0IG5ldmVyIG5lZWRlZCBvZmZsaW5lLiBLZWVwIHRoZW1cclxuICAgICAgICAvLyBvdXQgb2YgdGhlIFNXIHByZWNhY2hlIHNvIHRoZXkgZG9uJ3QgZXhjZWVkIHRoZSBzaXplIGxpbWl0ICh3aGljaCBmYWlsc1xyXG4gICAgICAgIC8vIHRoZSBidWlsZCkgb3IgYmxvYXQgdGhlIGluc3RhbGwgd2l0aCB0ZW5zIG9mIE1CIG9mIGltYWdlcy5cclxuICAgICAgICBnbG9iSWdub3JlczogWycqKi9jYXJkcy8qKiddLFxyXG4gICAgICAgIHJ1bnRpbWVDYWNoaW5nOiBbe1xyXG4gICAgICAgICAgICAvLyBHb29nbGUgRm9udHMgc3R5bGVzaGVldHNcclxuICAgICAgICAgICAgdXJsUGF0dGVybjogL15odHRwczpcXC9cXC9mb250c1xcLmdvb2dsZWFwaXNcXC5jb21cXC8uKi9pLFxyXG4gICAgICAgICAgICBoYW5kbGVyOiAnQ2FjaGVGaXJzdCcsXHJcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICBjYWNoZU5hbWU6ICdnb29nbGUtZm9udHMtY2FjaGUnLFxyXG4gICAgICAgICAgICAgIGV4cGlyYXRpb246IHtcclxuICAgICAgICAgICAgICAgIG1heEVudHJpZXM6IDEwLFxyXG4gICAgICAgICAgICAgICAgbWF4QWdlU2Vjb25kczogNjAgKiA2MCAqIDI0ICogMzY1XHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICBjYWNoZWFibGVSZXNwb25zZToge1xyXG4gICAgICAgICAgICAgICAgc3RhdHVzZXM6IFswLCAyMDBdXHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgIC8vIEdvb2dsZSBGb250cyBmaWxlc1xyXG4gICAgICAgICAgICB1cmxQYXR0ZXJuOiAvXmh0dHBzOlxcL1xcL2ZvbnRzXFwuZ3N0YXRpY1xcLmNvbVxcLy4qL2ksXHJcbiAgICAgICAgICAgIGhhbmRsZXI6ICdDYWNoZUZpcnN0JyxcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgIGNhY2hlTmFtZTogJ2dzdGF0aWMtZm9udHMtY2FjaGUnLFxyXG4gICAgICAgICAgICAgIGV4cGlyYXRpb246IHtcclxuICAgICAgICAgICAgICAgIG1heEVudHJpZXM6IDEwLFxyXG4gICAgICAgICAgICAgICAgbWF4QWdlU2Vjb25kczogNjAgKiA2MCAqIDI0ICogMzY1XHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICBjYWNoZWFibGVSZXNwb25zZToge1xyXG4gICAgICAgICAgICAgICAgc3RhdHVzZXM6IFswLCAyMDBdXHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICAvLyB2MC40NDogdGhlIGJvb2stY292ZXJzIENhY2hlRmlyc3Qgcm91dGUgd2FzIHJlbW92ZWQuIFdoZW4gYSBjb3ZlclxyXG4gICAgICAgICAgLy8gd2Fzbid0IGNhY2hlZCB5ZXQgQU5EIHRoZSBob3N0IHJlZnVzZWQgdGhlIGZldGNoIChPcGVuIExpYnJhcnlcclxuICAgICAgICAgIC8vIHJhdGUtbGltaXRzIGhvdGxpbmtzKSwgd29ya2JveCBzdXJmYWNlZCBhbiB1bmhhbmRsZWQgXCJuby1yZXNwb25zZVwiXHJcbiAgICAgICAgICAvLyByZWplY3Rpb24gcGVyIGltYWdlIFx1MjAxNCBwdXJlIGNvbnNvbGUgbm9pc2Ugc2luY2UgQm9va0NvdmVyIGFscmVhZHlcclxuICAgICAgICAgIC8vIGZhbGxzIGJhY2sgdG8gYSBwbGFjZWhvbGRlciBvbkVycm9yLiBXaXRob3V0IHRoZSByb3V0ZSwgY292ZXJzIHVzZVxyXG4gICAgICAgICAgLy8gdGhlIG5vcm1hbCBicm93c2VyIEhUVFAgY2FjaGU7IG9ubHkgb2ZmbGluZSBjb3ZlciBkaXNwbGF5IGlzIGxvc3QuXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgICAgbWFuaWZlc3Q6IGZhbHNlLFxyXG4gICAgICBkZXZPcHRpb25zOiB7XHJcbiAgICAgICAgZW5hYmxlZDogZmFsc2VcclxuICAgICAgfSxcclxuICAgIH0pLFxyXG4gIF0sXHJcbn0pOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBbVc7QUFBQSxFQUNqVztBQUFBLE9BQ0s7QUFDUCxPQUFPLFdBQVc7QUFDbEI7QUFBQSxFQUNFO0FBQUEsT0FDSztBQUNQLE9BQU8sUUFBUTtBQUNmLE9BQU8sVUFBVTtBQUNqQixTQUFTLHFCQUFxQjtBQVRnTSxJQUFNLDJDQUEyQztBQWlCL1EsSUFBTSxjQUFjLEtBQUssUUFBUSxLQUFLLFFBQVEsY0FBYyx3Q0FBZSxDQUFDLEdBQUcsZ0JBQWdCO0FBQy9GLElBQU0scUJBQXFCO0FBQzNCLElBQU0sOEJBQThCLE9BQU87QUFFM0MsU0FBUyxpQkFBaUI7QUFDeEIsUUFBTSxPQUFPLE1BQU07QUFDakIsUUFBSTtBQUNGLGFBQU8sR0FBRyxZQUFZLFdBQVcsRUFBRSxPQUFPLENBQUMsTUFBTSxFQUFFLFNBQVMsTUFBTSxDQUFDLEVBQUUsS0FBSztBQUFBLElBQzVFLFFBQVE7QUFDTixhQUFPLENBQUM7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLFVBQVUsSUFBSTtBQUNaLFVBQUksT0FBTyxtQkFBb0IsUUFBTztBQUFBLElBQ3hDO0FBQUEsSUFDQSxLQUFLLElBQUk7QUFDUCxVQUFJLE9BQU8sNkJBQTZCO0FBQ3RDLGVBQU8sa0JBQWtCLEtBQUssVUFBVSxLQUFLLENBQUMsQ0FBQztBQUFBLE1BQ2pEO0FBQUEsSUFDRjtBQUFBLElBQ0EsZ0JBQWdCLFFBQVE7QUFDdEIsYUFBTyxRQUFRLElBQUksV0FBVztBQUM5QixZQUFNLGFBQWEsQ0FBQyxTQUFTO0FBQzNCLFlBQUksQ0FBQyxLQUFLLFNBQVMsU0FBUyxLQUFLLENBQUMsS0FBSyxTQUFTLE1BQU0sRUFBRztBQUN6RCxjQUFNLE1BQU0sT0FBTyxZQUFZLGNBQWMsMkJBQTJCO0FBQ3hFLFlBQUksS0FBSztBQUNQLGlCQUFPLFlBQVksaUJBQWlCLEdBQUc7QUFDdkMsaUJBQU8sR0FBRyxLQUFLLEVBQUUsTUFBTSxjQUFjLENBQUM7QUFBQSxRQUN4QztBQUFBLE1BQ0Y7QUFDQSxhQUFPLFFBQVEsR0FBRyxPQUFPLFVBQVU7QUFDbkMsYUFBTyxRQUFRLEdBQUcsVUFBVSxVQUFVO0FBQUEsSUFDeEM7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxJQUFPLHNCQUFRLGFBQWE7QUFBQTtBQUFBLEVBRTFCLFFBQVE7QUFBQSxJQUNOLE9BQU87QUFBQSxNQUNMLFlBQVk7QUFBQSxNQUNaLFNBQVMsQ0FBQyxtQkFBbUI7QUFBQSxJQUMvQjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLEtBQUs7QUFBQSxJQUNILHFCQUFxQjtBQUFBLE1BQ25CLE1BQU07QUFBQTtBQUFBLFFBRUosV0FBVyxDQUFDLFlBQVk7QUFBQSxNQUMxQjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFQSxTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixlQUFlO0FBQUEsSUFDZixRQUFRO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQVFOLGNBQWM7QUFBQSxNQUNkLFNBQVM7QUFBQSxRQUNQLGNBQWMsQ0FBQyxzQ0FBc0M7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFFBS3JELGFBQWEsQ0FBQyxhQUFhO0FBQUEsUUFDM0IsZ0JBQWdCO0FBQUEsVUFBQztBQUFBO0FBQUEsWUFFYixZQUFZO0FBQUEsWUFDWixTQUFTO0FBQUEsWUFDVCxTQUFTO0FBQUEsY0FDUCxXQUFXO0FBQUEsY0FDWCxZQUFZO0FBQUEsZ0JBQ1YsWUFBWTtBQUFBLGdCQUNaLGVBQWUsS0FBSyxLQUFLLEtBQUs7QUFBQSxjQUNoQztBQUFBLGNBQ0EsbUJBQW1CO0FBQUEsZ0JBQ2pCLFVBQVUsQ0FBQyxHQUFHLEdBQUc7QUFBQSxjQUNuQjtBQUFBLFlBQ0Y7QUFBQSxVQUNGO0FBQUEsVUFDQTtBQUFBO0FBQUEsWUFFRSxZQUFZO0FBQUEsWUFDWixTQUFTO0FBQUEsWUFDVCxTQUFTO0FBQUEsY0FDUCxXQUFXO0FBQUEsY0FDWCxZQUFZO0FBQUEsZ0JBQ1YsWUFBWTtBQUFBLGdCQUNaLGVBQWUsS0FBSyxLQUFLLEtBQUs7QUFBQSxjQUNoQztBQUFBLGNBQ0EsbUJBQW1CO0FBQUEsZ0JBQ2pCLFVBQVUsQ0FBQyxHQUFHLEdBQUc7QUFBQSxjQUNuQjtBQUFBLFlBQ0Y7QUFBQSxVQUNGO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsUUFPRjtBQUFBLE1BQ0Y7QUFBQSxNQUNBLFVBQVU7QUFBQSxNQUNWLFlBQVk7QUFBQSxRQUNWLFNBQVM7QUFBQSxNQUNYO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
