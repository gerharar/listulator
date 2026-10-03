import { defineConfig, devices } from '@playwright/test'

/**
 * The real-browser checks task 10.7 deferred (jsdom can't lay out real
 * pixels — see docs/DECISIONS.md, "jsdom + `@testing-library/react` added;
 * floating-ui's flip is untestable under jsdom") plus the ones 10.8/10.9c
 * carried forward the same way. `webServer` boots the *whole* app (server +
 * web) from the repo root — `App.tsx`'s boot sequence calls `api.me()`/
 * `mediaTypes()` through the dev proxy, so web alone never gets past the
 * loading state and no test could ever find `.q-skin-btn`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    // A click on a label that no longer exists must fail in seconds with its name, not wait out the whole
    // test timeout and surface as an unrelated error in the cleanup that follows (BL-030).
    actionTimeout: 10_000,
    locale: 'en-US',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    /**
     * Not a substitute for the real Tauri/WKWebView desktop shell, but a
     * genuine second engine (WebKit) rather than an assumption that
     * Chromium's result carries over. The CDP-only reduced-transparency
     * spec skips itself outside Chromium (no cross-engine equivalent API);
     * everything else here runs for real under both.
     */
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run dev',
    cwd: '../',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
})
