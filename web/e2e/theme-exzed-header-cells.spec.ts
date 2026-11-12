import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng } from './pngPixels.js'

/**
 * The paper cells over the list header's banner (50.15, X-006; design's answer 10 of 2026-11-12), in both engines. The banner stays where it is, and everything drawn over it
 * gets its own cell of `paper`, the Spectrum's attribute rule: the three header buttons on a solid 40x40 ground, and the kicker, the title (marks and chip with it), the subline
 * and the progress line's parts a `paper` background behind their own text runs, a wrapped run's every line (`box-decoration-break: clone`), so the banner shows only around and
 * between them. Quantum draws none of it. Read in pixels: with the words made invisible, every pixel of a cell is the paper even where the banner is under it, and with the
 * paper taken away the same pixels show the banner (the control: a test that saw no banner there would prove nothing).
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

const SUMMARY = {
  id: 'L1',
  title: 'A title long enough to wrap onto a second line in a narrow header, because it keeps going on past the banner',
  description: 'A subline that is long enough to wrap onto a second line when the column is only so wide, and then a little more so that the second line is shorter than the first.' as string | null,
  mediaType: 'movie',
  source: 'manual',
  externalRef: null,
  status: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  stats: { totalItems: 1, consumedItems: 0, newItems: 0, completionPercent: 0, timeRemainingMinutes: 90, lastConsumedAt: null },
}
const ITEM = {
  id: 'i1',
  listId: 'L1',
  title: 'First',
  orderIndex: 0,
  timeToConsumeMinutes: 90,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'manual',
  year: null,
  yearUnk: 0,
  group: null,
  tags: null,
  notes: null,
  isNew: false,
}

// A short header (a one-line title, no subline) is only as tall as the banner, so the banner reaches the buttons at its top; the long one wraps and the banner is under the words.
const SHORT = { title: 'Short', description: null }

async function openList(page: Page, { skin = 'exzed-1d', theme = 'exzed', width = 1180, height = 900, list = {} as Partial<typeof SUMMARY> } = {}) {
  const summary = { ...SUMMARY, ...list }
  await page.setViewportSize({ width, height })
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.route('**/api/lists', (route) => route.fulfill({ json: [summary] }))
  await page.route('**/api/lists/L1', (route) => route.fulfill({ json: { ...summary, items: [ITEM], groups: [] } }))
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme, exzedSkin: skin }))
  await page.goto('/')
  await page.locator('.q-home-row').first().click()
  await page.locator('.q-list-head').waitFor()
  await page.evaluate(() => document.fonts.ready)
}

type Rect = { left: number; top: number; right: number; bottom: number }
const paperOf = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zx-paper').trim())
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

/** Every line box of an element's own text (a Range over its contents), one rect per line of a wrapped run. */
const lineRects = (locator: Locator) =>
  locator.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)

    return [...range.getClientRects()].filter((box) => box.width > 0).map((box) => ({ left: box.left, top: box.top, right: box.right, bottom: box.bottom }))
  })

/** Pixels in the rect (a pixel in from each edge: an engine snaps a fractional edge) that are not the paper. */
async function notPaper(page: Page, rect: Rect, paper: [number, number, number]) {
  const r = await page.evaluate(() => window.devicePixelRatio)
  const x0 = Math.ceil(rect.left) + 1
  const y0 = Math.ceil(rect.top) + 1
  const clip = { x: x0, y: y0, width: Math.floor(rect.right) - 1 - x0, height: Math.floor(rect.bottom) - 1 - y0 }
  if (clip.width <= 0 || clip.height <= 0) return 0
  const seen = decodePng(await page.screenshot({ clip }))
  expect(seen.width, 'the screenshot is the clip at the device ratio').toBe(clip.width * r)
  let different = 0
  for (let i = 0; i < seen.width * seen.height; i++) {
    if (seen.data[i * 4] !== paper[0] || seen.data[i * 4 + 1] !== paper[1] || seen.data[i * 4 + 2] !== paper[2]) different++
  }

  return different
}

const WORDS_GONE = '.q-list-head .q-kicker, .q-list-head .q-list-title, .q-list-head .q-list-description, .q-list-head .q-progress, .q-list-head .q-progress * , .q-list-head .q-icon-btn { color: transparent !important } .q-list-head svg { visibility: hidden !important }'
const NO_CELLS = '.q-list-head [class*="q-run"], .q-list-head .q-kicker, .q-list-head .q-progress > *, .q-list-head .q-icon-btn { background: transparent !important; outline: none !important }'

