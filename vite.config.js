import {
  defineConfig
} from 'vite';
import react from '@vitejs/plugin-react';
import {
  VitePWA
} from 'vite-plugin-pwa';

export default defineConfig({
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
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
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