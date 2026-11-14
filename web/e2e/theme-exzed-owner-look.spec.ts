import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * What the owner found at his first look at eX-Zed (Phase 51.13; docs/tasks/owner-look-51-findings.md), pinned in both engines and all six skins. Quantum draws a hover as the `--hover` tint, which eX-Zed
 * maps to the paper, so any control eX-Zed has not drawn itself shows no hover at all; each of these is one such control, or a colour that Quantum's own rule left behind. Mocked routes only: nothing is written.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

const base = { description: null, externalRef: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const summary = (id: string, title: string) => ({ ...base, id, title, mediaType: 'movie', source: 'canonical', status: null, stats: { totalItems: 2, consumedItems: 0, newItems: 0, completionPercent: 0, timeRemainingMinutes: 200, lastConsumedAt: null } })
const item = (n: number, group: string | null = null) => ({ id: `i${n}`, listId: 'L1', title: `Item ${n}`, orderIndex: n, timeToConsumeMinutes: 100, timeToConsumeIsEstimated: false, consumedAt: null, source: 'canonical', year: 2000, yearUnk: 0, group, tags: null, notes: null, isNew: false })
const LIBRARY = [
  { externalRef: 'canonical:lists/movie/a.yaml', title: 'Vault One', category: 'movie', itemCount: 5 },
  { externalRef: 'canonical:lists/movie/b.yaml', title: 'Vault Two', category: 'movie', itemCount: 6 },
]

async function open(page: Page, skin: string, width = 1440) {
  await page.setViewportSize({ width, height: 900 })
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: LIBRARY, reachable: true } }))
  await page.route('**/api/lists', (route) => route.fulfill({ json: [summary('L1', 'One'), summary('L2', 'Two')] }))
  await page.route('**/api/lists/L1', (route) => route.fulfill({ json: { ...summary('L1', 'One'), items: [item(1, 'Group A'), item(2, 'Group B'), item(3)], groups: [{ id: 'g1', listId: 'L1', name: 'Group A', orderIndex: 0 }, { id: 'g2', listId: 'L1', name: 'Group B', orderIndex: 1 }] } }))
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin }))
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)

async function openList(page: Page, skin: string) {
  await open(page, skin)
  await page.locator('.q-home-row').first().click()
  await page.locator('.q-item').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

for (const skin of SKINS) {
  test(`${skin}: the skin button's caret takes the button's colour, not Quantum's grey, when the button is lit`, async ({ page }) => {
    await open(page, skin)
    const button = page.locator('.q-skin-btn')
    const caret = page.locator('.q-skin-caret')
    const hlInk = rgbOf(await token(page, '--zx-hl-ink'))

    await page.mouse.move(0, 0)
    expect((await style(caret, ['color'])).color, 'at rest it follows the button').toBe((await style(button, ['color'])).color)
    await button.hover()
    expect((await style(button, ['color'])).color, 'the lit button is in the highlight ink').toBe(hlInk)
    expect((await style(caret, ['color'])).color, 'and so is its caret').toBe(hlInk)
  })

  test(`${skin}: Hide Done and Fold All show a hover the way a chip does`, async ({ page }) => {
    await openList(page, skin)
    const dimBg = rgbOf(await token(page, '--zx-dim-bg'))
    const dimInk = rgbOf(await token(page, '--zx-dim-ink'))
    for (const selector of ['.q-hide-done', '.q-fold']) {
      const control = page.locator(selector).first()
      await page.mouse.move(0, 0)
      const rest = await style(control, ['background-color', 'color'])
      await control.hover()
      const hover = await style(control, ['background-color', 'color'])
      expect(hover['background-color'], `${selector}: hover is the dim block`).toBe(dimBg)
      expect(hover.color, `${selector}: hover ink`).toBe(dimInk)
      expect(hover['background-color'], `${selector}: it changes`).not.toBe(rest['background-color'])
    }
  })

  test(`${skin}: a focused field's border is not the border it has at rest`, async ({ page }) => {
    await openList(page, skin)
    const field = page.locator('.q-filter-input').first()
    await page.mouse.move(0, 0)
    const rest = await style(field, ['border-top-color'])
    await field.focus()
    expect((await style(field, ['border-top-color']))['border-top-color'], 'focus changes the border colour').not.toBe(rest['border-top-color'])
  })

  test(`${skin}: I'm Tired Boss's list options are highlighted under the pointer`, async ({ page }) => {
    await open(page, skin)
    await page.getByRole('button', { name: /Tired, Boss/ }).click()
    await page.locator('.q-tired-target').click()
    const option = page.locator('.q-tired-picker .option:not(.current)').first()
    await option.waitFor()
    await page.mouse.move(0, 0)
    const rest = await style(option, ['background-color'])
    await option.hover()
    const hover = await style(option, ['background-color', 'color'])
    expect(hover['background-color'], 'hover is the highlight').toBe(rgbOf(await token(page, '--zx-hl-bg')))
    expect(hover.color).toBe(rgbOf(await token(page, '--zx-hl-ink')))
    expect(hover['background-color']).not.toBe(rest['background-color'])
  })

  test(`${skin}: Choose Your Fighter's example list cards are highlighted under the pointer`, async ({ page }) => {
    await open(page, skin)
    await page.getByRole('button', { name: 'New List', exact: true }).click()
    const card = page.locator('.q-vault-card').first()
    await card.waitFor()
    await page.mouse.move(0, 0)
    const rest = await style(card, ['background-color'])
    await card.hover()
    const hover = await style(card, ['background-color', 'color'])
    expect(hover['background-color'], 'hover is the highlight').toBe(rgbOf(await token(page, '--zx-hl-bg')))
    expect(hover.color).toBe(rgbOf(await token(page, '--zx-hl-ink')))
    expect(hover['background-color']).not.toBe(rest['background-color'])
  })
}

test('Lotus: a tile names its source in the category colour (ink), not the art blue', async ({ page }) => {
  await open(page, 'exzed-1l')
  await page.getByRole('button', { name: 'New List', exact: true }).click()
  const source = page.locator('.q-tile-src').first()
  await source.waitFor()
  await page.mouse.move(0, 0)
  expect((await style(source, ['color'])).color).toBe(rgbOf(await token(page, '--zx-ink')))
  expect((await style(page.locator('.q-tile-name b').first(), ['color'])).color, 'the same as the name beside it').toBe((await style(source, ['color'])).color)
})
