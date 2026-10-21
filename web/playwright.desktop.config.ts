import { defineConfig } from '@playwright/test'

/**
 * The Windows update test (Phase 31, task 31.7): one spec that drives the INSTALLED test app through WebView2's debugging port, not a
 * browser and not the dev server. It is not run by `npm run test:e2e`; `npm run test:desktop-update` installs the app, starts it and
 * calls this config. One worker and no retry: a test that installs and updates cannot be repeated from the middle.
 */
export default defineConfig({
  testDir: './e2e-desktop',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 10 * 60_000,
  reporter: 'list',
  use: { actionTimeout: 15_000, trace: 'off' },
})
