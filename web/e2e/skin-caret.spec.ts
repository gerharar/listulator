import { expect, test } from '@playwright/test'
import { useHomeFixture } from './fixtures.js'

/**
 * The skin button's arrow on a Windows display scale (owner, 2026-11-06, 125%: "the top of the arrow is not fully drawn compared to its
 * bottom"). The arrow is a drawing, and a drawing whose top edge falls between two device pixels paints that row only partly: measured in
 * Chromium, the top row was 56% ink at 125%, 24% at 150% and 6% at 175% (the arrow's top was 36.25, 43.5 and 50.75 device pixels down).
 * Layout can say where the edge falls, so this does: the top lands on a whole device pixel at the scales Windows offers.
 *
 * Chromium only: Windows draws in WebView2 (Chromium), and the fractional scales are a Windows thing (macOS is 1x or 2x, and 2x passes
 * in WebKit too). WebKit places the arrow about 0.2px lower than Chromium (not traced), so it would fail at the fractional scales.
 */
for (const scale of [1.25, 1.5, 1.75, 2]) {
  test.describe(`at a display scale of ${scale}`, () => {
    test.use({ deviceScaleFactor: scale, viewport: { width: 1100, height: 700 } })

    test('the skin button’s arrow starts on a whole device pixel', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'Windows draws in Chromium; see the comment above')
      await useHomeFixture(page)
      await page.goto('/')
      const caret = page.locator('.q-skin-caret')
      await expect(caret).toBeVisible({ timeout: 15_000 })

      const box = await caret.boundingBox()
      const top = (box?.y ?? Number.NaN) * scale
      expect(Math.abs(top - Math.round(top))).toBeLessThan(0.01)
    })
  })
}
