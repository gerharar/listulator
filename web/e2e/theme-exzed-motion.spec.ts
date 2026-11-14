import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { decodePng, type Pixels } from './pngPixels.js'
import { q } from './fixtures.js'

/**
 * eX-Zed's spinner, scrim and row pulse (51.11, X-007; design's Spinner, Sheet and Row cards, X-002 answer 6), on the real screens, in both engines and all six skins. **The spinner is eight 2x2-unit cells
 * on a ring (the card's, 24px), a head in `ink`, two cells behind it in `ink2`, the rest `frame`, moving a cell every 100ms in 8 steps; it stands still under reduced motion. A list that runs a whole-list
 * action keeps its colours (no fade), stops responding (`cursor: progress`), and its body takes the 2px checkerboard scrim of `chip-ink` after 300ms, in one step both ways; the waiting message shows with the
 * spinner. A pulsing row flashes like a hovered one, three times at 320ms a step, and stays lit for 2s under reduced motion.**
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
type Rgb = [number, number, number]
const CELLS = [[5, 0], [8, 2], [10, 5], [8, 8], [5, 10], [2, 8], [0, 5], [2, 2]] as const

const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)
const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgbOf = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const css = (c: Rgb) => `rgb(${c.join(', ')})`
const box = async (locator: Locator) => (await locator.boundingBox())!

async function roles(page: Page) {
  const names = ['paper', 'ink', 'ink2', 'frame', 'chip-ink', 'acc', 'acc-ink'] as const
  const found = await Promise.all(names.map((n) => token(page, `--zx-${n}`)))

  return Object.fromEntries(names.map((n, i) => [n, rgbOf(found[i]!)])) as Record<(typeof names)[number], Rgb>
}

function at(pixels: Pixels, scale: number, x: number, y: number): Rgb {
  const i = (Math.floor(y * scale + scale / 2) * pixels.width + Math.floor(x * scale + scale / 2)) * 4

  return [pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!]
}
const near = (seen: Rgb, want: Rgb, label: string) => expect(seen.map((n, i) => Math.abs(n - want[i]!)).every((d) => d <= 2), `${label}: ${seen} is not ${want}`).toBe(true)

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

const unique = (stem: string, skin: string) => `e2e ${stem} ${skin} ${test.info().project.name} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function makeList(request: APIRequestContext, title: string): Promise<string> {
  const yaml = `title: ${title}\ncategory: movie\nitems:\n  - { title: Alpha, group: One }\n  - { title: Beta, group: Two }\n  - { title: Gamma, group: Two }\n`
  const created = await request.post('/api/lists/from-file', { data: { yaml } })
  expect(created.ok()).toBe(true)

  return (await created.json()).id as string
}

/** Opens Music's search and holds the answer back until `release()`, so the spinner can be looked at. */
async function holdSearch(page: Page) {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/api/media-types/music/search**', async (route) => {
    await gate
    await route.fulfill({ json: { sources: [] } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: q.home.newList }).click()
  await page.locator('.q-tile', { hasText: 'Music' }).click()
  await page.getByLabel(q.search.queryLabel('MusicBrainz'), { exact: true }).fill('spin')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('.q-spinner').first().waitFor()
  await page.evaluate(() => document.fonts.ready)

  return release
}

/** A list a check can run on (it has a source reference and is not complete), and the check held back until `release()`, so the refresh icon can be looked at while it turns. */
async function holdCheck(page: Page) {
  const list = {
    description: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    id: 'R1',
    title: 'Refresh Saga',
    mediaType: 'movie',
    source: 'api',
    externalRef: 'tmdb:1',
    status: 'ongoing',
    stats: { totalItems: 2, consumedItems: 0, newItems: 0, completionPercent: 0, timeRemainingMinutes: 100, lastConsumedAt: null },
  }
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.route('**/api/lists', (route) => route.fulfill({ json: [list] }))
  await page.route('**/api/lists/R1', (route) => route.fulfill({ json: { ...list, items: [], groups: [] } }))
  await page.route('**/api/lists/R1/refresh', async (route) => {
    await gate
    await route.fulfill({ json: { newItems: [], upstreamCount: 0, existingCount: 0, dismissedCount: 0 } })
  })

  return release
}

