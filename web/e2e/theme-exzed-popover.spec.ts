import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng, type Pixels } from './pngPixels.js'

/**
 * eX-Zed's popovers (51.9, X-007; design's Popover and Menu cards), on the real screens, in both engines and all six skins, read in pixels. **A popover is a `paper` box with a 2px `frame-hi` border and a 4px
 * `paper` ring, 16px of padding; its tail is the card's 8x5 hollow staircase at 2px (16x10), the border's colour, whose base breaks the border into one outline (the tail's fill cells are `paper` over the
 * border row); the popover's edge is 8px from the button that opened it, and that button is lit (the highlight) while it is open.**
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
type Rgb = [number, number, number]
const RIM = 'M3 0h2v1H3zM2 1h1v1H2zM5 1h1v1H5zM1 2h1v1H1zM6 2h1v1H6zM0 3h1v2H0zM7 3h1v2H7z'
const FILL = 'M3 1h2v1H3zM2 2h4v1H2zM1 3h6v2H1z'

const base = { description: null, externalRef: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const SUMMARY = { ...base, id: 'L1', title: 'Pop', mediaType: 'movie', source: 'canonical', status: null, stats: { totalItems: 2, consumedItems: 0, newItems: 0, completionPercent: 0, timeRemainingMinutes: 200, lastConsumedAt: null } }
const item = (n: number) => ({ id: `i${n}`, listId: 'L1', title: `Item ${n}`, orderIndex: n, timeToConsumeMinutes: 100, timeToConsumeIsEstimated: false, consumedAt: null, source: 'canonical', year: 2000, yearUnk: 0, group: null, tags: null, notes: null, isNew: false })

async function open(page: Page, skin: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.route('**/api/lists', (route) => route.fulfill({ json: [SUMMARY] }))
  await page.route('**/api/lists/L1', (route) => route.fulfill({ json: { ...SUMMARY, items: [item(1), item(2)], groups: [] } }))
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
const rgbOf = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const css = (c: Rgb) => `rgb(${c.join(', ')})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)
function at(pixels: Pixels, scale: number, x: number, y: number): Rgb {
  const i = (Math.floor(y * scale + scale / 2) * pixels.width + Math.floor(x * scale + scale / 2)) * 4

  return [pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!]
}
const cells = (path: string) => {
  const filled = new Set<string>()
  for (const [, x, y, w, h] of path.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)H\d+z/g)) for (let dx = 0; dx < Number(w); dx++) for (let dy = 0; dy < Number(h); dy++) filled.add(`${Number(x) + dx},${Number(y) + dy}`)

  return filled
}
const box = async (locator: Locator) => (await locator.boundingBox())!

/** What a popover is, whichever opened it. */
async function checkPopover(page: Page, opener: Locator, label: string) {
  const [frameHi, paper, acc] = (await Promise.all(['--zx-frame-hi', '--zx-paper', '--zx-acc'].map((n) => token(page, n)))).map((hex) => rgbOf(hex)) as [Rgb, Rgb, Rgb]
  const pop = page.locator('.q-pop')
  await expect(pop, label).toHaveCount(1)
  await page.waitForFunction(() => document.querySelector('.q-pop') && getComputedStyle(document.querySelector('.q-pop')!).opacity === '1')
  await page.mouse.move(0, 0)

  const s = await style(pop, ['border-top-width', 'border-top-style', 'border-top-color', 'border-left-width', 'padding-top', 'padding-left', 'padding-right', 'padding-bottom', 'box-shadow'])
  expect(s, `${label}: 2px frame-hi border, 16px padding`).toMatchObject({
    'border-top-width': '2px',
    'border-top-style': 'solid',
    'border-top-color': css(frameHi),
    'border-left-width': '2px',
    'padding-top': '16px',
    'padding-left': '16px',
    'padding-right': '16px',
    'padding-bottom': '16px',
  })
  expect(s['box-shadow'], `${label}: the 4px paper ring`).toContain(`${css(paper)} 0px 0px 0px 4px`)

  // The popover's edge is 8px from the lit button, which is the highlight itself.
  const o = await box(opener)
  const p = await box(pop)
  expect(p.y - (o.y + o.height), `${label}: 8px from the button`).toBe(8)
  expect((await style(opener, ['background-color']))['background-color'], `${label}: the opener is lit`).toBe(css(acc))

  // The tail: 16x10, on the popover's top edge, the staircase's cells in the border's colour with the paper inside.
  const tail = page.locator('.q-pop-tail')
  const t = await box(tail)
  expect([t.width, t.height], `${label}: the tail is 16x10`).toEqual([16, 10])
  expect(Math.round(t.y + t.height), `${label}: its base row is the border row (the card's top edge)`).toBe(Math.round(p.y + 2))
  const pixels = decodePng(await page.screenshot({ clip: { x: Math.round(t.x), y: Math.round(t.y), width: 16, height: 10 } }))
  const scale = pixels.width / 16
  for (const key of cells(RIM)) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    expect(at(pixels, scale, x * 2 + 0.5, y * 2 + 0.5), `${label}: tail rim cell ${key}`).toEqual(frameHi)
  }
  for (const key of cells(FILL)) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    expect(at(pixels, scale, x * 2 + 0.5, y * 2 + 0.5), `${label}: tail fill cell ${key}`).toEqual(paper)
  }
}

