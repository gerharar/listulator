import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng } from './pngPixels.js'

/**
 * eX-Zed's glyph stems (51.12, X-007, design's X-004: "every glyph stem a whole number of device pixels at 100% and 200%"), read in pixels on the real screens in both engines and all six skins. The font is an 8px
 * grid, so at 16px a font pixel is 2px, at 24px 3px and at 32px 4px: **a line of text has no pixel of any colour but the text's own and the ground's (no anti-aliased half pixel), and every run of text colour
 * along a row is a whole number of font pixels long**, at one device pixel to a CSS pixel and at two.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
type Rgb = [number, number, number]

const base = { description: null, externalRef: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const LIST = { ...base, id: 'A', title: 'Stem Saga', mediaType: 'movie', source: 'api', status: null, stats: { totalItems: 4, consumedItems: 1, newItems: 0, completionPercent: 25, timeRemainingMinutes: 200, lastConsumedAt: null } }
const ITEMS = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((title, n) => ({ id: `i${n}`, listId: 'A', title, orderIndex: n, timeToConsumeMinutes: 50, timeToConsumeIsEstimated: false, consumedAt: null, source: 'import', year: 2000 + n, yearUnk: 0, group: null, tags: null, notes: null }))

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgbOf = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

async function open(page: Page, skin: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.route('**/api/lists', (route) => route.fulfill({ json: [LIST] }))
  await page.route('**/api/lists/A', (route) => route.fulfill({ json: { ...LIST, items: ITEMS, groups: [] } }))
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
  await page.mouse.move(0, 0)
}

/** The box of a locator's own text, in page coordinates (not its padding or its other children). */
const textBox = (locator: Locator) =>
  locator.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const r = range.getBoundingClientRect()

    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })

/** Every pixel colour in the text's box, and the length of every run of non-ground pixels along each row, both in device pixels. */
async function read(page: Page, locator: Locator) {
  const b = await textBox(locator)
  // The line box less 2px above and below: the glyphs are inside it, and a rule or a neighbour that touches the box is not.
  const x = Math.floor(b.x)
  const y = Math.floor(b.y) + 2
  const width = Math.min(Math.ceil(b.width), 400)
  const height = Math.floor(b.height) - 4
  const png = decodePng(await page.screenshot({ clip: { x, y, width, height } }))
  const colours = new Map<string, number>()
  for (let i = 0; i < png.data.length; i += 4) {
    const key = `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`
    colours.set(key, (colours.get(key) ?? 0) + 1)
  }

  return { png, colours, scale: png.width / width }
}

function runs(png: { width: number; height: number; data: Uint8Array | number[] }, ground: string): number[] {
  const lengths: number[] = []
  for (let row = 0; row < png.height; row++) {
    let run = 0
    for (let col = 0; col <= png.width; col++) {
      const i = (row * png.width + col) * 4
      const isText = col < png.width && `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}` !== ground
      if (isText) run++
      else if (run > 0) {
        lengths.push(run)
        run = 0
      }
    }
  }

  return lengths
}

for (const dsf of [1, 2]) {
  test.describe(`at ${dsf * 100}%`, () => {
    test.use({ deviceScaleFactor: dsf })

    for (const skin of SKINS) {
      test(`${skin}: a 16px row title and a 16px kicker have no half pixel and every stem a whole number of 2px font pixels`, async ({ page }) => {
        await open(page, skin)
        const ink = (await token(page, '--zx-ink')).slice(1)
        const title = page.locator('.q-home-row .title').first()
        const { colours, png, scale } = await read(page, title)
        const unit = 2 * scale
        // Two colours: the ground and the ink. A third is a blended edge.
        expect([...colours.keys()].length, `colours in the title's box: ${[...colours.keys()].join(' | ')}`).toBeLessThanOrEqual(2)
        const ground = [...colours.entries()].sort((a, b) => b[1] - a[1])[0]![0]
        expect([...colours.keys()].some((key) => key === rgbOf(`#${ink}`).join(',')), 'the ink is there').toBe(true)
        for (const length of runs(png, ground)) expect(length % unit, `a run of ${length} device px along a row (the unit is ${unit})`).toBe(0)

        const kicker = page.locator('.q-help-row .q-kicker').first()
        const k = await read(page, kicker)
        expect([...k.colours.keys()].length, `colours in the kicker's box: ${[...k.colours.keys()].join(' | ')}`).toBeLessThanOrEqual(2)
        const kg = [...k.colours.entries()].sort((a, b) => b[1] - a[1])[0]![0]
        for (const length of runs(k.png, kg)) expect(length % (2 * k.scale), `a kicker run of ${length}`).toBe(0)
      })

      test(`${skin}: a 24px list name and a 32px screen title: three or four colours at most and every stem a whole number of font pixels`, async ({ page }) => {
        await open(page, skin)
        const title = page.getByRole('heading', { name: 'My Lists' })
        const t = await read(page, title)
        // The ground and the title's three bands: nothing between them.
        expect([...t.colours.keys()].length, `colours in the screen title's box: ${[...t.colours.keys()].join(' | ')}`).toBeLessThanOrEqual(4)
        const tg = [...t.colours.entries()].sort((a, b) => b[1] - a[1])[0]![0]
        for (const length of runs(t.png, tg)) expect(length % (4 * t.scale), `a title run of ${length} (the unit is ${4 * t.scale})`).toBe(0)

        await page.locator('.q-home-row').first().click()
        const name = page.locator('.q-list-title')
        await name.waitFor()
        await page.evaluate(() => document.fonts.ready)
        await page.mouse.move(0, 0)
        const n = await read(page, name)
        expect([...n.colours.keys()].length, `colours in the list name's box: ${[...n.colours.keys()].join(' | ')}`).toBeLessThanOrEqual(2)
        const ng = [...n.colours.entries()].sort((a, b) => b[1] - a[1])[0]![0]
        for (const length of runs(n.png, ng)) expect(length % (3 * n.scale), `a list-name run of ${length} (the unit is ${3 * n.scale})`).toBe(0)
      })
    }
  })
}
