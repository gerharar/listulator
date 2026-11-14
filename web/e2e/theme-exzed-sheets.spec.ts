import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng, type Pixels } from './pngPixels.js'

/**
 * eX-Zed's helper sheets (51.11, X-007; design's Sheet card and the Home-Helpers board), on the real screen, in both engines and all six skins. **A sheet hangs under the NEED HELP? row, 24px in from the window,
 * 800px wide, in the single frame (2px `frame-hi` and the 4px `paper` ring), over the scrim: a 2px checkerboard of `chip-ink` over the lists under the row, never solid. Its head is the 24px title and the
 * dim explanation over a 2px `frame` rule, with the ✕ as a 40px button; its body is the kicker in `lab`, the pick at 24px, its line, the why in `ink2`, then the primary and a [secondary] 8px apart. The helper
 * whose sheet is open is lit.** The Home banner and the help row's rule are the board's too (they hang over the same area).
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
type Rgb = [number, number, number]
const CLOSE = 'M0 0h2v1H0zM6 0h2v1H6zM1 1h2v1H1zM5 1h2v1H5zM2 2h4v1H2zM3 3h2v2H3zM2 5h4v1H2zM1 6h2v1H1zM5 6h2v1H5zM0 7h2v1H0zM6 7h2v1H6z'

const base = { description: null, externalRef: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const LIST = {
  ...base,
  id: 'A',
  title: 'Megadeth - discography',
  mediaType: 'music',
  source: 'api',
  status: 'ongoing',
  stats: { totalItems: 30, consumedItems: 16, newItems: 0, completionPercent: 53, timeRemainingMinutes: 400, lastConsumedAt: null },
}
const PICK = {
  list: LIST,
  nextItem: { id: 'i1', listId: 'A', title: 'The System Has Failed (2004)', orderIndex: 0, timeToConsumeMinutes: 52, timeToConsumeIsEstimated: false, consumedAt: null, source: 'import', year: 2004, yearUnk: 0, group: null, tags: null, notes: null },
  score: 1,
  factors: {},
}

const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)
const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgbOf = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const css = (c: Rgb) => `rgb(${c.join(', ')})`
const box = async (locator: Locator) => (await locator.boundingBox())!

async function roles(page: Page) {
  const names = ['paper', 'ink', 'ink2', 'lab', 'frame', 'frame-hi', 'chip-ink', 'acc', 'acc-ink', 'info-line'] as const
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
const near = (seen: Rgb, want: Rgb, label: string) => expect(seen.map((n, i) => Math.abs(n - want[i]!)).every((d) => d <= 2), `${label}: ${seen} is not ${want}`).toBe(true)

async function openHelper(page: Page, skin: string, button: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/lists', (route) => route.fulfill({ json: [LIST] }))
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [{ externalRef: 'canonical:bb', title: 'Breaking Bad', category: 'tv', itemCount: 62 }], reachable: true } }))
  await page.route('**/api/suggestions/finalizer', (route) => route.fulfill({ json: { picks: [PICK] } }))
  await page.route('**/api/suggestions/just-one-fix', (route) => route.fulfill({ json: { picks: [PICK] } }))
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
  await page.getByRole('button', { name: button, exact: true }).click()
  await page.locator('.q-sheet').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
}

