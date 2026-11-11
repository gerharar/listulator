import { defineConfig, devices } from '@playwright/test'

/**
 * Phase 49.13 and 50.11: what only the PRODUCTION build does, the service worker. The installed web app precaches its shell, the Spectrum font included, so an offline start in
 * eX-Zed draws in it, and caches eX-Zed's art at run time (the first time a skin draws it); the dev server has no worker (`devOptions.enabled: false`), so this runs against `vite preview`. Run by hand or in a release check, not in the
 * suite (its files end in `.pwa.ts`, which the normal config does not match):
 *   cd web && npm run test:pwa
 * No API server: the app shell is what is checked, and offline there is none anyway.
 */
export default defineConfig({
  testDir: './e2e/pwa',
  testMatch: '**/*.pwa.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', locale: 'en-US', serviceWorkers: 'allow' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run build -w @listulator/web && npm run preview -w @listulator/web',
    cwd: '../',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 240_000,
  },
})
