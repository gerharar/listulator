import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng, type Pixels } from './pngPixels.js'

/**
 * eX-Zed's My Lists (51.8, X-007; design's Row card and the Home board), on the real screen, in both engines and all six skins, read in pixels. **A category head is its name in `lab`
 * capitals followed by a 4px dither rule (the board's: a 2px checkerboard of `frame` over `paper`) to the end of the line; a list's row is 32px and flat, its text 16px; hover fills the row with
 * the highlight and turns its text `acc-ink` (the marks and the NEW tag keep their own black cells); keyboard focus shows the ▶ pointer at the row's left.** The bar and the percentage's drawing
 * are X-008's; their text is 16px.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
type Rgb = [number, number, number]
const POINTER = 'M2 0h1v8H2zM3 1h1v6H3zM4 2h1v4H4zM5 3h1v2H5z'

const base = { description: null, externalRef: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const list = (id: string, title: string, mediaType: string, source: string, status: string | null, newItems: number, done: number, total: number) => ({
  ...base,
  id,
  title,
  mediaType,
  source,
  status,
  stats: { totalItems: total, consumedItems: done, newItems, completionPercent: Math.round((done / total) * 100), timeRemainingMinutes: 600, lastConsumedAt: null },
})
const LISTS = [
  list('A', 'Star Wars: Main Saga', 'movie', 'canonical', 'complete', 0, 4, 9),
  list('B', 'My own picks', 'movie', 'manual', 'ongoing', 3, 0, 5),
  list('C', 'Zelda', 'game', 'canonical', null, 0, 10, 10),
]

async function open(page: Page, skin: string, extra: Record<string, string> = {}) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.route('**/api/lists', (route) => route.fulfill({ json: LISTS }))
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
const rgbOf = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const css = (c: Rgb) => `rgb(${c.join(', ')})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)
const box = async (locator: Locator) => (await locator.boundingBox())!

async function roles(page: Page) {
  const names = ['paper', 'ink', 'ink2', 'lab', 'frame', 'acc', 'acc-ink', 'chip-ink'] as const
  const found = await Promise.all(names.map((n) => token(page, `--zx-${n}`)))

  return Object.fromEntries(names.map((n, i) => [n, rgbOf(found[i]!)])) as Record<(typeof names)[number], Rgb>
}

function at(pixels: Pixels, scale: number, x: number, y: number): Rgb {
  const i = (Math.floor(y * scale + scale / 2) * pixels.width + Math.floor(x * scale + scale / 2)) * 4

  return [pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!]
}
const cells = (path: string) => {
  const filled = new Set<string>()
  for (const [, x, y, w, h] of path.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)H\d+z/g)) {
    for (let dx = 0; dx < Number(w); dx++) for (let dy = 0; dy < Number(h); dy++) filled.add(`${Number(x) + dx},${Number(y) + dy}`)
  }

  return filled
}

/** A colour within 2 levels per channel: WebKit's conic gradient is off by a level or two inside a cell, and the two colours of a dither are far apart in every skin. */
const near = (seen: Rgb, want: Rgb, label: string) => expect(seen.map((n, i) => Math.abs(n - want[i]!)).every((d) => d <= 2), `${label}: ${seen} is not ${want}`).toBe(true)

for (const skin of SKINS) {
  test(`${skin}: a category head is its name in lab capitals and a 4px dither rule of frame over paper to the end of the line`, async ({ page }) => {
    await open(page, skin)
    const r = await roles(page)
    await page.mouse.move(0, 0)
    const head = page.locator('.q-kicker-bar').first()
    const name = head.locator('.q-kicker.strong')
    expect(await style(name, ['color', 'text-transform', 'font-size'])).toEqual({ color: css(r.lab), 'text-transform': 'uppercase', 'font-size': '16px' })
    expect((await style(head, ['border-bottom-width']))['border-bottom-width'], 'the old 2px rule under the head is gone').toBe('0px')

    const h = await box(head)
    const n = await box(name)
    // The rule starts 16px after the name and is vertically centred on its line; read the first 4x4 tile: paper, frame / frame, paper (the conic checkerboard from the box's own corner).
    const left = Math.round(n.x + n.width + 16)
    const top = Math.round(n.y + n.height / 2 - 2)
    const pixels = decodePng(await page.screenshot({ clip: { x: left, y: top - 4, width: 8, height: 12 } }))
    const scale = pixels.width / 8
    // The middle of each 2px cell: the engines blend the conic gradient's hard edge by a level on the pixel at the cell's edge.
    const tile = (x: number, y: number) => at(pixels, scale, x + 0.5, y + 4 + 0.5)
    near(tile(0, 0), r.paper, 'top left of the first tile')
    near(tile(2, 0), r.frame, 'top right')
    near(tile(0, 2), r.frame, 'bottom left')
    near(tile(2, 2), r.paper, 'bottom right')
    near(tile(4, 0), r.paper, 'the next tile repeats')
    near(tile(6, 0), r.frame, 'the pattern')
    // 4px high: nothing above or below it.
    near(at(pixels, scale, 2, 2), r.paper, 'above the rule')
    near(at(pixels, scale, 2, 9), r.paper, 'below the rule')
    // To the end of the line: the last pixels before the head's right edge are the pattern too.
    const end = decodePng(await page.screenshot({ clip: { x: Math.round(h.x + h.width) - 4, y: top, width: 4, height: 4 } }))
    const es = end.width / 4
    expect(new Set([at(end, es, 0, 0).join(), at(end, es, 2, 0).join()]).size, 'the rule reaches the head’s end').toBe(2)
  })

  test(`${skin}: a list's row is 32px and flat, its text 16px; hover fills it with the highlight and turns its text acc-ink while the marks keep their cells; focus shows the ▶ pointer`, async ({ page }) => {
    await open(page, skin)
    const r = await roles(page)
    await page.mouse.move(0, 0)
    const row = page.locator('.q-home-row', { hasText: 'Star Wars' })
    expect(await style(row, ['height', 'border-bottom-width']), 'a row: 32px, no rule').toEqual({ height: '32px', 'border-bottom-width': '0px' })
    expect(await style(row.locator('.title'), ['color', 'font-size', 'font-weight'])).toEqual({ color: css(r.ink), 'font-size': '16px', 'font-weight': '400' })
    expect(await style(row.locator('.q-home-count'), ['color', 'font-size', 'font-weight'])).toEqual({ color: css(r.ink2), 'font-size': '16px', 'font-weight': '400' })
    expect((await style(row.locator('.q-pct'), ['font-size']))['font-size'], 'the percentage').toBe('16px')

    // Hover: the highlight, the text acc-ink; the star's black cell and the NEW tag's fill are theirs.
    await row.hover({ position: { x: 400, y: 16 } })
    await expect.poll(async () => (await style(row, ['background-color']))['background-color']).toBe(css(r.acc))
    expect((await style(row.locator('.title'), ['color'])).color).toBe(css(r['acc-ink']))
    expect((await style(row.locator('.q-home-count'), ['color'])).color).toBe(css(r['acc-ink']))
    expect((await style(row.locator('.q-star'), ['background-color']))['background-color'], 'the star keeps its black cell').toBe(css(r['chip-ink']))
    await page.mouse.move(0, 0)

    // Focus: the pointer at the row's left, in the row's ink, only on keyboard focus.
    await page.keyboard.press('Tab')
    await row.focus()
    await expect(row).toBeFocused()
    const b = await box(row)
    const clip = { x: Math.round(b.x + 8), y: Math.round(b.y + 8), width: 16, height: 16 }
    const pixels = decodePng(await page.screenshot({ clip }))
    const scale = pixels.width / 16
    for (const key of cells(POINTER)) {
      const [x, y] = key.split(',').map(Number) as [number, number]
      expect(at(pixels, scale, x * 2 + 0.5, y * 2 + 0.5), `the pointer: cell ${key}`).toEqual(r.ink)
    }
  })

  test(`${skin}: the time left (Settings → Show time left) is 16px, and "All Done" is the done icon and the words`, async ({ page }) => {
    await open(page, skin, { showTimeLeft: 'true' })
    const r = await roles(page)
    await page.mouse.move(0, 0)
    const done = page.locator('.q-home-row', { hasText: 'Zelda' }).locator('.q-left')
    await expect(done).toHaveCount(1)
    expect(await style(done, ['font-size', 'color'])).toEqual({ 'font-size': '16px', color: css(r.ink2) })
    expect(await done.evaluate((el) => (el as HTMLElement).innerText)).toBe('ALL DONE')
    await expect(done.locator('.q-done-icon')).toHaveCount(1)
    const other = page.locator('.q-home-row', { hasText: 'Star Wars' }).locator('.q-left')
    expect((await style(other, ['font-size']))['font-size']).toBe('16px')
  })
}
