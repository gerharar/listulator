import { expect, test, type Page } from '@playwright/test'
import { q } from './fixtures.js'

/**
 * No Quantum line icon under eX-Zed (57.9, design's D46: "all of them in this pass; no Quantum line icon should be left under eX-Zed"), on the real screens, in both engines. A line icon is an
 * `svg` drawn as a stroke on no fill (Quantum's `lucide` icons); the theme's are pixel cells filled in `currentColor` (`PixelIcon`). The list toolbar's Hide Done (the eye with the slash), Collapse
 * and Expand (chevrons turned in, and out), To Top and To Bottom (the arrows, dithered when disabled) and the close button of every layer are design's pixel icons now. The Settings (?) buttons are
 * the one place left, and 57.10 takes them with rule 6; the whole sweep (`IDENTITY_MODE=sweep`, rule `icon`, e2e-tools/identity/sweep.ts) reads every screen in six skins.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

async function boot(page: Page, skin: string) {
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

/** The class of the control around every visible `svg` that is a stroke on no fill, except the (?) buttons of Settings (57.10's). */
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

async function openList(page: Page, skin: string) {
  const rows = Array.from({ length: 40 }, (_, n) => `  - { title: "Item ${n + 1}", minutes: 30, group: "Season ${Math.floor(n / 10) + 1}" }`)
  const title = `e2e icons ${skin} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`
  const made = await page.request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  const id = (await made.json()).id as string
  await boot(page, skin)
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)

  return id
}

for (const skin of SKINS) {
  test(`${skin}: the list's toolbar has pixel icons: Hide Done, Collapse and Expand, To Top and To Bottom (dithered when disabled)`, async ({ page }) => {
    const id = await openList(page, skin)
    try {
      expect(await lineIcons(page), 'no line icon on the list screen').toEqual([])

      await expect(page.locator('.q-hide-done svg[data-pixel-icon="hide-done"]')).toHaveCount(1)
      await expect(page.locator('.q-fold svg[data-pixel-icon="collapse-all"]')).toHaveCount(1)

      const halves = page.locator('.q-ends-half')
      await expect(halves.nth(0).locator('svg[data-pixel-icon="to-the-top"]')).toHaveCount(1)
      await expect(halves.nth(1).locator('svg[data-pixel-icon="to-the-bottom"]')).toHaveCount(1)
      // At the top, To Top is disabled and its icon is dithered (the theme's disabled look: a checkerboard mask); To Bottom is live and solid.
      const mask = (index: number) => halves.nth(index).locator('svg').evaluate((svg) => getComputedStyle(svg).webkitMaskImage || getComputedStyle(svg).maskImage)
      expect(await halves.nth(0).isDisabled(), 'at the top').toBe(true)
      expect(await mask(0), 'To Top, disabled, is dithered').not.toBe('none')
      expect(await mask(1), 'To Bottom, live, is solid').toBe('none')

      // Folding every group puts the whole list in view: Collapse becomes Expand, and both ends are disabled (and dithered).
      await page.locator('.q-fold').click()
      await expect(page.locator('.q-fold svg[data-pixel-icon="expand-all"]'), 'Expand turns the chevrons out').toHaveCount(1)
      await expect(halves.nth(1)).toBeDisabled()
      expect(await mask(1), 'To Bottom, disabled, is dithered').not.toBe('none')
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}

test('every layer closes with the pixel close icon, and none shows a line icon (Settings, About, New List, Choose Your Fighter, List Vault)', async ({ page }) => {
  await boot(page, 'exzed-1d')
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  const closeOnTop = (name: string) => page.locator('.q-layer').last().locator('svg[data-pixel-icon="close"]').first().waitFor().then(() => name)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('.q-settings').waitFor()
  expect(await closeOnTop('Settings')).toBe('Settings')
  expect(await lineIcons(page), 'Settings').toEqual([])

  await page.getByRole('button', { name: 'About', exact: true }).click()
  await page.locator('.q-about').waitFor()
  expect(await closeOnTop('About')).toBe('About')
  expect(await lineIcons(page), 'About').toEqual([])

  await page.goto('/')
  await page.getByRole('button', { name: q.home.newList }).click()
  await page.locator('.q-tile').first().waitFor()
  expect(await closeOnTop('Choose Your Fighter')).toBe('Choose Your Fighter')
  expect(await lineIcons(page), 'Choose Your Fighter').toEqual([])

  await page.locator('.q-tile').first().click()
  await page.getByRole('tab', { name: q.createList.handTab }).click()
  await page.getByLabel(q.addByHand.titleLabel, { exact: true }).waitFor()
  expect(await closeOnTop('New List')).toBe('New List')
  expect(await lineIcons(page), 'New List').toEqual([])

  await page.goto('/')
  await page.getByRole('button', { name: q.home.newList }).click()
  await page.getByRole('button', { name: q.vaultShelf.browse }).click()
  await page.locator('.q-vb-cat').first().waitFor()
  expect(await closeOnTop('List Vault')).toBe('List Vault')
  expect(await lineIcons(page), 'List Vault').toEqual([])
})

test('the Preview closes with the pixel close icon too', async ({ page }) => {
  const items = Array.from({ length: 6 }, (_, n) => ({ title: `Preview item ${n + 1}`, timeToConsumeMinutes: 30 }))
  await page.route('**/api/media-types/music/search**', (route) =>
    route.fulfill({ json: { sources: [{ externalRef: 'icons-1', title: 'Icons source', detail: 'Group · XX', itemCount: items.length }] } }),
  )
  await page.route('**/api/media-types/music/expansion**', (route) =>
    route.fulfill({ json: route.request().url().includes('items=true') ? { itemCount: items.length, status: 'complete', items } : { itemCount: items.length } }),
  )
  await boot(page, 'exzed-1d')
  await page.goto('/')
  await page.getByRole('button', { name: q.home.newList }).click()
  await page.locator('.q-tile', { hasText: /^Music/ }).click()
  await page.getByLabel(/^Search .* or List Vault$/).fill('icons')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('.q-result').first().waitFor()
  await page.locator('.q-result').first().click()
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
  await page.locator('.q-preview-row').first().waitFor()

  await expect(page.locator('.q-layer').last().locator('svg[data-pixel-icon="close"]').first()).toBeVisible()
  expect(await lineIcons(page), 'the Preview').toEqual([])
})
