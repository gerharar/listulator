import { expect, test, type Page } from '@playwright/test'
import { useHomeFixture } from './fixtures.js'
import { readInk } from './triangleInk.js'

/**
 * About's TMDB arrow in a real browser (canvas H-027, 47.3). It was an 11px ▶ glyph that sat about 2px low on the label (the glyph's box on the baseline;
 * measured +1.88px in both engines, task 47.0). Now it is the row-fold triangle in an 8 x 8 box, centred in the 12px column the glyph had (so the label
 * does not move: 18px from the toggle's left edge), and its ink's middle is within 0.5px of the label's cap middle, open (down) and shut (right).
 * Pixels are read at four times the display scale (`triangleInk.ts`).
 */
test.use({ deviceScaleFactor: 4, viewport: { width: 1100, height: 900 } })

async function openAbout(page: Page) {
  await useHomeFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'About', exact: true }).click()
  await expect(page.locator('.q-about-tmdb .q-about-chevron svg')).toBeVisible()
  // The layer scales in on opening; measure once it has settled.
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

const geometry = (page: Page) =>
  page.locator('.q-about-toggle').evaluate((toggle) => {
    const column = toggle.querySelector('.q-about-chevron')!.getBoundingClientRect()
    const svg = toggle.querySelector('.q-about-chevron svg')!.getBoundingClientRect()
    const text = [...toggle.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim())!
    const range = document.createRange()
    range.selectNodeContents(text)
    const start = toggle.getBoundingClientRect().x

    return {
      column: [column.x - start, column.width],
      svg: [svg.x - column.x, svg.width, svg.height],
      labelLeft: range.getClientRects()[0]!.x - start,
      glyph: toggle.querySelector('.q-about-chevron')!.textContent,
    }
  })

test('the arrow is an 8 x 8 drawing in the 12px column, and the label stays 18px from the toggle’s edge', async ({ page }) => {
  await openAbout(page)

  expect(await geometry(page)).toEqual({ column: [0, 12], svg: [2, 8, 8], labelLeft: 18, glyph: '' })
})

test('its ink’s middle is within 0.5px of the label’s cap middle, open and shut', async ({ page }) => {
  await openAbout(page)
  const spec = { row: '.q-about-tmdb', triangle: '.q-about-chevron svg', text: '.q-about-toggle', skip: '.q-about-chevron' }

  expect(Math.abs((await readInk(page, spec)).delta), 'open').toBeLessThanOrEqual(0.5)

  await page.locator('.q-about-toggle').click()
  await expect(page.locator('.q-about-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.q-about-attribution')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect(Math.abs((await readInk(page, spec)).delta), 'shut').toBeLessThanOrEqual(0.5)
})