for (const skin of SKINS) {
  test(`${skin}: the skin menu and the list menu are the card's popover: 2px frame-hi border, 4px ring, 16px padding, the staircase tail 8px from the lit opener`, async ({ page }) => {
    await open(page, skin)
    const skinButton = page.locator('.q-skin-btn')
    await skinButton.click()
    await checkPopover(page, skinButton, 'the skin menu')
    expect((await style(page.locator('.q-pop'), ['width'])).width, 'the skin menu is 288px').toBe('288px')
    await page.keyboard.press('Escape')
    await expect(page.locator('.q-pop')).toHaveCount(0)

    await page.locator('.q-home-row').first().click()
    await page.locator('.q-item').first().waitFor()
    const more = page.getByRole('button', { name: 'More', exact: true })
    await more.click()
    await checkPopover(page, more, 'the list menu')
    expect((await style(page.locator('.q-pop'), ['width'])).width, 'the list menu is 240px').toBe('240px')
  })
}

/** A real list with a group, a note and an item to edit: the row's own buttons (✎, ⓘ, a group's bin) are what the popovers open from. */
async function openRealList(page: Page, skin: string, width: number) {
  await page.setViewportSize({ width, height: 900 })
  const title = `e2e popover ${skin} ${test.info().project.name} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const yaml = `title: ${title}\ncategory: movie\nitems:\n  - { title: Alpha, group: One, notes: "A note" }\n  - { title: Beta, group: Two }\n`
  const created = await page.request.post('/api/lists/from-file', { data: { yaml } })
  expect(created.ok()).toBe(true)
  const id = (await created.json()).id as string
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
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
  await page.evaluate(() => document.fonts.ready)

  return id
}

/** Turns the tail's up-pointing cells a quarter, as the drawing does: `left` transposes them, `right` mirrors that. */
function turned(path: string, kind: 'left' | 'right') {
  const out = new Set<string>()
  for (const key of cells(path)) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    out.add(kind === 'left' ? `${y},${x}` : `${4 - y},${x}`)
  }

  return out
}

/** A popover from a button in a row: beside it, 8px away, the tail a 5x8 staircase (10x16) on the side that faces the button, centred on it. */
async function checkBeside(page: Page, opener: Locator, label: string, wanted: 'right' | 'left' | 'either') {
  const [frameHi, paper, acc] = (await Promise.all(['--zx-frame-hi', '--zx-paper', '--zx-acc'].map((n) => token(page, n)))).map((hex) => rgbOf(hex)) as [Rgb, Rgb, Rgb]
  const pop = page.locator('.q-pop')
  await expect(pop, label).toHaveCount(1)
  await page.waitForFunction(() => document.querySelector('.q-pop') && getComputedStyle(document.querySelector('.q-pop')!).opacity === '1')
  await page.mouse.move(0, 0)
  const o = await box(opener)
  const p = await box(pop)
  const want = wanted === 'either' ? (p.x > o.x ? 'right' : 'left') : wanted
  if (want === 'right') expect(p.x - (o.x + o.width), `${label}: 8px to the right of the button`).toBe(8)
  else expect(o.x - (p.x + p.width), `${label}: 8px to the left of the button`).toBe(8)
  expect(p.y <= o.y + o.height / 2 && p.y + p.height >= o.y + o.height / 2, `${label}: level with the button, not under it`).toBe(true)
  expect((await style(opener, ['background-color']))['background-color'], `${label}: the opener is lit`).toBe(css(acc))

  const kind = want === 'right' ? 'left' : 'right'
  const tail = page.locator('.q-pop-tail')
  const t = await box(tail)
  expect([t.width, t.height], `${label}: the tail is 10x16`).toEqual([10, 16])
  expect(Math.abs(t.y + t.height / 2 - (o.y + o.height / 2)), `${label}: centred on the button`).toBeLessThanOrEqual(1)
  if (kind === 'left') expect(Math.round(t.x + t.width), `${label}: its base column is the left border column`).toBe(Math.round(p.x + 2))
  else expect(Math.round(t.x), `${label}: its base column is the right border column`).toBe(Math.round(p.x + p.width - 2))
  const pixels = decodePng(await page.screenshot({ clip: { x: Math.round(t.x), y: Math.round(t.y), width: 10, height: 16 } }))
  const scale = pixels.width / 10
  for (const key of turned(RIM, kind)) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    expect(at(pixels, scale, x * 2 + 0.5, y * 2 + 0.5), `${label}: tail rim cell ${key}`).toEqual(frameHi)
  }
  for (const key of turned(FILL, kind)) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    expect(at(pixels, scale, x * 2 + 0.5, y * 2 + 0.5), `${label}: tail fill cell ${key}`).toEqual(paper)
  }
}

/** A game list: its items have a Platform field, whose panel joins the Edit window. */
async function openGameList(page: Page, skin: string, height = 900) {
  await page.setViewportSize({ width: 1440, height })
  const game = { ...SUMMARY, mediaType: 'game', source: 'manual' }
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.route('**/api/lists', (route) => route.fulfill({ json: [game] }))
  await page.route('**/api/lists/L1', (route) => route.fulfill({ json: { ...game, items: [item(1), item(2)], groups: [] } }))
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
  await page.locator('.q-home-row').first().click()
  await page.locator('.q-item').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

for (const skin of SKINS) {
  test(`${skin}: the list menu's rows are 40px menu items that take the highlight and Delete is not red; the skin menu's current skin is the highlight`, async ({ page }) => {
    await open(page, skin)
    const [ink, acc, accInk] = (await Promise.all(['--zx-ink', '--zx-acc', '--zx-acc-ink'].map((n) => token(page, n)))).map((hex) => rgbOf(hex)) as [Rgb, Rgb, Rgb]

    // The skin menu: the current skin is acc-filled, the others plain; every one is a full-width chip of its own.
    await page.locator('.q-skin-btn').click()
    const current = page.locator('.q-pop-menu button[aria-current="true"]')
    await expect(current).toHaveCount(1)
    expect(await style(current, ['background-color', 'color'])).toEqual({ 'background-color': css(acc), color: css(accInk) })
    const chips = await page.locator('.q-pop-menu button').count()
    expect(chips, 'the six skins').toBe(6)
    await page.keyboard.press('Escape')

    await page.locator('.q-home-row').first().click()
    await page.locator('.q-item').first().waitFor()
    await page.getByRole('button', { name: 'More', exact: true }).click()
    const rows = page.locator('.q-pop .q-pop-menu .q-btn')
    expect(await rows.count()).toBeGreaterThanOrEqual(4)
    for (let n = 0; n < (await rows.count()); n++) expect((await style(rows.nth(n), ['height', 'color']))).toEqual({ height: '40px', color: css(ink) })
    const last = rows.last()
    await last.hover()
    expect(await style(last, ['background-color', 'color'])).toEqual({ 'background-color': css(acc), color: css(accInk) })
  })

  test(`${skin}: a row's ✎ opens its Edit window beside the row: to the right with the tail pointing left when there is room, flipping to the left with the tail pointing right when there is not (D29)`, async ({ page }) => {
    const id = await openRealList(page, skin, 2400)
    try {
      const edit = page.locator('.q-item', { hasText: 'Alpha' }).locator('.q-icon-btn.edit')
      await edit.click()
      await checkBeside(page, edit, 'the Edit window with room', 'right')
      await page.keyboard.press('Escape')
      await expect(page.locator('.q-pop')).toHaveCount(0)

      await page.setViewportSize({ width: 1440, height: 900 })
      await edit.click()
      await checkBeside(page, edit, 'the Edit window at 1440', 'either')
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })

  test(`${skin}: an item's ⓘ notes card and a group's bin open beside their buttons too, and a list's own ⋯ menu stays below (D29)`, async ({ page }) => {
    const id = await openRealList(page, skin, 2400)
    try {
      const info = page.locator('.q-item', { hasText: 'Alpha' }).locator('.q-icon-btn.info')
      await info.click()
      await checkBeside(page, info, 'the notes card', 'either')
      await page.keyboard.press('Escape')
      await expect(page.locator('.q-pop')).toHaveCount(0)

      // A group's bin is at the window's right edge, so at 1440 the popover has no room there and flips to the left, its tail pointing right.
      await page.setViewportSize({ width: 1440, height: 900 })
      const bin = page.locator('.q-group .q-group-remove').first()
      await bin.click()
      await checkBeside(page, bin, 'the group bin, flipped', 'left')
      await page.locator('.q-catcher').click({ position: { x: 2, y: 2 } })
      await expect(page.locator('.q-pop')).toHaveCount(0)

      const more = page.getByRole('button', { name: 'More', exact: true })
      await more.click()
      await checkPopover(page, more, 'the list menu, from the list’s header')
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })

  test(`${skin}: the Platform panel joins the Edit window: one 2px divider where their frames meet, side by side from the same top`, async ({ page }) => {
    await openGameList(page, skin)
    const [frameHi] = (await Promise.all(['--zx-frame-hi'].map((n) => token(page, n)))).map((hex) => rgbOf(hex)) as [Rgb]
    await page.locator('.q-item', { hasText: 'Item 1' }).locator('.q-icon-btn.edit').click()
    await page.waitForFunction(() => document.querySelector('.q-pop') && getComputedStyle(document.querySelector('.q-pop')!).opacity === '1')
    await page.locator('.q-platfield').click()
    const panel = page.locator('.q-platpanel')
    await expect(panel).toHaveCount(1)
    await page.waitForFunction(() => document.querySelector('.q-platpanel') && getComputedStyle(document.querySelector('.q-platpanel')!).opacity === '1')
    await page.mouse.move(0, 0)
    const p = await box(page.locator('.q-pop'))
    const q = await box(panel)
    expect(await style(panel, ['border-top-width', 'border-top-color', 'padding-left', 'width']), 'the panel is a frame of its own kind').toMatchObject({ 'border-top-width': '2px', 'border-top-color': css(frameHi), 'padding-left': '16px', width: '400px' })
    const sideBySide = Math.abs(q.x - (p.x + p.width - 2)) <= 1 || Math.abs(q.x + q.width - (p.x + 2)) <= 1
    expect(sideBySide, 'the panel overlaps the popover’s border by 2px: one divider').toBe(true)
    expect(Math.abs(q.y - p.y), 'they start at the same top').toBeLessThanOrEqual(1)
  })

  test(`${skin}: a row's ✎ is lit while its Edit window is open, and plain again when it closes`, async ({ page }) => {
    await openGameList(page, skin)
    const [acc, accInk] = (await Promise.all(['--zx-acc', '--zx-acc-ink'].map((n) => token(page, n)))).map((hex) => rgbOf(hex)) as [Rgb, Rgb]
    const edit = page.locator('.q-item', { hasText: 'Item 1' }).locator('.q-icon-btn.edit')
    await page.mouse.move(0, 0)
    await expect(edit).not.toHaveAttribute('aria-expanded', 'true')
    await edit.click()
    await page.waitForFunction(() => document.querySelector('.q-pop') && getComputedStyle(document.querySelector('.q-pop')!).opacity === '1')
    await page.mouse.move(0, 0)
    await expect(edit).toHaveAttribute('aria-expanded', 'true')
    expect(await style(edit, ['background-color', 'color']), 'lit: the highlight').toEqual({ 'background-color': css(acc), color: css(accInk) })
    await page.keyboard.press('Escape')
    await expect(page.locator('.q-pop')).toHaveCount(0)
    await expect(edit).not.toHaveAttribute('aria-expanded', 'true')
  })
}
