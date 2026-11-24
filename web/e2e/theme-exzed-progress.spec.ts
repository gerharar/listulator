import { readFileSync } from 'node:fs'
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { decodePng } from './pngPixels.js'

/**
 * The progress bar in eX-Zed (57.11a; X-008 and the ProgressBar card, with D22), on the real screens, in both engines and all six skins. One fixed-width bar for every list: 20 steps of 5% (`floor(done / total x 20)`, at
 * least one once started, at most 19 until done), a 2px black frame (`chip-ink`) round a 160 by 16 inside (8px a step) on a Home row and a group head, and 320 by 24 (16px a step) in the list header; the fill is solid
 * `prog`, the rest a 2px dither of `prog-dim` and `paper` (D22: Glemt's 1.4:1 is fixed by texture, not by colour). The percentage is 8px after it, 4 characters right-aligned, 16px, and stays `ink` at 100%. Read in pixels:
 * every 2px cell of the inside is named and compared. The finished bar (57.11b) is the four-band stripe, read cell by cell against design's two SVG files themselves (`art/finished-bar-*.svg`, byte for byte), in the Home row, the
 * list header and a group head; a bar that BECOMES finished shows one 320ms FLASH step (`acc` over the whole inside) before it, and none under reduced motion or when it is drawn finished.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
type Rgb = [number, number, number]

async function seed(page: Page, skin: string, reducedMotion = 'true') {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion, theme: 'exzed', exzedSkin: skin }))
}

async function makeList(request: APIRequestContext, title: string, count: number, done: number): Promise<string> {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'movie', status: 'ongoing' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items: Array.from({ length: count }, (_, n) => ({ title: `Item ${n + 1}`, timeToConsumeMinutes: 61, group: 'S1' })) } })
  const items = ((await (await request.get(`/api/lists/${list.id}`)).json()).items as Array<{ id: string }>).slice(0, done)
  for (let from = 0; from < items.length; from += 25) await Promise.all(items.slice(from, from + 25).map((item) => request.put(`/api/lists/${list.id}/items/${item.id}/consumed`, { data: { consumed: true } })))

  return list.id as string
}

const rgbOf = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const luminance = ([r, g, b]: Rgb) => 0.2126 * (r / 255) ** 2.2 + 0.7152 * (g / 255) ** 2.2 + 0.0722 * (b / 255) ** 2.2
const contrast = (a: Rgb, b: Rgb) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)

/** Every 2px cell of the bar's inside, read from a screenshot of the bar: its colour, row by row. */
async function cells(bar: Locator, frame: number, width: number, height: number): Promise<Rgb[][]> {
  const box = (await bar.boundingBox())!
  const png = decodePng(await bar.screenshot())
  const scale = png.width / box.width
  const at = (x: number, y: number): Rgb => {
    const i = (Math.round(y * scale) * png.width + Math.round(x * scale)) * 4

    return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!]
  }

  return Array.from({ length: height / 2 }, (_, row) => Array.from({ length: width / 2 }, (_, col) => at(frame + col * 2 + 1, frame + row * 2 + 1)))
}

/** WebKit draws the conic gradient's cells with a channel or two of noise (1,0,1 for black); the cells are 2px apart in colours that are at least 40 steps apart. */
const same = (a: Rgb, b: Rgb) => a.every((channel, n) => Math.abs(channel - b[n]!) <= 3)

/** Names the inside of a bar of `steps` filled steps: the fill solid `prog`; the rest the 2px checker of `prog-dim` (the cell right of or under a `paper` one) and `paper`, as the card's tile starts at the inside's corner. */
function expectBar(read: Rgb[][], step: number, steps: number, roles: { prog: Rgb; dim: Rgb; paper: Rgb }, what: string) {
  const bad: string[] = []
  read.forEach((line, row) =>
    line.forEach((got, col) => {
      const want = col * 2 < steps * step ? roles.prog : (col + row) % 2 === 1 ? roles.dim : roles.paper
      if (!same(got, want)) bad.push(`(${col},${row}) got ${got} want ${want}`)
    }),
  )
  expect(bad.slice(0, 5), `${what}: ${bad.length} of ${read.length * read[0]!.length} cells are wrong`).toEqual([])
}

const frameOf = (bar: Locator) => bar.evaluate((el) => { const s = getComputedStyle(el); return { width: s.borderTopWidth, style: s.borderTopStyle, colour: s.borderTopColor } })

