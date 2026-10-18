import { defineConfig, devices } from '@playwright/test'

/**
 * Phase 25.0 (BACKLOG BL-074): the list screen's cost at 2,500 to 50,000 items, measured in a real browser against the PRODUCTION
 * build (`vite preview`: the dev server's React is several times slower and is not what a person runs). Run by hand, never in
 * the suite (its files end in `.perf.ts`, which the normal config does not match):
 *   cd web && npx playwright test -c playwright.perf.config.ts
 * It builds the lists through the real API and removes them afterwards.
 */
export default defineConfig({
  testDir: './e2e/perf',
  testMatch: '**/*.perf.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 15 * 60_000,
  reporter: 'list',
  // The production build registers a service worker; in WebKit a request that goes through it escapes `page.route`, so the Preview spec's stubbed answers
  // were not applied (26.0). The page's own cost is what is measured, so no worker.
  use: { baseURL: 'http://127.0.0.1:4173', locale: 'en-US', serviceWorkers: 'block' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--enable-precise-memory-info'] } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    { command: 'npm run dev:server', cwd: '../', url: 'http://127.0.0.1:3001/api/lists', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run build -w @listulator/web && npm run preview -w @listulator/web', cwd: '../', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 240_000 },
  ],
})
