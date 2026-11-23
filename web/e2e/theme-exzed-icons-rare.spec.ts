import { expect, test, type Page } from '@playwright/test'
import { FIXTURE_LIST_ID, q, useHomeFixture } from './fixtures.js'

/**
 * The four rarely reached places that might still draw a line icon under eX-Zed (57.9b, design's D60 on top of D46): the toast's Undo, the update banner (Home's, under its header),
 * the Preview's "Open My List" state, and the Platform panel's picked chips in an item's Edit window. A line icon is an `svg` drawn as a stroke on no fill (Quantum's `lucide`
 * icons); the theme's are pixel cells in `currentColor` (`PixelIcon`). Each place is reached on the real screen, in both engines, and read the way the sweep reads it (rule `icon`).
 * The first three draw none (text only, or a pixel icon already); the Platform panel's "×" was a text glyph at 13px, off the 8×8 grid, and is the pixel `close` icon now.
 */
const SKIN = 'exzed-1d'

async function boot(page: Page, skin = SKIN) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin }))
}

/** The class of the control around every visible `svg` that is a stroke on no fill (what the sweep's rule `icon` reads). */
const lineIcons = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('svg')]
      .filter((svg) => {
        const style = getComputedStyle(svg)
        const box = svg.getBoundingClientRect()

        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 1 && box.height > 1 && style.fill === 'none' && style.stroke !== 'none'
      })
      .map((svg) => svg.closest('button, a, span')?.className ?? '?')
      .filter((name) => !String(name).includes('q-help')),
  )

async function ownList(page: Page, category: string, label: string) {
  const rows = Array.from({ length: 4 }, (_, n) => `  - { title: "Thing ${n + 1}", minutes: 30, group: "Part ${Math.floor(n / 2) + 1}" }`)
  const title = `e2e rare icons ${label} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`
  const made = await page.request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: ${category}\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)

  return { id: ((await made.json()) as { id: string }).id, title }
}

test('the toast with Undo draws no line icon', async ({ page }) => {
  const { id, title } = await ownList(page, 'movie', 'toast')
  try {
    await boot(page)
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.locator('.q-item').first().waitFor()
    await page.locator('.q-item', { hasText: 'Thing 1' }).first().focus()
    await page.keyboard.press('Shift+ArrowDown')
    await page.locator('.q-toast').waitFor()

    await expect(page.locator('.q-toast').getByRole('button', { name: 'Undo' }), 'the toast offers Undo').toBeVisible()
    expect(await lineIcons(page), 'the toast and its Undo').toEqual([])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the update banner under Home’s header draws no line icon, and the header’s refresh is the pixel icon', async ({ page }) => {
  await useHomeFixture(page)
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.addInitScript(([id]) => localStorage.setItem('updates:pending', JSON.stringify({ [id!]: { count: 2, checkedAt: '2026-01-01T00:00:00.000Z' } })), [FIXTURE_LIST_ID])
  await boot(page)
  await page.goto('/')
  await page.locator('.q-banner').first().waitFor()

  await expect(page.locator('.q-home-actions svg[data-pixel-icon="refresh"]')).toHaveCount(1)
  expect(await lineIcons(page), 'Home with an update banner').toEqual([])
})

test('the Preview of a list the person already has (Open My List) draws no line icon', async ({ page }) => {
  const mine = { externalRef: 'canonical:lists/movie/mine.yaml', title: 'Already mine', category: 'movie', itemCount: 4, tracked: true, trackedListId: FIXTURE_LIST_ID }
  const items = Array.from({ length: 4 }, (_, index) => ({ title: `Entry ${index + 1}`, timeToConsumeMinutes: 30, year: 2000 }))
  await useHomeFixture(page)
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.route('**/api/library', (route) => route.fulfill({ json: { entries: [mine], reachable: true } }))
  await page.route('**/api/media-types/*/expansion**', (route) => route.fulfill({ json: { itemCount: 4, status: 'complete', items } }))
  await boot(page)
  await page.goto('/')
  await page.getByRole('button', { name: q.home.newList }).click()
  await page.getByRole('button', { name: q.vaultShelf.browse }).click()
  await page.getByRole('navigation', { name: q.vaultBrowser.categoriesLabel }).getByRole('button', { name: /^Movies/ }).click()
  await expect(page.locator('.q-vb-mine'), 'the row says it is in My Lists').toHaveText(q.vaultBrowser.inMyLists)
  expect(await lineIcons(page), 'the Vault with an In My Lists row').toEqual([])
  await page.locator('.q-vb-row', { hasText: 'Already mine' }).click()
  await expect(page.getByRole('button', { name: q.preview.openMyList })).toBeVisible()

  expect(await lineIcons(page), 'the Preview with Open My List').toEqual([])
  await expect(page.locator('.q-layer').last().locator('svg[data-pixel-icon="close"]').first(), 'and it closes with the pixel icon').toBeVisible()
})

for (const skin of ['exzed-1d', 'exzed-1l'] as const) {
  test(`${skin}: a platform picked in an item's Edit window shows its chip with the pixel close icon, not a "×" glyph`, async ({ page }) => {
    const { id, title } = await ownList(page, 'game', `platform ${skin}`)
    try {
      await boot(page, skin)
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-item').first().waitFor()
      await page.locator('.q-item', { hasText: 'Thing 1' }).locator('.q-icon-btn.edit').click()
      await page.locator('.q-platfield').click()
      await page.locator('.q-platpanel-row').first().click()
      const token = page.locator('.q-platpanel-token').first()
      await token.waitFor()

      await expect(token.locator('svg[data-pixel-icon="close"]'), 'the chip’s remove mark is the pixel close icon').toHaveCount(1)
      expect((await token.textContent())?.includes('×'), 'and no "×" glyph is left in it').toBe(false)
      const box = await token.locator('svg').evaluate((svg) => {
        const { width, height } = svg.getBoundingClientRect()

        return { width, height }
      })
      expect(box, 'drawn 16px square, the other pixel icons’ size').toEqual({ width: 16, height: 16 })
      expect(await lineIcons(page), 'with a platform picked').toEqual([])
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}
