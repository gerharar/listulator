import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/**
 * The identity tool (Phase 48.0): captures every screen of every theme and skin, in both engines, and compares a later capture with an
 * earlier one, to show that a change meant to leave a theme as it was has left it as it was. Not part of `npm test`; see README.md.
 *   cd web && IDENTITY_MODE=capture IDENTITY_BASELINE=<label> npx playwright test -c e2e-tools/playwright.identity.config.ts
 * It boots its own app on a throw-away database and never reuses a running server: the owner's `tauri dev` holds the same port, so it must be closed.
 */
const databaseDir = (process.env['IDENTITY_DB_DIR'] ??= mkdtempSync(join(tmpdir(), 'listulator-identity-')))

export default defineConfig({
  testDir: './identity',
  testMatch: '**/*.tool.ts',
  fullyParallel: true,
  workers: 4,
  // A few icon edges are rasterised differently on about one load in ten under heavy load (the tooltip state: the cube icon, 16 pixels). A real change shows
  // on every load and noise does not, so a failing comparison is repeated in a fresh page; one that passes only on a repeat is reported as flaky, not hidden.
  retries: process.env['IDENTITY_MODE'] === 'compare' ? 2 : 0,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    locale: 'en-US',
    timezoneId: 'UTC',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    // With motion on, the same page rasterises a few icon edges differently on every load (measured: four loads, four different screenshots; with
    // motion off, four identical ones). The tool needs identical pixels for identical CSS, so it runs with reduced motion, as the app's own setting
    // and the system's. What it then cannot see is the keyframes themselves (docs/DECISIONS.md, 2026-11-08, identity tool).
    reducedMotion: 'reduce',
    actionTimeout: 10_000,
    // A service worker would answer some requests behind `page.route` in WebKit (the perf config says the same).
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'seed', testMatch: /seed\.tool\.ts/, teardown: 'cleanup' },
    { name: 'cleanup', testMatch: /cleanup\.tool\.ts/ },
    { name: 'chromium', testMatch: /capture\.tool\.ts/, dependencies: ['seed'], use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', testMatch: /capture\.tool\.ts/, dependencies: ['seed'], use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev',
    cwd: '../../',
    url: 'http://127.0.0.1:5173',
    env: { DATABASE_PATH: join(databaseDir, 'identity.sqlite') },
    reuseExistingServer: false,
    timeout: 90_000,
  },
})