/** The icon's turn at each of these moments of its animation, as degrees (rounded: a quarter turn's matrix has 1e-16 where a zero is). */
async function turnsAt(page: Page, selector: string, times: number[]) {
  const out: number[] = []
  for (const t of times) {
    out.push(
      await page.evaluate(
        ([sel, at]) => {
          const el = document.querySelector(sel as string)!
          for (const a of document.getAnimations()) {
            if ((a.effect as KeyframeEffect | null)?.target !== el) continue
            a.pause()
            a.currentTime = at as number
          }
          const m = new DOMMatrix(getComputedStyle(el).transform === 'none' ? undefined : getComputedStyle(el).transform)
          return (Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI) + 360) % 360
        },
        [selector, t] as const,
      ),
    )
  }

  return out
}

for (const skin of SKINS) {
  test.describe(`with the theme exzed, skin ${skin}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
    })

    test('the spinner is the card’s eight 4px cells on a 24px ring: a head in ink, two cells behind it in ink2, the rest in frame, one cell every 100ms in 8 steps', async ({ page }) => {
      await seed(page, skin, { reducedMotion: 'false' })
      const release = await holdSearch(page)
      try {
        const spinner = page.locator('.q-spinner').first()
        const r = await roles(page)
        expect(await style(spinner, ['width', 'height', 'border-top-width', 'border-top-left-radius', 'animation-name'])).toMatchObject({ width: '24px', height: '24px', 'border-top-width': '0px', 'border-top-left-radius': '0px' })
        await expect(spinner).toHaveAttribute('role', 'status')
        const cells = spinner.locator('rect')
        await expect(cells).toHaveCount(8)
        for (let i = 0; i < 8; i++) {
          const rect = cells.nth(i)
          expect([await rect.getAttribute('x'), await rect.getAttribute('y'), await rect.getAttribute('width'), await rect.getAttribute('height')], `cell ${i}`).toEqual([String(CELLS[i]![0]), String(CELLS[i]![1]), '2', '2'])
          expect(await rect.evaluate((el) => el.getBoundingClientRect().width), `cell ${i} is 4px`).toBe(4)
        }

        // Eight animations of 800ms with one step each; set to each step in turn, the head is that cell.
        const timing = await page.evaluate(() =>
          document.getAnimations().filter((a) => a instanceof CSSAnimation && (a.effect as KeyframeEffect).target?.closest('.q-spinner')).map((a) => {
            const t = a.effect!.getTiming()
            return { duration: t.duration, iterations: t.iterations, easing: t.easing }
          }),
        )
        expect(timing).toHaveLength(8)
        for (const t of timing) expect(t).toMatchObject({ duration: 800, iterations: Infinity })
        expect(await cells.evaluateAll((all) => all.map((el) => getComputedStyle(el).animationTimingFunction))).toEqual(Array(8).fill(expect.stringMatching(/^steps\(1/)))
        for (let step = 0; step < 8; step++) {
          await page.evaluate((s) => {
            for (const a of document.getAnimations()) {
              if (!((a as CSSAnimation).effect as KeyframeEffect | null)?.target?.closest('.q-spinner')) continue
              a.pause()
              a.currentTime = s * 100 + 30
            }
          }, step)
          const fills = await cells.evaluateAll((all) => all.map((el) => getComputedStyle(el).fill))
          const want = Array.from({ length: 8 }, (_, i) => (i === step ? css(r.ink) : i === (step + 7) % 8 || i === (step + 6) % 8 ? css(r.ink2) : css(r.frame)))
          expect(fills, `step ${step}`).toEqual(want)
        }
      } finally {
        release()
      }
    })

    test('under reduced motion the spinner stands still: the head at the top, its two cells behind it', async ({ page }) => {
      await seed(page, skin, { reducedMotion: 'true' })
      const release = await holdSearch(page)
      try {
        const spinner = page.locator('.q-spinner').first()
        const r = await roles(page)
        expect(await page.evaluate(() => document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.target?.closest('.q-spinner')).length)).toBe(0)
        const fills = await spinner.locator('rect').evaluateAll((all) => all.map((el) => getComputedStyle(el).fill))
        expect(fills).toEqual([r.ink, r.frame, r.frame, r.frame, r.frame, r.frame, r.ink2, r.ink2].map(css))
        // In pixels: the head's 4x4 block at the top middle (units 5..7, 0..2 at 2px each) is ink.
        const b = await box(spinner)
        const pixels = decodePng(await page.screenshot({ clip: { x: Math.round(b.x), y: Math.round(b.y), width: 24, height: 24 } }))
        const scale = pixels.width / 24
        near(at(pixels, scale, 12, 2), r.ink, 'the head')
        near(at(pixels, scale, 2, 12), r.ink2, 'the cell behind the head, to the left')
      } finally {
        release()
      }
    })

    test('the refresh icon turns in quarter turns while a check runs: four steps in 800ms, 90 degrees a step, on Home and on the list; the ring of the spinner never turns', async ({ page }) => {
      await seed(page, skin, { reducedMotion: 'false' })
      const release = await holdCheck(page)
      try {
        await page.goto('/')
        await page.locator('.q-home-row').first().waitFor()
        await page.getByRole('button', { name: 'Check for updates' }).click()
        const icon = page.locator('.q-home .q-spin')
        await icon.waitFor()
        expect(await style(icon, ['animation-name', 'animation-duration', 'animation-iteration-count'])).toEqual({ 'animation-name': 'q-spin', 'animation-duration': '0.8s', 'animation-iteration-count': 'infinite' })
        expect(await icon.evaluate((el) => getComputedStyle(el).animationTimingFunction)).toMatch(/^steps\(4/)
        // Each step is 200ms: 0, 90, 180, 270 degrees, then round again; a quarter turn puts every pixel back on the grid.
        expect(await turnsAt(page, '.q-home .q-spin', [100, 300, 500, 700])).toEqual([0, 90, 180, 270])
      } finally {
        release()
      }
    })

    test('the refresh icon on the list turns the same way', async ({ page }) => {
      await seed(page, skin, { reducedMotion: 'false' })
      const release = await holdCheck(page)
      try {
        await page.goto('/')
        await page.locator('.q-home-row').first().click()
        await page.locator('.q-check-btn').waitFor()
        await page.locator('.q-check-btn').click()
        const icon = page.locator('.q-check-btn .q-spin')
        await icon.waitFor()
        expect(await icon.evaluate((el) => [getComputedStyle(el).animationDuration, getComputedStyle(el).animationTimingFunction.slice(0, 7)])).toEqual(['0.8s', 'steps(4'])
        expect(await turnsAt(page, '.q-check-btn .q-spin', [100, 300, 500, 700])).toEqual([0, 90, 180, 270])
      } finally {
        release()
      }
    })

    test('under reduced motion the refresh icon stands still while a check runs', async ({ page }) => {
      await seed(page, skin, { reducedMotion: 'true' })
      const release = await holdCheck(page)
      try {
        await page.goto('/')
        await page.locator('.q-home-row').first().waitFor()
        await page.getByRole('button', { name: 'Check for updates' }).click()
        const icon = page.locator('.q-home .q-spin')
        await icon.waitFor()
        expect((await style(icon, ['animation-name', 'transform']))).toEqual({ 'animation-name': 'none', transform: 'none' })
      } finally {
        release()
      }
    })

    test('a list that runs a whole-list action is not faded: its rows keep their colours, show the progress cursor, and the body takes the checkerboard scrim after 300ms, in one step both ways', async ({ page }) => {
      await seed(page, skin)
      const title = unique('motion busy', skin)
      const id = await makeList(page.request, title)
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => (release = resolve))
      try {
        await page.route('**/api/lists/*/reset', async (route) => {
          await gate
          await route.continue()
        })
        await page.goto('/')
        await page.locator('.q-home-row', { hasText: title }).click()
        await expect(page.getByText('Alpha', { exact: true })).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        const body = page.locator('.q-list-cols')
        const r = await roles(page)
        expect((await style(body, ['visibility']))['visibility']).toBe('visible')
        expect(await body.evaluate((el) => getComputedStyle(el, '::after').visibility), 'no scrim at rest').toBe('hidden')

        await page.getByRole('button', { name: 'More' }).click()
        await page.locator('.q-pop').getByRole('button', { name: 'Reset List' }).click()
        await page.locator('.q-pop').getByRole('button', { name: 'Reset', exact: true }).click()
        await expect(body).toHaveAttribute('inert', '')

        // The scrim: 4px of chip-ink and clear in a conic checkerboard over the body, never solid, and after the 300ms delay.
        await expect.poll(() => body.evaluate((el) => getComputedStyle(el, '::after').visibility)).toBe('visible')
        const scrim = await body.evaluate((el) => {
          const s = getComputedStyle(el, '::after')
          return { image: s.backgroundImage, size: s.backgroundSize, position: s.position, top: s.top, left: s.left, width: s.width, height: s.height, delay: s.transitionDelay, bodyHeight: getComputedStyle(el).height }
        })
        expect(scrim.image).toContain('repeating-conic-gradient')
        expect(scrim.image).toContain(css(r['chip-ink']))
        expect(scrim.size).toBe('4px 4px')
        expect(scrim).toMatchObject({ position: 'absolute', top: '0px', left: '0px', width: scrim.width, height: scrim.bodyHeight })
        expect(scrim.delay, 'the delay is on the busy state only').toBe('0.3s')

        // No fade: the body and the rows are at full strength, and the rows keep their ink.
        expect((await style(body, ['opacity']))['opacity']).toBe('1')
        expect((await style(page.locator('.q-item .title').first(), ['color', 'opacity']))).toEqual({ color: css(r.ink), opacity: '1' })
        // The progress cursor over the rows: what is under the pointer is not an inert row, and says so.
        const row = await box(page.locator('.q-item').first())
        expect(await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x!, y!)!).cursor, [row.x + 200, row.y + row.height / 2])).toBe('progress')

        // The checkerboard in pixels where it can be told from what is behind it (Lotus's paper is not black).
        if (JSON.stringify(r.paper) !== JSON.stringify(r['chip-ink'])) {
          const b = await box(body)
          // On the scrim's own 2px grid, which starts at the body's top left.
          const x0 = Math.round(b.x) + 2 * Math.floor((b.width - 100) / 2)
          const y0 = Math.round(b.y) + 2 * Math.floor((b.height - 20) / 2)
          const pixels = decodePng(await page.screenshot({ clip: { x: x0, y: y0, width: 8, height: 8 } }))
          const scale = pixels.width / 8
          // Colours within 2 levels are one (WebKit's conic gradient is off by a level or two inside a cell).
          const clusters: Rgb[] = []
          for (let y = 0; y < 8; y += 2) {
            for (let x = 0; x < 8; x += 2) {
              const c = at(pixels, scale, x + 0.5, y + 0.5)
              if (!clusters.some((k) => k.every((n, i) => Math.abs(n - c[i]!) <= 2))) clusters.push(c)
            }
          }
          expect(clusters.length, 'two colours: the scrim’s pixels and what is behind them').toBe(2)
          expect(clusters.some((c) => c.every((n, i) => Math.abs(n - r['chip-ink'][i]!) <= 2)), 'one of them is chip-ink').toBe(true)
          expect(clusters.some((c) => c.every((n, i) => Math.abs(n - r.paper[i]!) <= 2)), 'the other is the paper behind').toBe(true)
        }

        // The waiting message shows with the spinner.
        const toast = page.locator('.q-toast')
        await expect(toast).toHaveText('Resetting the list…')
        await expect(toast.locator('.q-spinner rect')).toHaveCount(8)

        release()
        await expect(body).not.toHaveAttribute('inert', '')
        expect(await body.evaluate((el) => getComputedStyle(el, '::after').visibility), 'the scrim goes in one step, with no delay').toBe('hidden')
        expect(await body.evaluate((el) => getComputedStyle(el, '::after').transitionDelay)).toBe('0s')
      } finally {
        release()
        await page.request.delete(`/api/lists/${id}`)
      }
    })

    for (const reduced of [false, true]) {
      test(`a pulsing row ${reduced ? 'is a steady highlight for 2s under reduced motion' : 'flashes like a hovered row, three times at 320ms a step, and is over at 2s'}`, async ({ page }) => {
        await seed(page, skin, { reducedMotion: String(reduced) })
        const title = unique('motion pulse', skin)
        const id = await makeList(page.request, title)
        try {
          await page.goto('/')
          await page.locator('.q-home-row', { hasText: title }).click()
          await expect(page.getByText('Beta', { exact: true })).toBeVisible()
          await page.evaluate(() => document.fonts.ready)
          const r = await roles(page)
          await page.getByRole('button', { name: q.list.itemActions.remove('Beta') }).click()
          await expect(page.getByText('Beta', { exact: true })).toBeHidden()
          // Watch the row from the moment it comes back: when it is lit and when it is not, and when the pulse ends.
          await page.evaluate(() => {
            const log: Array<[number, string]> = []
            const start = performance.now()
            ;(window as unknown as { __pulse: typeof log }).__pulse = log
            const watch = () => {
              const row = [...document.querySelectorAll('.q-item')].find((el) => el.textContent?.includes('Beta'))
              const state = !row ? 'gone' : `${row.classList.contains('pulse') ? 'pulse' : 'plain'}${row.hasAttribute('data-flash') ? '+lit' : ''}`
              if (!log.length || log[log.length - 1]![1] !== state) log.push([Math.round(performance.now() - start), state])
              if (performance.now() - start < 3000) requestAnimationFrame(watch)
            }
            watch()
          })
          await page.locator('.q-toast').getByRole('button', { name: q.list.itemActions.undo }).click()
          const row = page.locator('.q-item', { hasText: 'Beta' })
          await expect(row).toHaveClass(/pulse/)
          // Lit: the hover look (the highlight, the ink in acc-ink).
          await expect(row).toHaveAttribute('data-flash', '')
          expect(await style(row, ['background-color', 'color'])).toEqual({ 'background-color': css(r.acc), color: css(r['acc-ink']) })
          expect((await style(row.locator('.title'), ['color'])).color).toBe(css(r['acc-ink']))

          await expect.poll(() => page.evaluate(() => (window as unknown as { __pulse: Array<[number, string]> }).__pulse.at(-1)![1]), { timeout: 5000 }).toBe('plain')
          const log = await page.evaluate(() => (window as unknown as { __pulse: Array<[number, string]> }).__pulse)
          const from = log.findIndex(([, state]) => state === 'pulse+lit')
          const seq = log.slice(from)
          const t0 = seq[0]![0]
          const rel = seq.map(([t, state]) => [Math.round((t - t0) / 40) * 40, state] as const)
          if (reduced) {
            expect(seq.map(([, s]) => s), 'steady: lit, then over').toEqual(['pulse+lit', 'plain'])
            expect(Math.abs(rel[1]![0] - 2000), 'for 2s').toBeLessThanOrEqual(240)
          } else {
            expect(seq.map(([, s]) => s)).toEqual(['pulse+lit', 'pulse', 'pulse+lit', 'pulse', 'pulse+lit', 'pulse', 'plain'])
            const steps = rel.map(([t]) => t)
            for (const [i, want] of [0, 320, 640, 960, 1280, 1600, 2000].entries()) expect(Math.abs(steps[i]! - want), `step ${i} at ${want}ms`).toBeLessThanOrEqual(160)
          }
        } finally {
          await page.request.delete(`/api/lists/${id}`)
        }
      })
    }
  })
}
