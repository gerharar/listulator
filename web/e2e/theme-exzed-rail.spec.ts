import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng, type Pixels } from './pngPixels.js'

/**
 * eX-Zed's jump rail rows (51.8, X-007; design's Row card and the List board), on the real screen, in both engines and all six skins. **The rail is ruled by 2px of `frame` on its right; its head is
 * `lab` capitals over a 32px borderless collapse button drawn as the board's pixel icon; an entry is a 32px row (8px sides, 8px between its parts) in 16px `ink`, a done group's tick the `done`
 * pixel icon in `ink2` (never the ✓ glyph the font lacks), its count `ink2`; hover fills it with the highlight and turns it `acc-ink`; keyboard focus shows the ▶ pointer.**
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
type Rgb = [number, number, number]
const DONE = 'M7 1h1v1H7zM6 2h1v1H6zM5 3h1v1H5zM4 4h1v1H4zM0 4h1v1H0zM1 5h1v1H1zM3 5h1v1H3zM2 6h1v1H2z'
const COLLAPSE = 'M3 1h1v1H3zM2 2h1v1H2zM1 3h1v2H1zM2 5h1v1H2zM3 6h1v1H3zM6 1h1v1H6zM5 2h1v1H5zM4 3h1v2H4zM5 5h1v1H5zM6 6h1v1H6z'
const POINTER = 'M2 0h1v8H2zM3 1h1v6H3zM4 2h1v4H4zM5 3h1v2H5z'

const base = { description: null, externalRef: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const SUMMARY = { ...base, id: 'L1', title: 'Rail', mediaType: 'movie', source: 'manual', status: null, stats: { totalItems: 8, consumedItems: 2, newItems: 0, completionPercent: 25, timeRemainingMinutes: 400, lastConsumedAt: null } }
const item = (n: number, group: string, done: boolean) => ({
  id: `i${n}`,
  listId: 'L1',
  title: `Item ${n}`,
  orderIndex: n,
  timeToConsumeMinutes: 100 + n,
  timeToConsumeIsEstimated: false,
  consumedAt: done ? '2026-01-02T00:00:00Z' : null,
  source: 'manual',
  year: 2000 + n,
  yearUnk: 0,
  group,
  tags: null,
  notes: null,
  isNew: false,
})
const ITEMS = [item(1, 'Season 1', true), item(2, 'Season 1', true), item(3, 'Season 2', false), item(4, 'Season 2', false), item(5, 'Season 3', false), item(6, 'Season 3', false), item(7, 'Season 4', false), item(8, 'Season 4', false)]

async function open(page: Page, skin: string) {
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
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin }))
  await page.goto('/')
  await page.locator('.q-home-row').first().click()
  await page.locator('.q-rail-entry').first().waitFor()
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
async function readIcon(page: Page, left: number, top: number, path: string, colour: Rgb, label: string) {
  const pixels = decodePng(await page.screenshot({ clip: { x: Math.round(left), y: Math.round(top), width: 16, height: 16 } }))
  const scale = pixels.width / 16
  for (const key of cells(path)) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    expect(at(pixels, scale, x * 2 + 0.5, y * 2 + 0.5), `${label}: cell ${key}`).toEqual(colour)
  }
}
const box = async (locator: Locator) => (await locator.boundingBox())!

for (const skin of SKINS) {
  test(`${skin}: the rail's head, entries, done tick and collapse button are the board's; hover is the highlight; keyboard focus shows the pointer`, async ({ page }) => {
    await open(page, skin)
    const [ink, ink2, lab, frame, acc, accInk] = (await Promise.all(['--zx-ink', '--zx-ink2', '--zx-lab', '--zx-frame', '--zx-acc', '--zx-acc-ink'].map((n) => token(page, n)))).map((hex) => rgbOf(hex)) as Rgb[]
    await page.mouse.move(0, 0)

    const rail = page.locator('.q-rail').first()
    expect(await style(rail, ['border-right-width', 'border-right-style', 'border-right-color'])).toEqual({ 'border-right-width': '2px', 'border-right-style': 'solid', 'border-right-color': css(frame!) })
    expect(await style(rail.locator('.q-rail-head .q-kicker'), ['color', 'font-size', 'text-transform'])).toEqual({ color: css(lab!), 'font-size': '16px', 'text-transform': 'uppercase' })

    // The collapse button: 32x32, borderless, the board's drawing in ink2.
    const toggle = rail.locator('.q-rail-head .q-rail-toggle')
    expect(await style(toggle, ['width', 'height', 'border-top-width'])).toEqual({ width: '32px', height: '32px', 'border-top-width': '0px' })
    const tb = await box(toggle)
    await readIcon(page, tb.x + 8, tb.y + 8, COLLAPSE, ink2!, 'the collapse button')

    // An entry: 32px, 16px ink on a plain row; its count ink2.
    const done = page.locator('.q-rail-entry', { hasText: 'Season 1' })
    const open1 = page.locator('.q-rail-entry', { hasText: 'Season 2' })
    expect(await style(open1, ['height', 'padding-left', 'padding-right', 'column-gap', 'font-size', 'font-weight', 'color'])).toEqual({
      height: '32px',
      'padding-left': '32px',
      'padding-right': '8px',
      'column-gap': '8px',
      'font-size': '16px',
      'font-weight': '400',
      color: css(ink!),
    })
    expect(await style(open1.locator('.count'), ['color', 'font-size'])).toEqual({ color: css(ink2!), 'font-size': '16px' })
    expect((await style(done, ['color'])).color, 'a done group is not dimmed: the tick says it').toBe(css(ink!))

    // The done tick: the board's icon in ink2, 16px; nothing in an open group's.
    const tick = await box(done.locator('.tick'))
    expect([tick.width, tick.height]).toEqual([16, 16])
    await readIcon(page, tick.x, tick.y, DONE, ink2!, 'the done group’s tick')
    expect((await style(done.locator('.tick'), ['font-size']))['font-size'], 'the ✓ glyph (kept in the DOM) is not drawn').toBe('0px')

    // Hover: the highlight and acc-ink.
    await open1.hover({ position: { x: 100, y: 16 } })
    expect(await style(open1, ['background-color', 'color'])).toEqual({ 'background-color': css(acc!), color: css(accInk!) })
    expect((await style(open1.locator('.count'), ['color'])).color).toBe(css(accInk!))
    await page.mouse.move(0, 0)

    // Keyboard focus: the pointer at the row's left.
    await page.keyboard.press('Tab')
    await open1.focus()
    await expect(open1).toBeFocused()
    const eb = await box(open1)
    await readIcon(page, eb.x + 8, eb.y + 8, POINTER, ink!, 'the focus pointer')
  })
}
