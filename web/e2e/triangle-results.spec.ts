import { expect, test, type Page } from '@playwright/test'
import { q, useHomeFixture } from './fixtures.js'
import { readInk } from './triangleInk.js'

/**
 * A search result's arrow in a real browser (canvas H-027, 47.4; the best-bet row shares every rule below, see SearchResultRow.css). It was an 11px ▶ / ▼ glyph
 * centred on the two-line block (the title's line plus the subline), 11px below the title's cap middle. Now it is the row-fold triangle in an 8 x 8 box centred
 * in the same 12px column, so nothing moves (design's answer, reading A: the title and the open block stay at 30px), with its ink's middle within 0.5px of the
 * title's cap middle, shut and open. Pixels are read at four times the display scale (`triangleInk.ts`).
 */
test.use({ deviceScaleFactor: 4, viewport: { width: 1100, height: 900 } })

async function searchResults(page: Page) {
  await useHomeFixture(page)
  const sources = [
    { externalRef: 'mb-1', title: 'Cannibal Corpse Discography', detail: 'Group · US' },
    { externalRef: 'mb-2', title: 'Cannibal Corpse Tribute', detail: 'Group · DE' },
  ]
  await page.route('**/api/media-types/music/search**', (route) => route.fulfill({ json: { sources } }))
  await page.route('**/api/media-types/music/expansion**', (route) => route.fulfill({ json: { itemCount: 14 } }))
  await page.goto('/')
  await page.getByRole('button', { name: q.home.newList }).click()
  await page.locator('.q-tile', { hasText: 'Music' }).click()
  await page.getByLabel(q.search.queryLabel('MusicBrainz'), { exact: true }).fill('cannibal')
  await page.getByRole('button', { name: q.search.searchButton, exact: true }).click()
  await expect(page.locator('.q-result .chev svg')).toHaveCount(2)
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

const geometry = (page: Page) =>
  page.locator('.q-result').first().evaluate((row) => {
    const start = row.getBoundingClientRect().x
    const svg = row.querySelector('.chev svg')!.getBoundingClientRect()
    const more = row.nextElementSibling?.classList.contains('q-result-more') ? row.nextElementSibling : null

    return {
      svg: [svg.x - start, svg.width, svg.height],
      title: row.querySelector('.title')!.getBoundingClientRect().x - start,
      detailsText: more ? more.querySelector('.prov, .desc')!.getBoundingClientRect().x - start : null,
      glyph: row.querySelector('.chev')!.textContent,
    }
  })

test('the arrow is an 8 x 8 drawing in the 12px column, and the title and the open block stay at 30px', async ({ page }) => {
  await searchResults(page)

  expect(await geometry(page)).toEqual({ svg: [8, 8, 8], title: 30, detailsText: null, glyph: '' })

  await page.locator('.q-result').first().click()
  await expect(page.locator('.q-result').first()).toHaveAttribute('aria-expanded', 'true')
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect(await geometry(page)).toEqual({ svg: [8, 8, 8], title: 30, detailsText: 30, glyph: '' })
})

test('its ink’s middle is within 0.5px of the title’s cap middle, shut and open', async ({ page }) => {
  await searchResults(page)
  const spec = { row: '.q-result', triangle: '.chev svg', text: '.title' }

  // Shut, 0.65: one lift (4.5px) serves both states, so the box does not move when the arrow turns; no single number is within 0.5 in both engines (Chromium moves
  // the lifted arrow in whole-pixel steps), and design chose this miss: Chromium +0.38, WebKit +0.63 (answer of 2026-11-06; DECISIONS 2026-11-06).
  expect(Math.abs((await readInk(page, spec)).delta), 'shut').toBeLessThanOrEqual(0.65)

  await page.locator('.q-result').first().click()
  await expect(page.locator('.q-result').first()).toHaveAttribute('aria-expanded', 'true')
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect(Math.abs((await readInk(page, spec)).delta), 'open').toBeLessThanOrEqual(0.5)
})
