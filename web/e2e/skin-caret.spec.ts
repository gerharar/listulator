import { expect, test } from '@playwright/test'
import { useHomeFixture } from './fixtures.js'

/**
 * The skin button's triangle (canvas H-027, design's answer of 2026-11-06). It is the 6 x 5 picker triangle, centred on the button: its
 * middle within 0.5px of the button's middle, at every display scale. The earlier rule here (the top on a whole device pixel at 125% to
 * 200%, with a 13px margin) is withdrawn: design judged a faint top row at 125% cheaper than a mark sitting visibly high beside the swatch
 * (DECISIONS 2026-11-06, "Settled by design"). The Windows glyph bug that started it was the system font, which the drawing already removed.
 */
for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
  test.describe(`at a display scale of ${scale}`, () => {
    test.use({ deviceScaleFactor: scale, viewport: { width: 1100, height: 700 } })

    test('the skin button’s triangle is 6 x 5 and its middle is the button’s middle', async ({ page }) => {
      await useHomeFixture(page)
      await page.goto('/')
      const caret = page.locator('.q-skin-caret')
      await expect(caret).toBeVisible({ timeout: 15_000 })

      const box = await caret.boundingBox()
      const button = await page.locator('.q-skin-btn').boundingBox()
      expect(box?.width).toBeCloseTo(6, 2)
      expect(box?.height).toBeCloseTo(5, 2)
      const caretMiddle = (box?.y ?? Number.NaN) + (box?.height ?? Number.NaN) / 2
      const buttonMiddle = (button?.y ?? Number.NaN) + (button?.height ?? Number.NaN) / 2
      expect(Math.abs(caretMiddle - buttonMiddle)).toBeLessThanOrEqual(0.5)
    })
  })
}
