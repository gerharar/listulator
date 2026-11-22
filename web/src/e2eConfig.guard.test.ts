import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * BL-179: the stems specs (`e2e/theme-exzed-stems.spec.ts`) read the pixels of eX-Zed's text and expect two colours (ground and ink) at 100% and at 200%. On the Linux runner Chromium smoothed the text with
 * LCD sub-pixel anti-aliasing at 100% (the blends had a different share of each colour channel: 0,26,80 beside 0,215,215), so every one of them failed at 100% and none at 200%, where Chromium turns it off.
 * The Mac never uses it, so the specs passed there. The Chromium project starts without it, so the specs measure the same text on every machine; this reads the config because that is one line anyone can drop.
 */
const config = readFileSync(join(import.meta.dirname, '..', 'playwright.config.ts'), 'utf8')

describe('the browser tests’ Chromium (BL-179)', () => {
  it('starts without LCD text, so the pixel specs read the same two colours on every machine', () => {
    expect(config).toMatch(/name: 'chromium',[^\n]*launchOptions:\s*{\s*args:\s*\[[^\]]*'--disable-lcd-text'/)
  })

  it('puts the app’s own output in the log when it runs in CI, where the dev server has died with nothing said', () => {
    expect(config).toMatch(/stdout:\s*process\.env\['CI'\]\s*\?\s*'pipe'/)
  })

  it('does not do so for WebKit, which has no such switch', () => {
    expect(config).not.toMatch(/name: 'webkit',[^\n]*launchOptions/)
  })
})
