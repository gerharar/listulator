import { expect, test } from '@playwright/test'
import { useHomeFixture } from './fixtures.js'

/**
 * Canvas H-021 (Phase 37): text inside a card runs to the edge of the box it sits in; the card's own 1080px is the measure. What a real browser
 * lays out is measured here, because the CSS guard (`web/src/widthCaps.guard.test.ts`) can say a cap is gone but not what the text then does.
 * (The list description and the Create layer's subline are measured in `list-description.spec.ts`.)
 */
test('an error explanation runs to its block\'s padding, not to a 600px column (H-021)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await useHomeFixture(page)
  // Home's own error block: the paragraph is the server's reason.
  await page.route('**/api/**', (route) => route.abort())
  await page.goto('/')

  const block = page.locator('.q-error-block')
  await expect(block).toBeVisible({ timeout: 15_000 })
  await page.waitForFunction(() => document.getAnimations().length === 0)

  const read = await page.evaluate(() => {
    const box = document.querySelector('.q-error-block')!
    const paragraph = document.querySelector('.q-error-block p')!
    const padding = parseFloat(getComputedStyle(box).paddingLeft) + parseFloat(getComputedStyle(box).paddingRight)
    const border = parseFloat(getComputedStyle(box).borderLeftWidth) + parseFloat(getComputedStyle(box).borderRightWidth)

    return { block: box.getBoundingClientRect().width, paragraph: paragraph.getBoundingClientRect().width, padding, border }
  })

  // The paragraph fills the block inside its padding (it was 600px wide in a block of about a thousand).
  expect(read.block).toBeGreaterThan(900)
  expect(Math.abs(read.paragraph - (read.block - read.padding - read.border))).toBeLessThanOrEqual(1)
})
