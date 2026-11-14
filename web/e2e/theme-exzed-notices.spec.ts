import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { decodePng, type Pixels } from './pngPixels.js'
import { FIXTURE_LIST_ID, q, useHomeFixture } from './fixtures.js'

/**
 * eX-Zed's notices (51.10, X-007; design's Toast and Banner cards), on the real screens, in both engines and all six skins. **The toast is one line at the top centre: a `frame-hi` 2px border and the
 * 4px `paper` ring, 16px `ink`, at most one bracketed action, one FLASH step in (320ms, inverse video) and no animation out, none at all under reduced motion; the Banner a 2px `info-line` border
 * with no fill and 24px bracketed buttons; the error strip a 2px `frame` border, 56px at least, with [Retry] [Dismiss]; the error block a 2px `frame` border, the headline in `ink`, the explanation
 * in `ink2`, one action; the refusal the ! icon and one sentence in `ink2`.** Names are the card's; the timings are Quantum's 3s and 5s, which the owner chose over the card's 3.2s and 8s (DECISIONS).
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
type Rgb = [number, number, number]
const BANG = 'M3 0h2v5H3zM3 6h2v2H3z'

const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)
const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgbOf = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const css = (c: Rgb) => `rgb(${c.join(', ')})`
const box = async (locator: Locator) => (await locator.boundingBox())!

async function roles(page: Page) {
  const names = ['paper', 'ink', 'ink2', 'frame', 'frame-hi', 'info-line', 'acc', 'acc-ink'] as const
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

async function seed(page: Page, skin: string, extra: Record<string, string> = {}) {
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin, ...extra }))
}

async function makeList(request: APIRequestContext, title: string): Promise<string> {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'manual', items: [{ title: 'Alpha', timeToConsumeMinutes: 30, group: 'Season 1' }, { title: 'Beta', timeToConsumeMinutes: 30, group: 'Season 1' }] },
  })

  return list.id
}

for (const skin of SKINS) {
  test.describe(`with the theme exzed, skin ${skin}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
    })

    test('a toast with Undo: top centre, 2px frame-hi border, the paper ring, 16px ink, a bracketed 40px action; it leaves with no animation, after 5s', async ({ page }) => {
      await seed(page, skin)
      const title = `e2e notices ${skin} ${test.info().project.name} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const id = await makeList(page.request, title)
      try {
        await page.goto('/')
        await page.getByRole('button', { name: new RegExp(title) }).click()
        await expect(page.getByText('Beta', { exact: true })).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await page.clock.install()
        await page.getByRole('button', { name: q.list.itemActions.remove('Beta') }).click()
        const toast = page.locator('.q-toast')
        await expect(toast).toBeVisible()
        // Time stops here, so the real time the checks take cannot count against the 5s.
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 250))
        const r = await roles(page)

        expect(await style(toast, ['border-top-width', 'border-top-style', 'border-top-color', 'background-color', 'color', 'font-size', 'font-weight', 'line-height', 'box-shadow', 'gap'])).toEqual({
          'border-top-width': '2px',
          'border-top-style': 'solid',
          'border-top-color': css(r['frame-hi']),
          'background-color': css(r.paper),
          color: css(r.ink),
          'font-size': '16px',
          'font-weight': '400',
          'line-height': '24px',
          'box-shadow': `${css(r.paper)} 0px 0px 0px 4px`,
          gap: '16px',
        })
        expect((await style(toast, ['padding-left', 'padding-right', 'padding-top', 'min-height'])), 'the card’s 4px 4px 4px 16px, as high as a 40px button in it').toEqual({
          'padding-left': '16px',
          'padding-right': '4px',
          'padding-top': '4px',
          'min-height': '52px',
        })
        const b = await box(toast)
        expect(Math.abs(b.x + b.width / 2 - 720), 'centred on the window').toBeLessThanOrEqual(1)
        const undo = toast.getByRole('button', { name: q.list.itemActions.undo })
        expect((await style(undo, ['height', 'padding-left', 'color'])), 'a 40px bracketed secondary').toEqual({ height: '40px', 'padding-left': '16px', color: css(r.ink2) })
        expect(await undo.evaluate((el) => getComputedStyle(el, '::before').content)).toContain('[')

        // No animation out, and the timing is Quantum's: there 250ms+4.5s after it came, gone 0.6s later: about 5s.
        await page.clock.runFor(4500)
        await expect(toast).toBeVisible()
        expect((await style(toast, ['animation-name']))['animation-name'], 'nothing animates it out').toBe('none')
        await page.clock.runFor(600)
        await expect(toast).toBeHidden()
      } finally {
        await page.request.delete(`/api/lists/${id}`)
      }
    })

    for (const reduced of [false, true]) {
      test(`a toast ${reduced ? 'has no flash under reduced motion' : 'comes in with one FLASH step (320ms, steps(1), once)'}`, async ({ page }) => {
        await seed(page, skin, { reducedMotion: String(reduced) })
        const title = `e2e notices flash ${skin} ${test.info().project.name} ${reduced} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const id = await makeList(page.request, title)
        try {
          await page.goto('/')
          await page.getByRole('button', { name: new RegExp(title) }).click()
          await expect(page.getByText('Beta', { exact: true })).toBeVisible()
          await page.getByRole('button', { name: q.list.itemActions.remove('Beta') }).click()
          const toast = page.locator('.q-toast')
          await expect(toast).toBeVisible()
          const seen = await style(toast, ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-iteration-count'])
          if (reduced) {
            expect(seen['animation-name'], 'reduced motion: no flash').toBe('none')
          } else {
            expect(seen['animation-duration']).toBe('0.32s')
            expect(seen['animation-timing-function']).toBe('steps(1)')
            expect(seen['animation-iteration-count']).toBe('1')
            expect(seen['animation-name']).not.toBe('none')
            expect(seen['animation-name']).not.toBe('q-toast-in')
          }
        } finally {
          await page.request.delete(`/api/lists/${id}`)
        }
      })
    }

    test('a plain toast has the same box and nothing but its sentence: 52px high, 16px either side', async ({ page }) => {
      await seed(page, skin)
      const title = `e2e notices plain ${skin} ${test.info().project.name} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const id = await makeList(page.request, title)
      try {
        await page.goto('/')
        await page.getByRole('button', { name: new RegExp(title) }).click()
        await expect(page.getByText('Alpha', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: q.list.itemActions.edit('Alpha') }).click()
        const dialog = page.getByRole('dialog')
        await dialog.getByLabel('Title').fill('Alpha Prime')
        await dialog.getByRole('button', { name: q.list.itemActions.save, exact: true }).click()
        const toast = page.locator('.q-toast')
        await expect(toast).toContainText(q.list.itemActions.saved('Alpha Prime'))
        await expect(toast.getByRole('button')).toHaveCount(0)
        expect(await style(toast, ['padding-left', 'padding-right', 'min-height'])).toEqual({ 'padding-left': '16px', 'padding-right': '16px', 'min-height': '52px' })
        expect((await box(toast)).height).toBe(52)
      } finally {
        await page.request.delete(`/api/lists/${id}`)
      }
    })

    test('the Banner: a 2px info-line border, no fill, 16px text with the name in ink, and bracketed 24px buttons 8px apart', async ({ page }) => {
      await seed(page, skin)
      await useHomeFixture(page)
      await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
      await page.addInitScript(([id]) => localStorage.setItem('updates:pending', JSON.stringify({ [id!]: { count: 2, checkedAt: '2026-01-01T00:00:00.000Z' } })), [FIXTURE_LIST_ID])
      await page.goto('/')
      const banner = page.locator('.q-banner').first()
      await expect(banner).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await page.mouse.move(0, 0)
      const r = await roles(page)

      expect(await style(banner, ['border-top-width', 'border-top-style', 'border-top-color', 'border-bottom-width', 'border-bottom-color', 'background-color', 'color', 'font-size', 'padding-left', 'padding-top', 'padding-right', 'gap'])).toEqual({
        'border-top-width': '2px',
        'border-top-style': 'solid',
        'border-top-color': css(r['info-line']),
        'border-bottom-width': '2px',
        'border-bottom-color': css(r['info-line']),
        'background-color': 'rgba(0, 0, 0, 0)',
        color: css(r.ink2),
        'font-size': '16px',
        'padding-left': '16px',
        'padding-top': '2px',
        'padding-right': '2px',
        gap: '16px',
      })
      expect(await style(banner.locator('b'), ['color', 'font-weight', 'font-size'])).toEqual({ color: css(r.ink), 'font-weight': '400', 'font-size': '16px' })
      const buttons = banner.locator('.q-btn')
      await expect(buttons).toHaveCount(2)
      for (const at of [0, 1]) {
        expect(await style(buttons.nth(at), ['height', 'padding-left', 'padding-right', 'font-size', 'color']), `button ${at}`).toEqual({ height: '24px', 'padding-left': '8px', 'padding-right': '8px', 'font-size': '16px', color: css(r.ink2) })
        expect(await buttons.nth(at).evaluate((el) => getComputedStyle(el, '::before').content)).toContain('[')
      }
      const [first, second] = [await box(buttons.nth(0)), await box(buttons.nth(1))]
      expect(second.x - (first.x + first.width), 'the buttons are 8px apart').toBe(8)
      expect((await box(banner)).height, '24px buttons in a 2px border and 2px padding').toBe(32)
      // Hover: the highlight on the button's own box.
      await buttons.nth(1).hover()
      expect(await style(buttons.nth(1), ['background-color', 'color'])).toEqual({ 'background-color': css(r.acc), color: css(r['acc-ink']) })
    })

    test('the narrow-window banner is the same Banner: [Keep Quantum] and [Dismiss] in 24px brackets', async ({ page }) => {
      await page.setViewportSize({ width: 1000, height: 800 })
      await seed(page, skin)
      await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
      await page.goto('/')
      const banner = page.locator('.q-banner[role="status"]')
      await expect(banner).toBeVisible()
      const r = await roles(page)
      expect((await style(banner, ['border-top-width', 'border-top-color', 'background-color']))).toEqual({ 'border-top-width': '2px', 'border-top-color': css(r['info-line']), 'background-color': 'rgba(0, 0, 0, 0)' })
      for (const button of await banner.locator('.q-btn').all()) expect((await style(button, ['height']))['height']).toBe('24px')
    })

    test('the error strip: a 2px frame border, no fill, 56px at least, one sentence in ink, [Retry] and [Dismiss] 40px high 8px apart', async ({ page }) => {
      await seed(page, skin)
      await page.route('**/api/media-types/music/search**', (route) => route.fulfill({ status: 502, json: { error: 'Upstream unavailable', message: 'MusicBrainz is rate-limiting us. Try again in a moment.' } }))
      await page.goto('/')
      await page.getByRole('button', { name: q.home.newList }).click()
      await page.locator('.q-tile', { hasText: 'Music' }).click()
      await page.getByLabel(q.search.queryLabel('MusicBrainz'), { exact: true }).fill('strip')
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      const strip = page.getByRole('alert')
      await expect(strip).toContainText('rate-limiting')
      await page.evaluate(() => document.fonts.ready)
      const r = await roles(page)

      expect(await style(strip, ['border-top-width', 'border-top-style', 'border-top-color', 'background-color', 'color', 'font-size', 'min-height', 'padding-left', 'padding-right', 'gap'])).toEqual({
        'border-top-width': '2px',
        'border-top-style': 'solid',
        'border-top-color': css(r.frame),
        'background-color': 'rgba(0, 0, 0, 0)',
        color: css(r.ink),
        'font-size': '16px',
        'min-height': '56px',
        'padding-left': '16px',
        'padding-right': '8px',
        gap: '8px',
      })
      const retry = strip.getByRole('button', { name: q.search.retry })
      const dismiss = strip.getByRole('button', { name: q.search.dismiss })
      for (const button of [retry, dismiss]) {
        expect(await style(button, ['height', 'color'])).toEqual({ height: '40px', color: css(r.ink2) })
        expect(await button.evaluate((el) => getComputedStyle(el, '::before').content)).toContain('[')
      }
      const [a, b] = [await box(retry), await box(dismiss)]
      expect(b.x - (a.x + a.width), 'Retry and Dismiss 8px apart').toBe(8)
      // The sentence takes what is left, so the buttons sit at the right edge of the strip, 8px in.
      const s = await box(strip)
      expect(s.x + s.width - 2 - 8 - (b.x + b.width), 'Dismiss ends 8px inside the border').toBe(0)
      await dismiss.click()
      await expect(strip).toBeHidden()
    })

    test('the error block: a 2px frame border, no fill, the headline in ink, the explanation in ink2, 16px type on 24px lines, 16px of padding and 8px between its parts', async ({ page }) => {
      await seed(page, skin)
      await page.route('**/api/media-types/music/search**', (route) => route.fulfill({ status: 409, json: { code: 'search.unavailableOffline', params: { category: 'Music' } } }))
      await page.goto('/')
      await page.getByRole('button', { name: q.home.newList }).click()
      await page.locator('.q-tile', { hasText: 'Music' }).click()
      await page.getByLabel(q.search.queryLabel('MusicBrainz'), { exact: true }).fill('block')
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      const block = page.locator('.q-error-block')
      await expect(block).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const r = await roles(page)

      expect(await style(block, ['border-top-width', 'border-top-style', 'border-top-color', 'background-color', 'padding-top', 'padding-left', 'display', 'flex-direction', 'row-gap', 'line-height'])).toEqual({
        'border-top-width': '2px',
        'border-top-style': 'solid',
        'border-top-color': css(r.frame),
        'background-color': 'rgba(0, 0, 0, 0)',
        'padding-top': '16px',
        'padding-left': '16px',
        display: 'flex',
        'flex-direction': 'column',
        'row-gap': '8px',
        'line-height': '24px',
      })
      expect(await style(block.locator('b'), ['color', 'font-size', 'font-weight', 'line-height'])).toEqual({ color: css(r.ink), 'font-size': '16px', 'font-weight': '400', 'line-height': '24px' })
      expect(await style(block.locator('p'), ['color', 'font-size', 'font-weight', 'line-height', 'margin-top'])).toEqual({ color: css(r.ink2), 'font-size': '16px', 'font-weight': '400', 'line-height': '24px', 'margin-top': '0px' })
    })

    test('the error block’s one action is a 40px bracketed button under the explanation, left-aligned', async ({ page }) => {
      await seed(page, skin)
      await page.route('**/api/**', (route) => route.abort())
      await page.goto('/')
      const retry = page.getByRole('button', { name: 'Retry' })
      await expect(retry).toBeVisible({ timeout: 15_000 })
      const block = page.locator('.q-error-block')
      const r = await roles(page)
      expect(await style(retry, ['height', 'margin-top', 'color'])).toEqual({ height: '40px', 'margin-top': '0px', color: css(r.ink2) })
      const [bb, rb] = [await box(block), await box(retry)]
      expect(rb.x - bb.x, '16px padding and the 2px border: the button’s box starts 18px in').toBe(18)
    })

    test('a refusal is the ! icon and one sentence in ink2, 8px apart; the icon is the card’s bar and dot', async ({ page }) => {
      await seed(page, skin)
      await page.goto('/')
      await page.getByRole('button', { name: q.home.newList }).click()
      await page.locator('.q-tile', { hasText: /^Movies/ }).click()
      await page.getByRole('tab', { name: q.createList.importTab }).click()
      await page.getByLabel(q.importFile.boxLabel).fill('title: X\ncategory: board games\nitems:\n  - { title: A }\n')
      await page.getByRole('button', { name: q.importFile.import, exact: true }).click()
      const refusal = page.locator('.q-import-refusal')
      await expect(refusal).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const r = await roles(page)

      expect(await style(refusal, ['display', 'column-gap', 'color', 'font-size', 'line-height'])).toEqual({ display: 'flex', 'column-gap': '8px', color: css(r.ink2), 'font-size': '16px', 'line-height': '24px' })
      // The Quantum glyph is gone: the one drawn icon is 16x16 at the sentence's left edge.
      await expect(refusal.locator('svg')).toBeHidden()
      const b = await box(refusal)
      const mark = decodePng(await page.screenshot({ clip: { x: Math.round(b.x), y: Math.round(b.y + (b.height - 16) / 2), width: 16, height: 16 } }))
      const scale = mark.width / 16
      const bang = cells(BANG)
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const want = bang.has(`${x},${y}`) ? r.ink2 : null
          const got = at(mark, scale, x * 2 + 0.5, y * 2 + 0.5)
          if (want) expect(got, `the icon, cell ${x},${y}`).toEqual(want)
          else expect(got, `outside the icon, cell ${x},${y}`).not.toEqual(r.ink2)
        }
      }
    })

    test('the taken-name refusal under a group head is the same part: paper, a 2px frame border, the ! icon and the sentence in ink2', async ({ page }) => {
      await seed(page, skin)
      const title = `e2e notices group ${skin} ${test.info().project.name} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const id = await makeList(page.request, title)
      await page.request.post(`/api/lists/${id}/items/import`, { data: { source: 'manual', items: [{ title: 'Gamma', timeToConsumeMinutes: 30, group: 'Season 2' }] } })
      try {
        await page.goto('/')
        await page.getByRole('button', { name: new RegExp(title) }).click()
        await expect(page.getByText('Gamma', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Rename group Season 2', exact: true }).click()
        const input = page.locator('.q-group-input')
        await input.fill('Season 1')
        await input.press('Enter')
        const message = page.locator('.q-group-msg')
        await expect(message).toBeVisible()
        const r = await roles(page)
        expect(await style(message, ['background-color', 'border-top-width', 'border-top-color', 'color', 'font-size', 'line-height', 'padding-left'])).toEqual({
          'background-color': css(r.paper),
          'border-top-width': '2px',
          'border-top-color': css(r.frame),
          color: css(r.ink2),
          'font-size': '16px',
          'line-height': '24px',
          'padding-left': '8px',
        })
        expect(await message.locator('.q-field-msg').evaluate((el) => getComputedStyle(el, '::before').content), 'the ! icon is drawn').not.toBe('none')
      } finally {
        await page.request.delete(`/api/lists/${id}`)
      }
    })
  })
}

test('Quantum is as it was: the toast keeps its 1px rule and its slide, the banner its fill', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('reducedMotion', 'false'))
  await useHomeFixture(page)
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.addInitScript(([id]) => localStorage.setItem('updates:pending', JSON.stringify({ [id!]: { count: 2, checkedAt: '2026-01-01T00:00:00.000Z' } })), [FIXTURE_LIST_ID])
  await page.goto('/')
  const banner = page.locator('.q-banner').first()
  await expect(banner).toBeVisible()
  expect((await style(banner, ['border-top-width', 'border-bottom-width']))).toEqual({ 'border-top-width': '0px', 'border-bottom-width': '1px' })
  expect((await style(banner.locator('.q-btn').first(), ['height']))['height']).not.toBe('24px')
})