test.describe('the header’s paper cells', () => {
  for (const skin of SKINS) {
    test(`${skin}: each header button rests on a solid 40x40 paper cell over the banner (the control shows the banner without it)`, async ({ page }) => {
      await openList(page, { skin, list: SHORT })
      await page.addStyleTag({ content: WORDS_GONE })
      const paper = rgb(await paperOf(page))
      const buttons = page.locator('.q-list-actions .q-icon-btn')
      const count = await buttons.count()
      expect(count).toBeGreaterThanOrEqual(2)
      let overBanner = 0

      const interior = async (i: number): Promise<Rect> => {
        const box = await buttons.nth(i).evaluate((element) => element.getBoundingClientRect().toJSON() as { left: number; top: number; right: number; bottom: number })

        // Inside the control's own 1px border (it is part of the control, drawn by X-007 later), so the cell is read where the control has no ink of its own.
        return { left: box.left + 1, top: box.top + 1, right: box.right - 1, bottom: box.bottom - 1 }
      }

      for (let i = 0; i < count; i++) {
        const button = buttons.nth(i)
        expect(await notPaper(page, await interior(i), paper), `button ${i}: pixels inside the control that are not the paper`).toBe(0)
        // The cell is the control: 40 wide and 40 high (Quantum's is 36 wide), solid paper.
        const shape = await button.evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))
        expect([shape.width, shape.height], `button ${i}: the cell is 40x40`).toEqual([40, 40])
      }

      await page.addStyleTag({ content: NO_CELLS })
      for (let i = 0; i < count; i++) overBanner += await notPaper(page, await interior(i), paper)
      expect(overBanner, 'the banner is under the buttons without their cells').toBeGreaterThan(0)
    })
  }

  test('the title and the subline are on paper behind every line of their own words, and the banner shows between and around them', async ({ page }) => {
    await openList(page)
    await page.addStyleTag({ content: WORDS_GONE })
    const paper = rgb(await paperOf(page))
    const runs = ['.q-list-title', '.q-list-description']
    const lines: Rect[] = []

    for (const selector of runs) {
      const rects = await lineRects(page.locator(`.q-list-head ${selector} [class*="q-run"]`).first())
      expect(rects.length, `${selector}: the run wraps onto more than one line in this header`).toBeGreaterThan(1)
      for (const rect of rects) {
        expect(await notPaper(page, rect, paper), `${selector}: pixels of a line that are not the paper`).toBe(0)
        lines.push(rect)
      }
      const style = await page.locator(`.q-list-head ${selector} [class*="q-run"]`).last().evaluate((element) => {
        const css = getComputedStyle(element)

        return { display: css.display, decoration: css.getPropertyValue('box-decoration-break') || css.getPropertyValue('-webkit-box-decoration-break'), background: css.backgroundColor }
      })
      expect(style.decoration, `${selector}: every wrapped line is its own cell`).toBe('clone')
    }

    // The control: with the cells taken away, the banner shows under the same lines.
    await page.addStyleTag({ content: NO_CELLS })
    let under = 0
    for (const rect of lines) under += await notPaper(page, rect, paper)
    expect(under, 'the banner is under the title and the subline without their cells').toBeGreaterThan(0)
  })

  test('the kicker and each part of the progress line are cells of paper, as the bar is, with 2px of paper around it', async ({ page }) => {
    await openList(page)
    const paper = await paperOf(page)
    const rgbOf = (hex: string) => `rgb(${rgb(hex).join(', ')})`
    const parts = page.locator('.q-list-head .q-progress.header > *')
    expect(await parts.count()).toBeGreaterThanOrEqual(5)

    for (const selector of ['.q-list-head .q-kicker', '.q-list-head .q-progress.header .q-pct', '.q-list-head .q-progress.header .q-count', '.q-list-head .q-progress.header .q-left']) {
      const background = await page.locator(selector).first().evaluate((element) => getComputedStyle(element).backgroundColor)
      expect(background, `${selector} is on paper`).toBe(rgbOf(paper))
    }
    const meter = await page.locator('.q-list-head .q-progress.header .q-meter').first().evaluate((element) => getComputedStyle(element).outline)
    expect(meter, 'the bar has 2px of paper around it').toContain(rgbOf(paper))
    expect(meter).toContain('2px')
  })

  test('the kicker, the title and the progress line hug their words: they are not the width of the header', async ({ page }) => {
    await openList(page)
    const head = (await page.locator('.q-list-titles').boundingBox())!
    for (const selector of ['.q-list-head .q-kicker', '.q-list-head .q-progress.header']) {
      const box = (await page.locator(selector).first().boundingBox())!
      expect(box.width, `${selector} hugs its words`).toBeLessThan(head.width - 100)
    }
  })

  test('Quantum has none of it: no run wrappers, no paper behind the words or the buttons', async ({ page }) => {
    await openList(page, { theme: 'quantum' })
    expect(await page.locator('.q-list-head [class*="q-run"]').count()).toBe(0)
    for (const selector of ['.q-list-head .q-kicker', '.q-list-head .q-list-title', '.q-list-head .q-list-actions .q-icon-btn']) {
      expect(await page.locator(selector).first().evaluate((element) => getComputedStyle(element).backgroundColor), selector).toBe('rgba(0, 0, 0, 0)')
    }
  })
})
