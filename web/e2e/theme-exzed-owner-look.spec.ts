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

async function open(page: Page, skin: string, width = 1440, extra: Record<string, string> = {}) {
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
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin, ...extra }))
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

/** The list screen, with a group and a game list (its items have a Platform field). */
async function openGameList(page: Page, skin: string, width = 1440) {
  await open(page, skin, width)
  await page.route('**/api/lists/L1', (route) => route.fulfill({ json: { ...summary('L1', 'One'), mediaType: 'game', items: [item(1, 'Group A'), item(2, 'Group B'), item(3)], groups: [{ id: 'g1', listId: 'L1', name: 'Group A', orderIndex: 0 }, { id: 'g2', listId: 'L1', name: 'Group B', orderIndex: 1 }] } }))
  await page.route('**/api/lists', (route) => route.fulfill({ json: [{ ...summary('L1', 'One'), mediaType: 'game' }, summary('L2', 'Two')] }))
  await page.reload()
  await page.locator('.q-home-row').first().click()
  await page.locator('.q-item').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

for (const skin of SKINS) {
  test(`${skin}: the toast is one line when the sentence fits the window, even in a small one`, async ({ page }) => {
    await open(page, skin, 640)
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div class="q-toast fixed" role="status" id="probe"><span>Item added manually</span></div>'))
    const toast = page.locator('#probe')
    await page.mouse.move(0, 0)
    const box = (await toast.boundingBox())!
    const line = (await page.locator('#probe span').boundingBox())!
    expect(line.height, 'the sentence is on one 24px line').toBe(24)
    expect(box.height, 'so the toast is the card’s 52px').toBe(52)
  })

  test(`${skin}: the list menu is wide enough for every row's label, Reorder List included`, async ({ page }) => {
    await openList(page, skin)
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.locator('.q-pop .q-btn').first().waitFor()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.q-pop')!).opacity === '1')
    const clipped = await page.locator('.q-pop .q-pop-menu .q-btn').evaluateAll((buttons) => buttons.filter((b) => b.scrollWidth > b.clientWidth).map((b) => b.textContent))
    expect(clipped, 'no row’s text runs past its highlight').toEqual([])
    expect((await page.locator('.q-pop').boundingBox())!.width, 'never narrower than the card’s 240px').toBeGreaterThanOrEqual(240)
  })

  test(`${skin}: a group's bin is in the same column as an item's`, async ({ page }) => {
    await openList(page, skin)
    const group = (await page.locator('.q-group .q-group-remove').first().boundingBox())!
    const row = (await page.locator('.q-item .q-icon-btn.row.remove').first().boundingBox())!
    expect(group.x + group.width, 'right edges meet').toBe(row.x + row.width)
  })

  test(`${skin}: the Platform card is wide enough to read a platform on one line`, async ({ page }) => {
    await openGameList(page, skin)
    await page.locator('.q-item', { hasText: 'Item 1' }).locator('.q-icon-btn.edit').click()
    await page.locator('.q-platfield').click()
    await page.waitForFunction(() => document.querySelector('.q-platpanel') && getComputedStyle(document.querySelector('.q-platpanel')!).opacity === '1')
    const list = page.locator('.q-platpanel-list')
    const over = await list.evaluate((e) => e.scrollWidth - e.clientWidth)
    expect(over, 'the list does not scroll sideways').toBeLessThanOrEqual(0)
    const wrapped = await page.locator('.q-platpanel-row .q-platpanel-name').evaluateAll((names) =>
      names.filter((n) => !n.querySelector('.q-platpanel-sub') && n.getBoundingClientRect().height > 24).map((n) => n.textContent),
    )
    expect(wrapped, 'no platform name wraps').toEqual([])
  })

  test(`${skin}: the small-window notice is readable: it has the paper under it, not the art`, async ({ page }) => {
    await open(page, skin, 900)
    const banner = page.locator('.q-banner')
    await banner.waitFor()
    expect((await style(banner, ['background-color']))['background-color']).toBe(rgbOf(await token(page, '--zx-paper')))
    const header = (await page.locator('.q-appheader').boundingBox())!
    const box = (await banner.boundingBox())!
    expect(box.y, 'under the header, not behind it').toBeGreaterThanOrEqual(header.y + header.height - 1)
    const text = (await page.locator('.q-banner > span').boundingBox())!
    expect(text.y + text.height, 'the sentence is inside the banner').toBeLessThanOrEqual(box.y + box.height)
  })
}

test('Surprise Me: the sheet keeps its height while the dials spin, whatever the length of the names that go by', async ({ page }) => {
  const long = (n: number) => `A very long list name number ${n} that cannot fit on one line of a sheet because it keeps on going and going and going`
  await open(page, 'exzed-1d', 1440, { reducedMotion: 'false' })
  await page.route('**/api/library/untracked', (route) =>
    route.fulfill({ json: { entries: [1, 2, 3, 4, 5, 6].map((n) => ({ externalRef: `canonical:lists/movie/${n}.yaml`, title: n % 2 ? long(n) : `Short ${n}`, category: 'movie', itemCount: 5 })), reachable: true } }),
  )
  await page.getByRole('button', { name: 'Surprise Me' }).click()
  await page.getByRole('button', { name: 'Spin To Win!' }).click()
  const heights = new Set<number>()
  const started = Date.now()
  while (Date.now() - started < 1800) {
    if ((await page.locator('.q-digit.ticking').count()) === 0) break
    heights.add(Math.round((await page.locator('.q-reel-result').boundingBox())!.height))
    await page.waitForTimeout(40)
  }
  expect(heights.size, `the result's height while spinning: ${[...heights].join(', ')}`).toBe(1)
})
