import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { decodePng } from './pngPixels.js'

/**
 * The progress bar in eX-Zed (57.11a; X-008 and the ProgressBar card, with D22), on the real screens, in both engines and all six skins. One fixed-width bar for every list: 20 steps of 5% (`floor(done / total x 20)`, at
 * least one once started, at most 19 until done), a 2px black frame (`chip-ink`) round a 160 by 16 inside (8px a step) on a Home row and a group head, and 320 by 24 (16px a step) in the list header; the fill is solid
 * `prog`, the rest a 2px dither of `prog-dim` and `paper` (D22: Glemt's 1.4:1 is fixed by texture, not by colour). The percentage is 8px after it, 4 characters right-aligned, 16px, and stays `ink` at 100%. Read in pixels:
 * every 2px cell of the inside is named and compared. (The finished bar's four-band stripe is 57.11b's; what a finished bar draws until then is not read here, only its percentage.)
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
type Rgb = [number, number, number]

async function seed(page: Page, skin: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin }))
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
