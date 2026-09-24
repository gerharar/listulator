import { defaultExclude, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Excludes `e2e/` on top of vitest's own defaults, not instead of them —
  // an `include` override here once silently dropped `scripts/`'s own test
  // file from every run (caught by a file-count regression, task 10.9b).
  // Vitest's default `include` already matches `*.spec.ts` too, and a
  // `@playwright/test` import crashes `vitest run`.
  test: {
    exclude: [...defaultExclude, 'e2e/**'],
  },
  plugins: [
    react(),
    VitePWA({
      // A new build takes over on the next visit rather than waiting for every
      // tab to close. This is a personal tracker, not a live document — there
      // is nothing to lose to a reload.
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Listulator',
        short_name: 'Listulator',
        description: 'Finish the whole list.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // The dark grey field the design is built around. A manifest carries
        // one colour, so this is fixed even though the app has six themes.
        theme_color: '#454545',
        background_color: '#454545',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            // Cropped to whatever shape the platform uses, so its art sits
            // inside a safe zone.
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        /**
         * The shell is precached; API responses are not cached at all.
         *
         * Serving a stale list would be worse than showing nothing — the
         * numbers are the product, and a cached "3/12" that is really "7/12"
         * is a bug the user cannot see. What precaching buys is the app frame
         * loading when the server is unreachable, so the failure reads as
         * "cannot reach the server" rather than a browser error page.
         */
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,woff2}'],
      },
      devOptions: {
        // Off in dev: a service worker caching a hot-reloading build is a
        // reliable way to spend an afternoon debugging stale assets.
        enabled: false,
      },
    }),
  ],
  // `vite preview` serves the production build, which is the only way to
  // exercise the service worker — so it needs the same API proxy as dev.
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } },
  },
  server: {
    // Bind IPv4 explicitly — matching the API server, and avoiding an IPv6
    // (::1) bind that some environments refuse. Use `vite --host` when you
    // need to reach the dev server from another device (e.g. phone testing).
    host: '127.0.0.1',
    port: 5173,
    fs: {
      // The standalone-app storage layer (docs/DECISIONS.md, "Standalone-app
      // distribution") imports the server's schema and migration SQL
      // directly, rather than duplicating them — Vite's dev server otherwise
      // refuses to serve files outside its own workspace root.
      allow: ['..'],
    },
    proxy: {
      // Server runs separately in dev; the SPA talks to it through this proxy
      // so the frontend never needs to know the API's origin.
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
