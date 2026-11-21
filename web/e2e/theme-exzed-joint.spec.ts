import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng } from './pngPixels.js'

/**
 * eX-Zed's Jump To outside the window (57.3, design's D51 and D54; the List-2560 board and the JumpRail card), on the real screen at 2560px, in both engines and all six skins. **The rail has its own
 * double frame on top, left and bottom: a 4px `frame-hi` border (no right border), then the rings of 4px `paper`, `frame`, `paper`, clipped where the window's edge starts. It is 204px wide (its
 * 4px border and 200px inside), its top 4px above the list area and its bottom level with the window's bottom border; the window's own `frame-hi` border runs unbroken beside it. At the top
 * joint the window's `frame` ring turns out into the rail's (a 4px `frame` block above, a 4px `paper` block that keeps it out of the window's inner ring); at the bottom the two simply continue.**
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
type Rgb = [number, number, number]

const base = { description: null, externalRef: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const SUMMARY = { ...base, id: 'L1', title: 'Rail', mediaType: 'movie', source: 'manual', status: null, stats: { totalItems: 8, consumedItems: 2, newItems: 0, completionPercent: 25, timeRemainingMinutes: 400, lastConsumedAt: null } }
const item = (n: number, group: string) => ({
  id: `i${n}`,
  listId: 'L1',
  title: `Item ${n}`,
  orderIndex: n,
  timeToConsumeMinutes: 100 + n,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'manual',
  year: 2000 + n,
  yearUnk: 0,
  group,
  tags: null,
  notes: null,
  isNew: false,
})
const ITEMS = [item(1, 'Season 1'), item(2, 'Season 1'), item(3, 'Season 2'), item(4, 'Season 2'), item(5, 'Season 3'), item(6, 'Season 3')]

async function open(page: Page, skin: string) {
  await page.setViewportSize({ width: 2560, height: 1000 })
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
  await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'outside')
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
}

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgbOf = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const css = (c: Rgb) => `rgb(${c.join(', ')})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)
const rect = (locator: Locator) => locator.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } })

async function roles(page: Page) {
  const [paper, frame, hi] = await Promise.all(['--zx-paper', '--zx-frame', '--zx-frame-hi'].map((n) => token(page, n)))

  return { paper: rgbOf(paper!), frame: rgbOf(frame!), hi: rgbOf(hi!) }
}

/** The colour of the 4px cell whose top left is (x, y): one pixel from its middle, read from a screenshot of the cell. */
async function cell(page: Page, x: number, y: number): Promise<Rgb> {
  const pixels = decodePng(await page.screenshot({ clip: { x, y, width: 4, height: 4 } }))
  const scale = pixels.width / 4
  const i = (Math.floor(2 * scale) * pixels.width + Math.floor(2 * scale)) * 4

  return [pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!]
}