for (const skin of SKINS) {
  test(`${skin}: a Home row's bar is 160 by 16 in a 2px frame, 8px a step: 0, 1 step when started, 8 of 20, 19 until done; the percentage is 8px after it`, async ({ page }) => {
    const stamp = `${skin}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const made = {
      none: [`Prog none ${stamp}`, 7, 0],
      first: [`Prog first ${stamp}`, 300, 1],
      third: [`Prog third ${stamp}`, 7, 3],
      almost: [`Prog almost ${stamp}`, 300, 299],
    } as const
    const ids = await Promise.all(Object.values(made).map(([title, count, done]) => makeList(page.request, title, count, done)))
    try {
      await seed(page, skin)
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: made.none[0] }).waitFor()
      await page.evaluate(() => document.fonts.ready)
      const roles = { prog: rgbOf(await token(page, '--zx-prog')), dim: rgbOf(await token(page, '--zx-prog-dim')), paper: rgbOf(await token(page, '--zx-paper')) }
      const chipInk = rgbOf(await token(page, '--zx-chip-ink'))
      expect(contrast(roles.prog, roles.paper), 'the fill reads against the paper (D22)').toBeGreaterThanOrEqual(3)

      for (const [kind, steps] of [['none', 0], ['first', 1], ['third', 8], ['almost', 19]] as const) {
        const row = page.locator('.q-home-row', { hasText: made[kind][0] })
        const bar = row.locator('.q-meter')
        const box = (await bar.boundingBox())!
        expect([box.width, box.height], `${kind}: 160 by 16 inside a 2px frame`).toEqual([164, 20])
        expect(await frameOf(bar), `${kind}: the frame`).toEqual({ width: '2px', style: 'solid', colour: `rgb(${chipInk.join(', ')})` })
        expect(await bar.evaluate((el) => getComputedStyle(el).maskImage), `${kind}: no cells cut by a mask`).toBe('none')
        expectBar(await cells(bar, 2, 160, 16), 8, steps, roles, kind)
        const pct = (await row.locator('.q-pct').boundingBox())!
        expect(pct.x - (box.x + box.width), `${kind}: 8px between the bar and the percentage`).toBe(8)
      }
    } finally {
      await Promise.all(ids.map((id) => page.request.delete(`/api/lists/${id}`)))
    }
  })

  test(`${skin}: the list header's bar is 320 by 24 in a 2px frame, 16px a step, and a group head's is the row size`, async ({ page }) => {
    const title = `Prog header ${skin}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const id = await makeList(page.request, title, 7, 3)
    try {
      await seed(page, skin)
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-item').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      const roles = { prog: rgbOf(await token(page, '--zx-prog')), dim: rgbOf(await token(page, '--zx-prog-dim')), paper: rgbOf(await token(page, '--zx-paper')) }

      const header = page.locator('.q-progress.header .q-meter')
      const box = (await header.boundingBox())!
      expect([box.width, box.height], 'the header bar: 320 by 24 inside the frame').toEqual([324, 28])
      expectBar(await cells(header, 2, 320, 24), 16, 8, roles, 'the header bar')

      // The line is as tall as its bar (28px), so no part of it sits on a half pixel (the dot's own line was 23.188px high and its box fell on .406).
      const parts = await page.locator('.q-progress.header > *').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [el.className, r.top % 1, r.height % 1] }))
      expect(parts.filter(([, top, height]) => top !== 0 || height !== 0), 'every part of the header line is on whole pixels').toEqual([])

      const group = page.locator('.q-group .q-meter').first()
      const small = (await group.boundingBox())!
      expect([small.width, small.height], 'the group head: the row size').toEqual([164, 20])
      expectBar(await cells(group, 2, 160, 16), 8, 8, roles, 'the group head')
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })

  test(`${skin}: a finished list's percentage stays ink (there is no gold in eX-Zed)`, async ({ page }) => {
    const title = `Prog done ${skin}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const id = await makeList(page.request, title, 4, 4)
    try {
      await seed(page, skin)
      await page.goto('/')
      const pct = page.locator('.q-home-row', { hasText: title }).locator('.q-pct')
      await expect(pct).toHaveText('100%')
      const ink = rgbOf(await token(page, '--zx-ink'))
      expect(await pct.evaluate((el) => getComputedStyle(el).color)).toBe(`rgb(${ink.join(', ')})`)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}

/** design's finished bar, read from the file the app draws: the colour of the 2px cell at (col, row). */
function stripeOf(file: string): Rgb[][] {
  const svg = readFileSync(new URL(`../src/styles/theme/art/${file}`, import.meta.url), 'utf8')
  const width = Number(/width="(\d+)"/.exec(svg)![1])
  const height = Number(/height="(\d+)"/.exec(svg)![1])
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="\d+" fill="(#[0-9a-f]{6})"><\/rect>/g)].map((m) => ({ x: +m[1]!, y: +m[2]!, width: +m[3]!, fill: rgbOf(m[4]!) }))

  return Array.from({ length: height / 2 }, (_, row) => Array.from({ length: width / 2 }, (_, col) => rects.find((rect) => rect.y === row * 2 && col * 2 >= rect.x && col * 2 < rect.x + rect.width)!.fill))
}

function expectCells(read: Rgb[][], want: Rgb[][], what: string) {
  const bad: string[] = []
  want.forEach((line, row) =>
    line.forEach((cell, col) => {
      if (!same(read[row]![col]!, cell)) bad.push(`(${col},${row}) got ${read[row]![col]} want ${cell}`)
    }),
  )
  expect(bad.slice(0, 5), `${what}: ${bad.length} of ${want.length * want[0]!.length} cells are wrong`).toEqual([])
}

const SMALL = stripeOf('finished-bar-160x16.svg')
const LARGE = stripeOf('finished-bar-320x24.svg')

for (const skin of SKINS) {
  test(`${skin}: a finished list's bar is the four-band stripe, never solid ok: the Home row (160 by 16), the header (320 by 24) and the group head`, async ({ page }) => {
    const title = `Prog stripe ${skin}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const id = await makeList(page.request, title, 4, 4)
    try {
      await seed(page, skin)
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: title }).waitFor()
      await page.evaluate(() => document.fonts.ready)
      const chipInk = rgbOf(await token(page, '--zx-chip-ink'))

      const home = page.locator('.q-home-row', { hasText: title }).locator('.q-meter')
      expect(await frameOf(home), 'the frame stays 2px chip-ink').toEqual({ width: '2px', style: 'solid', colour: `rgb(${chipInk.join(', ')})` })
      expectCells(await cells(home, 2, 160, 16), SMALL, 'the Home row')
      expect(await page.locator('.q-home-row', { hasText: title }).locator('.q-meter').evaluate((el) => getComputedStyle(el).animationName), 'a bar drawn finished does not flash').toBe('none')

      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-item').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      expectCells(await cells(page.locator('.q-progress.header .q-meter'), 2, 320, 24), LARGE, 'the list header')
      expectCells(await cells(page.locator('.q-group .q-meter').first(), 2, 160, 16), SMALL, 'the group head')
      expect(await page.locator('[data-just-finished]').count(), 'nothing flashes when a list is opened finished').toBe(0)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}

for (const skin of ['exzed-1d', 'exzed-1l'] as const) {
  test(`${skin}: the bar that becomes finished shows one FLASH step (acc over the whole inside, 320ms), then the stripe`, async ({ page }) => {
    const title = `Prog flash ${skin}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const id = await makeList(page.request, title, 2, 1)
    try {
      await seed(page, skin, 'false')
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-item').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      const acc = rgbOf(await token(page, '--zx-acc'))
      const group = page.locator('.q-group .q-meter').first()
      const header = page.locator('.q-progress.header .q-meter')
      expect(await page.locator('[data-just-finished]').count(), 'not finished yet: no mark').toBe(0)

      await page.locator('.q-item', { hasText: 'Item 2' }).getByRole('checkbox').click()
      await expect(group).toHaveAttribute('data-just-finished', '')
      await expect(header).toHaveAttribute('data-just-finished', '')

      // Hold the animation at its middle, so the pixels are read in the step and not by a race.
      const held = await group.evaluate((el) => {
        const flash = el.getAnimations().find((a) => (a as CSSAnimation).animationName === 'zx-bar-flash')
        if (!flash) return null
        flash.pause()
        flash.currentTime = 160

        return { duration: flash.effect!.getTiming().duration, easing: getComputedStyle(el).animationTimingFunction, iterations: flash.effect!.getTiming().iterations }
      })
      expect(held, 'the flash is one 320ms step, once').toEqual({ duration: 320, easing: expect.stringMatching(/^steps\(1(, end)?\)$/), iterations: 1 })
      expectCells(await cells(group, 2, 160, 16), SMALL.map((line) => line.map(() => acc)), 'in the step: the inside is acc')

      await group.evaluate((el) => el.getAnimations().forEach((a) => a.finish()))
      expectCells(await cells(group, 2, 160, 16), SMALL, 'after the step: the stripe')
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}

test('the finishing step has no flash under reduced motion: the stripe at once', async ({ page }) => {
  const title = `Prog calm ${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const id = await makeList(page.request, title, 2, 1)
  try {
    await seed(page, 'exzed-1d', 'true')
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.locator('.q-item').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    await page.locator('.q-item', { hasText: 'Item 2' }).getByRole('checkbox').click()
    const group = page.locator('.q-group .q-meter').first()
    await expect(group).toHaveAttribute('data-just-finished', '')
    expect(await group.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
    expectCells(await cells(group, 2, 160, 16), SMALL, 'the stripe, at once')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

