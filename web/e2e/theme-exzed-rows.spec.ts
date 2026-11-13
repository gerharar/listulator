import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng, type Pixels } from './pngPixels.js'

/**
 * eX-Zed's list rows (51.7, X-007; design's Row card and the List board), on the real screen, in both engines and all six skins, read in pixels. **Every row is 32px and flat (an item has no
 * rule, a group has a 2px `frame` one under it); the drag handle, ⓘ, ✎ and the bin are the Icons board's drawings in `ink2`, the three buttons 32x32 and borderless; hover fills the whole row
 * with the highlight and turns everything in it `acc-ink`, and the button under the pointer becomes an `acc-ink` block with its icon in `acc`; keyboard focus shows the ▶ pointer at the row's
 * left; a lone ✎ sits where the ⓘ would; a group's name is plain `ink` (no bold) after a chevron that points right when it is shut and down when it is open.**
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
const ICONS = {
  handle: 'M2 0h1v1H2zM5 0h1v1H5zM2 2h1v1H2zM5 2h1v1H5zM2 4h1v1H2zM5 4h1v1H5zM2 6h1v1H2zM5 6h1v1H5z',
  info: 'M2 0h4v1H2zM1 1h1v1H1zM6 1h1v1H6zM0 2h1v4H0zM7 2h1v4H7zM1 6h1v1H1zM6 6h1v1H6zM2 7h4v1H2zM3 2h2v1H3zM3 4h2v2H3z',
  edit: 'M6 0h1v1H6zM5 1h1v1H5zM7 1h1v1H7zM4 2h1v1H4zM6 2h1v1H6zM3 3h1v1H3zM5 3h1v1H5zM2 4h1v1H2zM4 4h1v1H4zM1 5h1v1H1zM3 5h1v1H3zM0 6h1v2H0zM2 6h1v1H2zM1 7h1v1H1z',
  remove: 'M3 0h2v1H3zM0 1h8v1H0zM1 2h1v5H1zM6 2h1v5H6zM2 7h4v1H2zM3 3h1v3H3zM4 3h1v3H4z',
  pointer: 'M2 0h1v8H2zM3 1h1v6H3zM4 2h1v4H4zM5 3h1v2H5z',
  open: 'M1 2h1v1H1zM2 3h1v1H2zM3 4h2v1H3zM5 3h1v1H5zM6 2h1v1H6z',
  closed: 'M2 1h1v1H2zM3 2h1v1H3zM4 3h1v2H4zM3 5h1v1H3zM2 6h1v1H2z',
} as const
type IconName = keyof typeof ICONS
type Rgb = [number, number, number]

const cells = (path: string) => {
  const filled = new Set<string>()
  for (const [, x, y, w, h] of path.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)H\d+z/g)) {
    for (let dx = 0; dx < Number(w); dx++) for (let dy = 0; dy < Number(h); dy++) filled.add(`${Number(x) + dx},${Number(y) + dy}`)
  }

  return filled
}

const SUMMARY = {
  id: 'L1',
  title: 'Rows',
  description: null as string | null,
  mediaType: 'movie',
  source: 'manual',
  externalRef: null,
  status: null as string | null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  stats: { totalItems: 4, consumedItems: 1, newItems: 1, completionPercent: 25, timeRemainingMinutes: 400, lastConsumedAt: null },
}
const item = (n: number, extra: Record<string, unknown>) => ({
  id: `i${n}`,
  listId: 'L1',
  title: `Item ${n}`,
  orderIndex: n,
  timeToConsumeMinutes: 130 + n,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'manual',
  year: 2000 + n,
  yearUnk: 0,
  group: null,
  tags: null,
  notes: null,
  isNew: false,
  ...extra,
})
const ITEMS = [
  item(1, { group: 'Season 1', notes: 'A note' }),
  item(2, { group: 'Season 1', consumedAt: '2026-01-02T00:00:00Z' }),
  item(3, { group: 'Season 1' }),
  item(4, { isNew: true }),
]

async function open(page: Page, skin: string, extra: Record<string, string> = {}) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.route('**/api/lists', (route) => route.fulfill({ json: [SUMMARY] }))
  await page.route('**/api/lists/L1', (route) => route.fulfill({ json: { ...SUMMARY, items: ITEMS, groups: [] } }))
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
  await page.locator('.q-home-row').first().click()
  await page.locator('.q-item').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgbOf = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const css = (c: Rgb) => `rgb(${c.join(', ')})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)

async function roles(page: Page) {
  const names = ['paper', 'ink', 'ink2', 'frame', 'acc', 'acc-dim', 'acc-ink'] as const
  const found = await Promise.all(names.map((n) => token(page, `--zx-${n}`)))

  return Object.fromEntries(names.map((n, i) => [n, rgbOf(found[i]!)])) as Record<(typeof names)[number], Rgb>
}

function at(pixels: Pixels, scale: number, x: number, y: number): Rgb {
  const i = (Math.floor(y * scale + scale / 2) * pixels.width + Math.floor(x * scale + scale / 2)) * 4

  return [pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!]
}

/** An 8x8 icon drawn at 16px with its top left at (left, top) on the page: every filled cell must be `colour`. */
async function readIcon(page: Page, left: number, top: number, name: IconName, colour: Rgb, label: string) {
  // A box on a fractional position (a list below a header of fractional height) is painted on the nearest whole pixel.
  const clip = { x: Math.round(left), y: Math.round(top), width: 16, height: 16 }
  const pixels = decodePng(await page.screenshot({ clip }))
  const scale = pixels.width / 16
  for (const key of cells(ICONS[name])) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    expect(at(pixels, scale, x * 2 + 0.5, y * 2 + 0.5), `${label}: ${name} cell ${key}`).toEqual(colour)
  }
}

/** A rectangle given on the page, every pixel of it `colour` (a line of the board's, 2px wide or high). */
async function readRect(page: Page, x: number, y: number, width: number, height: number, colour: Rgb, label: string) {
  const clip = { x: Math.round(x), y: Math.round(y), width, height }
  const pixels = decodePng(await page.screenshot({ clip }))
  const scale = pixels.width / width
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) expect(at(pixels, scale, px, py), `${label}: pixel ${px},${py}`).toEqual(colour)
}

const row = (page: Page, title: string) => page.locator('.q-item', { hasText: title })
const box = async (locator: Locator) => (await locator.boundingBox())!

for (const skin of SKINS) {
  test(`${skin}: at rest the rows are flat 32px lines, the handle and the three row buttons are the board's pixel icons in ink2, the group has its 2px frame rule and a plain name after its chevron`, async ({ page }) => {
    await open(page, skin)
    const r = await roles(page)
    await page.mouse.move(0, 0)

    const noted = row(page, 'Item 1')
    const plain = row(page, 'Item 3')
    for (const target of [noted, plain, row(page, 'Item 4')]) {
      expect(await style(target, ['height', 'border-bottom-width']), 'an item row: 32px, no rule').toEqual({ height: '32px', 'border-bottom-width': '0px' })
    }
    const group = page.locator('.q-group').first()
    expect(await style(group, ['height', 'border-bottom-width', 'border-bottom-style', 'border-bottom-color']), 'the group head: 32px with a 2px frame rule').toEqual({
      height: '32px',
      'border-bottom-width': '2px',
      'border-bottom-style': 'solid',
      'border-bottom-color': css(r.frame),
    })

    // The text: the title in ink, the year and the runtime in ink2, all 16px regular.
    expect(await style(noted.locator('.title'), ['color', 'font-size', 'font-weight'])).toEqual({ color: css(r.ink), 'font-size': '16px', 'font-weight': '400' })
    expect(await style(noted.locator('.q-year'), ['color', 'font-size'])).toEqual({ color: css(r.ink2), 'font-size': '16px' })
    expect(await style(noted.locator('.q-mins'), ['color', 'font-size', 'font-weight'])).toEqual({ color: css(r.ink2), 'font-size': '16px', 'font-weight': '400' })
    expect(await style(group.locator('b'), ['color', 'font-size', 'font-weight'])).toEqual({ color: css(r.ink), 'font-size': '16px', 'font-weight': '400' })

    // The drag handle: its 16px drawing centred in 24px. The three buttons: 32x32, no border, the drawing centred.
    const handle = await box(noted.locator('.q-handle'))
    await readIcon(page, handle.x + 4, handle.y + handle.height / 2 - 8, 'handle', r.ink2, 'the drag handle')
    for (const [name, selector] of [['info', '.q-icon-btn.info'], ['edit', '.q-icon-btn.edit'], ['remove', '.q-icon-btn.remove']] as const) {
      const button = noted.locator(selector)
      expect(await style(button, ['width', 'height', 'border-top-width']), `the ${name} button: 32x32, borderless`).toEqual({ width: '32px', height: '32px', 'border-top-width': '0px' })
      const b = await box(button)
      await readIcon(page, b.x + 8, b.y + 8, name, r.ink2, `the ${name} button`)
    }

    // The group head: the chevron is open (down) while the group is open, in the row's ink, in the pointer's column to the right of the handle.
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    const gh = await box(group.locator('.q-handle'))
    const chevron = group.locator('.q-chev')
    await expect(chevron).toHaveCount(1)
    const cb = await box(chevron)
    expect([cb.width, cb.height], 'the chevron is 16px').toEqual([16, 16])
    expect(cb.x, 'after the handle').toBeGreaterThanOrEqual(gh.x + gh.width)
    await readIcon(page, cb.x, cb.y, 'open', r.ink, 'the open group’s chevron')
    await group.click()
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await page.mouse.move(0, 0)
    await readIcon(page, cb.x, cb.y, 'closed', r.ink, 'the shut group’s chevron')
  })

  test(`${skin}: hover fills the whole row with the highlight and turns everything in it acc-ink; the button under the pointer is an acc-ink block with its icon in acc`, async ({ page }) => {
    await open(page, skin)
    const r = await roles(page)
    const target = row(page, 'Item 3')
    await target.hover({ position: { x: 600, y: 16 } })
    await expect.poll(async () => (await style(target, ['background-color']))['background-color']).toBe(css(r.acc))
    for (const selector of ['.title', '.q-year', '.q-mins']) expect((await style(target.locator(selector), ['color'])).color, `${selector} is acc-ink`).toBe(css(r['acc-ink']))

    const handle = await box(target.locator('.q-handle'))
    await readIcon(page, handle.x + 4, handle.y + handle.height / 2 - 8, 'handle', r['acc-ink'], 'the handle on a lit row')
    const edit = await box(target.locator('.q-icon-btn.edit'))
    await readIcon(page, edit.x + 8, edit.y + 8, 'edit', r['acc-ink'], 'the ✎ on a lit row')

    // The button itself: the pointer on it makes it a block of acc-ink with the icon in acc.
    await target.locator('.q-icon-btn.edit').hover()
    expect((await style(target.locator('.q-icon-btn.edit'), ['background-color']))['background-color'], 'the lit button is an acc-ink block').toBe(css(r['acc-ink']))
    await readIcon(page, edit.x + 8, edit.y + 8, 'edit', r.acc, 'the ✎ under the pointer')
    const bin = await box(target.locator('.q-icon-btn.remove'))
    await readIcon(page, bin.x + 8, bin.y + 8, 'remove', r['acc-ink'], 'the bin beside it stays on the row’s ink')

    // The group head takes the same highlight.
    const group = page.locator('.q-group').first()
    await group.hover({ position: { x: 600, y: 16 } })
    await expect.poll(async () => (await style(group, ['background-color']))['background-color']).toBe(css(r.acc))
  })

  test(`${skin}: keyboard focus shows the ▶ pointer at the row's left, and a lone ✎ sits where the ⓘ would`, async ({ page }) => {
    await open(page, skin)
    const r = await roles(page)
    const target = row(page, 'Item 4')
    await page.mouse.move(0, 0)
    await page.keyboard.press('Tab')
    await target.focus()
    await expect(target).toBeFocused()
    const b = await box(target)
    await readIcon(page, b.x + 8, b.y + 8, 'pointer', r.ink, 'the focus pointer')

    // Not focused, no pointer: the row's own colour is all that is in its place.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.mouse.move(0, 0)
    const clip = { x: Math.round(b.x + 8), y: Math.round(b.y + 8), width: 16, height: 16 }
    const pixels = decodePng(await page.screenshot({ clip }))
    const scale = pixels.width / 16
    const seen = new Set<string>()
    for (const key of cells(ICONS.pointer)) {
      const [x, y] = key.split(',').map(Number) as [number, number]
      seen.add(at(pixels, scale, x * 2 + 0.5, y * 2 + 0.5).join(','))
    }
    expect([...seen], 'no pointer when the row is not focused').toHaveLength(1)
    expect(seen.has(r.ink.join(',')), 'and none in ink').toBe(false)

    // The lone ✎: the same distance from the title's start as the ⓘ of a row whose title is as long (Item 1 has a note, Item 3 has none).
    const noted = await box(row(page, 'Item 1').locator('.q-icon-btn.info'))
    const lone = await box(row(page, 'Item 3').locator('.q-icon-btn.edit'))
    expect(Math.abs(noted.x - lone.x), 'the lone ✎ is in the ⓘ’s place').toBeLessThanOrEqual(1)
  })

  test(`${skin}: "Enhance group arrows" draws its line as the board says: 2px, 16px long, 6px from the chevron, ink2, left of it when open and under it when shut, with no animation (design D24)`, async ({ page }) => {
    await open(page, skin, { markOpenGroups: 'true' })
    const r = await roles(page)
    const group = page.locator('.q-group').first()
    const chevron = group.locator('.q-chev')
    await page.mouse.move(0, 0)
    const rule = group.locator('.q-chev-rule')
    await expect(rule).toHaveCount(1)
    expect((await style(rule, ['transition-duration']))['transition-duration'], 'no animation').toBe('0s')

    // Open (the chevron points down): a vertical line, its right edge 6px left of the ink, which starts 2px in from the 16px box.
    const openBox = await box(chevron)
    await readRect(page, openBox.x - 6, openBox.y, 2, 16, r.ink2, 'the open group’s line')
    // Shut (it points right): a horizontal line under the ink, 6px below its last row (14px down the box).
    await group.click()
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await page.mouse.move(0, 0)
    const shutBox = await box(chevron)
    await readRect(page, shutBox.x, shutBox.y + 20, 16, 2, r.ink2, 'the shut group’s line')
  })

  test(`${skin}: a group head being dropped onto fills with acc-dim and its text and icons are acc-ink; never the bright highlight of a hover (design D23)`, async ({ page }) => {
    await open(page, skin)
    const r = await roles(page)
    await page.mouse.move(0, 0)
    const group = page.locator('.q-group').first()
    // The class Quantum's drop target has (H-016), put on the head as the list does while an item is carried over it.
    await group.evaluate((element) => element.classList.add('is-target'))
    expect((await style(group, ['background-color', 'color']))).toEqual({ 'background-color': css(r['acc-dim']), color: css(r['acc-ink']) })
    for (const selector of ['b', '.q-year', '.q-left']) expect((await style(group.locator(selector).first(), ['color'])).color, `${selector} is acc-ink`).toBe(css(r['acc-ink']))
    const handle = await box(group.locator('.q-handle'))
    await readIcon(page, handle.x + 4, handle.y + handle.height / 2 - 8, 'handle', r['acc-ink'], 'the handle on a drop target')
    const cb = await box(group.locator('.q-chev'))
    await readIcon(page, cb.x, cb.y, 'open', r['acc-ink'], 'the chevron on a drop target')
    const edit = await box(group.locator('.q-icon-btn.edit'))
    await readIcon(page, edit.x + 8, edit.y + 8, 'edit', r['acc-ink'], 'the rename ✎ on a drop target')
  })
}