for (const skin of SKINS) {
  test.describe(`with the theme exzed, skin ${skin}`, () => {
    test('the rail is 204px with its 4px frame-hi border, its top 4px above the list and its bottom on the window’s bottom edge, with its own rings and no right border', async ({ page }) => {
      await open(page, skin)
      const r = await roles(page)
      const rail = page.locator('.q-rail')
      const layer = await rect(page.locator('.q-layer:not(.covered)'))
      const cols = await rect(page.locator('.q-list-cols'))
      const box = await rect(rail)

      // --q-bw is the border's width plus a thousandth of a device pixel (so the browser's rounding down cannot take a pixel off), so the edges agree to within that.
      expect(box.right, 'the rail ends where the window’s border box starts').toBeCloseTo(layer.left, 1)
      expect(box.width, '4px border and 200px inside').toBe(204)
      expect(box.top, '4px above the list area').toBeCloseTo(cols.top - 4, 1)
      expect(box.bottom, 'level with the window’s bottom border').toBeCloseTo(layer.bottom, 1)
      expect(await style(rail, ['border-top-width', 'border-left-width', 'border-bottom-width', 'border-right-width', 'border-top-color', 'border-left-color', 'border-bottom-color'])).toEqual({
        'border-top-width': '4px',
        'border-left-width': '4px',
        'border-bottom-width': '4px',
        'border-right-width': '0px',
        'border-top-color': css(r.hi),
        'border-left-color': css(r.hi),
        'border-bottom-color': css(r.hi),
      })
      expect((await style(rail, ['box-shadow']))['box-shadow']).toBe(`${css(r.paper)} 0px 0px 0px 4px, ${css(r.frame)} 0px 0px 0px 8px, ${css(r.paper)} 0px 0px 0px 12px`)
    })

    test('the top joint: the window’s frame ring turns out into the rail’s, the window’s own border runs on beside the rail, and the bottom continues', async ({ page }) => {
      await open(page, skin)
      const r = await roles(page)
      const layer = await rect(page.locator('.q-layer:not(.covered)'))
      const cols = await rect(page.locator('.q-list-cols'))
      const x = layer.left // the window's border box starts here; the rail's inside ends here
      const top = cols.top // the list area's top: the rail's top border is the 4px above it
      const bottom = layer.bottom
      const P = r.paper
      const F = r.frame
      const H = r.hi
      // Columns: the window's outer paper ring, its frame ring, its inner paper ring, its own border. Rows from above the rail's rings down to the rail's inside.
      const columns = [x - 12, x - 8, x - 4, x]
      const expected: [number, Rgb[]][] = [
        [top - 20, [P, F, P, H]], // above the rail: the window's rings and border
        [top - 16, [P, F, P, H]], // the rail's outer paper band; the 4px frame block keeps the window's frame ring going
        [top - 12, [F, F, P, H]], // the rail's frame band turns out of the ring; the paper block stops it at the window's inner ring
        [top - 8, [P, P, P, H]], // the rail's inner paper band
        [top - 4, [H, H, H, H]], // the rail's top border meets the window's
        [top + 4, [P, P, P, H]], // inside the rail, the window's border runs on
        [bottom - 4, [H, H, H, H]], // the rail's bottom border is level with the window's
        [bottom, [P, P, P, P]],
        [bottom + 4, [F, F, F, F]],
        [bottom + 8, [P, P, P, P]],
      ]
      for (const [y, colours] of expected) {
        for (let i = 0; i < 4; i++) expect(await cell(page, columns[i]!, y), `row ${y - top}, column ${columns[i]! - x}`).toEqual(colours[i])
      }
      // The window's border beside the rail, well down it.
      expect(await cell(page, x, top + 200), 'the window’s border runs unbroken beside the rail').toEqual(H)
    })

    test('folded, the rail keeps the same frame: 44px with its border, the same joint', async ({ page }) => {
      await open(page, skin)
      const r = await roles(page)
      await page.locator('.q-rail-head .q-rail-toggle').click()
      await expect(page.locator('.q-rail-fold')).toBeVisible()
      const layer = await rect(page.locator('.q-layer:not(.covered)'))
      const cols = await rect(page.locator('.q-list-cols'))
      const box = await rect(page.locator('.q-rail'))

      expect(box.width).toBe(44)
      expect([box.right, box.top, box.bottom].map((n) => Math.round(n))).toEqual([layer.left, cols.top - 4, layer.bottom].map((n) => Math.round(n)))
      expect(await cell(page, layer.left - 8, cols.top - 12), 'the frame band turns out of the ring').toEqual(r.frame)
      expect(await cell(page, layer.left - 4, cols.top - 12), 'and stops short of the inner ring').toEqual(r.paper)
    })
  })
}

// The Preview's rail hangs the same way (its container is `.q-preview-lower`, the box under the header).
test('the Preview’s rail has the same frame and the same joint', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1000 })
  const items = Array.from({ length: 12 }, (_, n) => ({ title: `Episode ${n}`, externalRef: `rail:${n}`, timeToConsumeMinutes: 30, group: `Volume ${Math.floor(n / 4)}` }))
  await page.route('**/api/media-types/music/search**', (route) => route.fulfill({ json: { sources: [{ externalRef: 'rail-1', title: 'Rail source', detail: 'Group · XX', itemCount: 12 }] } }))
  await page.route('**/api/media-types/music/expansion**', (route) => route.fulfill({ json: route.request().url().includes('items=true') ? { itemCount: 12, status: 'complete', items } : { itemCount: 12 } }))
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: 'exzed-1d' }))
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: 'Music' }).click()
  await page.getByLabel('Search MusicBrainz or List Vault', { exact: true }).fill('rail')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('.q-result').first().click()
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
  await page.locator('.q-preview-row').first().waitFor()
  await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'outside')
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
  const r = await roles(page)
  const layer = await rect(page.locator('.q-layer:not(.covered)'))
  const lower = await rect(page.locator('.q-preview-lower'))
  const box = await rect(page.locator('.q-rail'))
  expect(box.width).toBe(204)
  expect(box.right).toBeCloseTo(layer.left, 1)
  expect(box.top).toBeCloseTo(lower.top - 4, 1)
  expect(box.bottom).toBeCloseTo(layer.bottom, 1)
  const x = layer.left
  const top = lower.top
  expect(await cell(page, x - 8, top - 16), 'the window’s frame ring goes on').toEqual(r.frame)
  expect(await cell(page, x - 4, top - 12), 'and the rail’s band stops short of the inner ring').toEqual(r.paper)
  expect(await cell(page, x - 8, top - 12), 'it turns out into the rail’s').toEqual(r.frame)
  expect(await cell(page, x - 8, top - 4), 'the rail’s top border').toEqual(r.hi)
  expect(await cell(page, x, top + 100), 'the window’s border runs on beside it').toEqual(r.hi)
})