for (const skin of SKINS) {
  test.describe(`with the theme exzed, skin ${skin}`, () => {
    test('a helper sheet is the single frame, 800px wide, 24px in from the window, under the NEED HELP? row; the helper that opened it is lit', async ({ page }) => {
      await openHelper(page, skin, 'Finalizer')
      const r = await roles(page)
      const sheet = page.locator('.q-sheet')
      expect(await style(sheet, ['border-top-width', 'border-top-style', 'border-top-color', 'background-color', 'box-shadow', 'width', 'max-width'])).toEqual({
        'border-top-width': '2px',
        'border-top-style': 'solid',
        'border-top-color': css(r['frame-hi']),
        'background-color': css(r.paper),
        'box-shadow': `${css(r.paper)} 0px 0px 0px 4px`,
        width: '800px',
        'max-width': 'calc(100% - 48px)',
      })
      const home = await box(page.locator('.q-home'))
      const s = await box(sheet)
      const row = await box(page.locator('.q-help-row'))
      expect(s.x - home.x, '24px in from the window').toBe(24)
      expect(s.y - (row.y + row.height), '16px under the help row’s rule').toBe(16)
      expect(s.width).toBe(800)

      const lit = page.getByRole('button', { name: 'Finalizer', exact: true })
      expect(await style(lit, ['background-color', 'color'])).toEqual({ 'background-color': css(r.acc), color: css(r['acc-ink']) })
      expect((await style(page.getByRole('button', { name: 'Surprise Me', exact: true }), ['background-color']))['background-color']).toBe('rgba(0, 0, 0, 0)')
    })

    test('the help row’s rule is the board’s: 2px frame, 24px in on each side, and the row is 8px of padding over a 24px line', async ({ page }) => {
      await openHelper(page, skin, 'Finalizer')
      const r = await roles(page)
      const row = page.locator('.q-help-row')
      expect(await style(row, ['border-bottom-width', 'border-bottom-style', 'border-bottom-color', 'margin-left', 'margin-right', 'padding-left', 'padding-top', 'padding-bottom'])).toEqual({
        'border-bottom-width': '2px',
        'border-bottom-style': 'solid',
        'border-bottom-color': css(r.frame),
        'margin-left': '24px',
        'margin-right': '24px',
        'padding-left': '0px',
        'padding-top': '8px',
        'padding-bottom': '8px',
      })
    })

    test('the scrim is the 2px checkerboard of chip-ink over the lists under the row, never solid', async ({ page }) => {
      await openHelper(page, skin, 'Finalizer')
      const r = await roles(page)
      const anchor = page.locator('.q-help-anchor')
      const scrim = await anchor.evaluate((el) => {
        const s = getComputedStyle(el, '::before')
        return { image: s.backgroundImage, size: s.backgroundSize, position: s.position, top: s.top, left: s.left, width: s.width, height: s.height, room: getComputedStyle(el).getPropertyValue('--help-room') }
      })
      expect(scrim.image).toContain('repeating-conic-gradient')
      expect(scrim.image).toContain(css(r['chip-ink']))
      expect(scrim).toMatchObject({ size: '4px 4px', position: 'absolute', top: '0px', left: '0px' })
      const a = await box(anchor)
      const home = await box(page.locator('.q-home'))
      expect(parseFloat(scrim.width), 'as wide as the window').toBe(home.width)
      expect(scrim.height, 'down to the window’s bottom: the room the sheet has').toBe(scrim.room.trim())
      void a

      // Where it can be told from what is behind it (the lists' empty paper at the foot of the window; Lotus's paper is not black): two colours in 2px cells.
      if (JSON.stringify(r.paper) !== JSON.stringify(r['chip-ink'])) {
        const b = await box(page.locator('.q-home-body'))
        const x0 = Math.round(b.x) + 2 * Math.floor((b.width - 100) / 2)
        const y0 = Math.round(b.y) + 2 * Math.floor((b.height - 24) / 2)
        const pixels = decodePng(await page.screenshot({ clip: { x: x0, y: y0, width: 8, height: 8 } }))
        const scale = pixels.width / 8
        const clusters: Rgb[] = []
        for (let y = 0; y < 8; y += 2) {
          for (let x = 0; x < 8; x += 2) {
            const c = at(pixels, scale, x + 0.5, y + 0.5)
            if (!clusters.some((k) => k.every((n, i) => Math.abs(n - c[i]!) <= 2))) clusters.push(c)
          }
        }
        expect(clusters.length, 'two colours').toBe(2)
        expect(clusters.some((c) => c.every((n, i) => Math.abs(n - r['chip-ink'][i]!) <= 2))).toBe(true)
      }
    })

    test('the head: padding 16px 16px 16px 24px, a 2px frame rule under it, the title 24px on 32px lines in ink, the explanation 16px in ink2, and a 40px ✕ drawn in pixels', async ({ page }) => {
      await openHelper(page, skin, 'Finalizer')
      const r = await roles(page)
      const head = page.locator('.q-sheet-head')
      expect(await style(head, ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-bottom-width', 'border-bottom-color', 'column-gap'])).toEqual({
        'padding-top': '16px',
        'padding-right': '16px',
        'padding-bottom': '16px',
        'padding-left': '24px',
        'border-bottom-width': '2px',
        'border-bottom-color': css(r.frame),
        'column-gap': '16px',
      })
      expect(await style(head.locator('.q-sheet-title'), ['font-size', 'line-height', 'font-weight', 'color'])).toEqual({ 'font-size': '24px', 'line-height': '32px', 'font-weight': '400', color: css(r.ink) })
      expect(await style(head.locator('.q-sheet-explain'), ['font-size', 'line-height', 'font-weight', 'color', 'margin-top'])).toEqual({ 'font-size': '16px', 'line-height': '24px', 'font-weight': '400', color: css(r.ink2), 'margin-top': '0px' })
      const title = await box(head.locator('.q-sheet-title'))
      const explain = await box(head.locator('.q-sheet-explain'))
      expect(explain.y - (title.y + title.height), '8px between the title and its line').toBe(8)

      const close = head.getByRole('button', { name: 'Close' })
      const c = await box(close)
      expect([c.width, c.height]).toEqual([40, 40])
      const pixels = decodePng(await page.screenshot({ clip: { x: Math.round(c.x + 12), y: Math.round(c.y + 12), width: 16, height: 16 } }))
      const scale = pixels.width / 16
      const filled = cells(CLOSE)
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const got = at(pixels, scale, x * 2 + 0.5, y * 2 + 0.5)
          if (filled.has(`${x},${y}`)) near(got, r.ink2, `the ✕, cell ${x},${y}`)
          else expect(got, `outside the ✕, cell ${x},${y}`).not.toEqual(r.ink2)
        }
      }
    })

    test('the body: the kicker in lab, the pick at 24px, its line in ink, the why in ink2, then the primary and a bracketed secondary 8px apart, 16px under the text', async ({ page }) => {
      await openHelper(page, skin, 'Finalizer')
      const r = await roles(page)
      const body = page.locator('.q-sheet-body')
      expect(await style(body, ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'line-height'])).toEqual({ 'padding-top': '16px', 'padding-right': '24px', 'padding-bottom': '24px', 'padding-left': '24px', 'line-height': '24px' })
      const pick = body.locator('.q-pick')
      expect(await style(pick, ['border-top-width', 'padding-top', 'row-gap', 'display'])).toEqual({ 'border-top-width': '0px', 'padding-top': '0px', 'row-gap': '8px', display: 'flex' })
      expect(await style(pick.locator('.q-kicker'), ['color', 'font-size', 'line-height', 'text-transform'])).toEqual({ color: css(r.lab), 'font-size': '16px', 'line-height': '24px', 'text-transform': 'uppercase' })
      expect(await style(pick.locator('.q-pick-item'), ['color', 'font-size', 'line-height', 'font-weight', 'margin-top'])).toEqual({ color: css(r.ink), 'font-size': '24px', 'line-height': '32px', 'font-weight': '400', 'margin-top': '0px' })
      expect(await style(pick.locator('.q-pick-list'), ['color', 'font-size', 'line-height', 'margin-top'])).toEqual({ color: css(r.ink), 'font-size': '16px', 'line-height': '24px', 'margin-top': '0px' })
      expect(await style(pick.locator('.q-pick-why'), ['color', 'font-size', 'line-height', 'margin-top'])).toEqual({ color: css(r.ink2), 'font-size': '16px', 'line-height': '24px', 'margin-top': '0px' })
      const actions = pick.locator('.q-pick-actions')
      const open = actions.getByRole('button', { name: 'Open List' })
      const notThat = actions.getByRole('button', { name: 'Not That' })
      expect(await style(open, ['height', 'background-color', 'color'])).toEqual({ height: '40px', 'background-color': css(r.acc), color: css(r['acc-ink']) })
      expect(await style(notThat, ['height', 'color', 'background-color'])).toEqual({ height: '40px', color: css(r.ink2), 'background-color': 'rgba(0, 0, 0, 0)' })
      expect(await notThat.evaluate((el) => getComputedStyle(el, '::before').content)).toContain('[')
      const [o, n] = [await box(open), await box(notThat)]
      expect(n.x - (o.x + o.width), '8px apart').toBe(8)
      const why = await box(pick.locator('.q-pick-why'))
      expect(o.y - (why.y + why.height), '16px under the text: 8px of gap and 8px of margin').toBe(16)
    })

    test('I’m Tired, Boss: its bar is 12px and 24px of padding over a 2px frame rule, no fill, the lead in ink2 and the list button a 40px frame box with the caret', async ({ page }) => {
      await openHelper(page, skin, "I'm Tired, Boss")
      const r = await roles(page)
      const bar = page.locator('.q-sheet-bar')
      expect(await style(bar, ['padding-top', 'padding-left', 'border-bottom-width', 'border-bottom-color', 'background-color', 'column-gap', 'font-size', 'line-height'])).toEqual({
        'padding-top': '12px',
        'padding-left': '24px',
        'border-bottom-width': '2px',
        'border-bottom-color': css(r.frame),
        'background-color': 'rgba(0, 0, 0, 0)',
        'column-gap': '8px',
        'font-size': '16px',
        'line-height': '24px',
      })
      expect((await style(bar.locator('.q-tired-lead'), ['color'])).color).toBe(css(r.ink2))
      const target = bar.locator('.q-tired-target')
      expect(await style(target, ['height', 'border-top-width', 'border-top-color', 'color', 'background-color', 'column-gap', 'padding-left', 'font-size'])).toEqual({
        height: '40px',
        'border-top-width': '2px',
        'border-top-color': css(r.frame),
        color: css(r.ink),
        'background-color': 'rgba(0, 0, 0, 0)',
        'column-gap': '8px',
        'padding-left': '8px',
        'font-size': '16px',
      })
    })

    test('Hold My Beer: the shelf chips are 32px with ink for a shelf that has lists and ink2 for one that has none, and the dials are 40x56 boxes in 32px type, the last three lit', async ({ page }) => {
      await openHelper(page, skin, 'Surprise Me')
      const r = await roles(page)
      await page.locator('.q-shelves').waitFor()
      const chips = page.locator('.q-shelves .q-chip')
      const withLists = page.locator('.q-shelves .q-chip', { hasText: 'TV Series' })
      const none = page.locator('.q-shelves .q-chip.none').first()
      expect(await style(withLists, ['height', 'padding-left', 'color', 'opacity'])).toEqual({ height: '32px', 'padding-left': '8px', color: css(r.ink), opacity: '1' })
      expect(await style(none, ['height', 'color', 'opacity'])).toEqual({ height: '32px', color: css(r.ink2), opacity: '1' })
      const any = page.locator('.q-shelves .q-chip', { hasText: 'Any' })
      expect(await style(any, ['background-color', 'color'])).toEqual({ 'background-color': css(r.acc), color: css(r['acc-ink']) })
      expect(await chips.count()).toBeGreaterThan(5)

      const digit = page.locator('.q-digit').first()
      expect(await style(digit, ['width', 'height', 'border-top-width', 'border-top-color', 'font-size', 'color', 'background-color'])).toEqual({
        width: '40px',
        height: '56px',
        'border-top-width': '2px',
        'border-top-color': css(r.frame),
        'font-size': '32px',
        color: css(r.ink2),
        'background-color': 'rgba(0, 0, 0, 0)',
      })
      expect((await style(page.locator('.q-dials'), ['column-gap']))['column-gap']).toBe('4px')
      expect(await style(page.locator('.q-reel'), ['border-top-width', 'padding-top'])).toEqual({ 'border-top-width': '0px', 'padding-top': '0px' })
    })
  })
}

test('Quantum is as it was: the sheet keeps its 640px width and its 1px-class rule', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/lists', (route) => route.fulfill({ json: [LIST] }))
  await page.route('**/api/suggestions/finalizer', (route) => route.fulfill({ json: { picks: [PICK] } }))
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  await page.getByRole('button', { name: 'Finalizer', exact: true }).click()
  const sheet = page.locator('.q-sheet')
  await sheet.waitFor()
  expect((await style(sheet, ['max-width']))['max-width']).toBe('640px')
  expect(await page.locator('.q-help-anchor').evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none')
})
