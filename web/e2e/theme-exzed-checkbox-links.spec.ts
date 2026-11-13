import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng, type Pixels } from './pngPixels.js'

/**
 * eX-Zed's checkbox and links (51.5, X-007; design's Checkbox and Link cards, answers D6 and 13), on the real screens, in both engines and all six skins, read in pixels:
 * **the done box is 16px with a 2px `frame` border on `paper`, a 2px `chip-ink` cell outside it and a 6x6 pixel tick (2px cells) in `ink`; a group whose items are some done draws an
 * 8x2 dash in `ink`, centred; a done item's title is `ink2` with a 2px line through it; Settings' checkboxes are the native input drawn as the same box; the disabled one (Show Spectrum
 * border on Lotus) keeps its place with a dotted `ink2` border, its tick (the stored value) in `ink2`, its label `ink2`, `not-allowed`, no hover and no outline round the row; a link is
 * the surrounding colour with a dotted 2px underline, the highlight on hover, and external links end with the pixel ↗.**
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
/** The card's tick, on its 6x6 grid (each cell 2 CSS pixels), and the ↗ on its 8x8. */
const TICK: readonly [number, number][] = [[5, 0], [4, 1], [3, 2], [0, 2], [1, 3], [2, 3]]
const ARROW: readonly [number, number][] = [[3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [7, 1], [7, 2], [7, 3], [7, 4], [6, 1], [5, 2], [4, 3], [3, 4], [2, 5], [1, 6]]

async function boot(page: Page, skin: string) {
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

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const css = (hex: string) => `rgb(${rgbOf(hex).join(', ')})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)

async function roles(page: Page) {
  const [frame, ink, ink2, paper, chipInk, acc, accInk] = await Promise.all(['--zx-frame', '--zx-ink', '--zx-ink2', '--zx-paper', '--zx-chip-ink', '--zx-acc', '--zx-acc-ink'].map((n) => token(page, n)))

  return { frame: rbg(frame), ink: rbg(ink), ink2: rbg(ink2), paper: rbg(paper), chipInk: rbg(chipInk), acc: acc!, accInk: accInk! }
}
const rbg = (hex: string | undefined) => rgbOf(hex!)
type Roles = Awaited<ReturnType<typeof roles>>

/** The colour at a point given in CSS pixels from the clip's top left. */
function at(pixels: Pixels, scale: number, x: number, y: number): [number, number, number] {
  const i = (Math.floor(y * scale + scale / 2) * pixels.width + Math.floor(x * scale + scale / 2)) * 4

  return [pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!]
}
async function shoot(page: Page, box: { x: number; y: number; width: number; height: number }, pad: number) {
  const clip = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
  const pixels = decodePng(await page.screenshot({ clip }))

  return { pixels, scale: pixels.width / clip.width }
}

/** Reads a 16px done box and its 2px cell: the ring, the border, the 12px inside (paper, and the tick or dash where drawn). */
async function readBox(page: Page, box: Locator, r: Roles, label: string, mark: 'none' | 'tick' | 'dash') {
  await page.mouse.move(0, 0)
  const b = (await box.boundingBox())!
  expect([b.width, b.height], `${label}: 16px`).toEqual([16, 16])
  const { pixels, scale } = await shoot(page, b, 2)
  const p = (x: number, y: number) => at(pixels, scale, x, y)
  // The clip starts 2px outside the box: its ring is pixels 0-1, the border 2-3, the inside 4-15.
  expect(p(0.5, 10), `${label}: the 2px cell, outside`).toEqual(r.chipInk)
  expect(p(2.5, 10), `${label}: the border`).toEqual(r.frame)
  expect(p(9, 17), `${label}: the border, below`).toEqual(r.frame)
  const inside = (cx: number, cy: number) => p(4 + cx * 2 + 1, 4 + cy * 2 + 1)
  if (mark === 'tick') {
    for (const [x, y] of TICK) expect(inside(x, y), `${label}: tick cell ${x},${y} in ink`).toEqual(r.ink)
    for (const [x, y] of [[0, 0], [1, 0], [5, 5], [0, 5], [4, 4], [5, 3]] as const) expect(inside(x, y), `${label}: cell ${x},${y} is paper`).toEqual(r.paper)
  } else if (mark === 'dash') {
    // 8x2 at the inside's centre: x 2 to 9, y 5 and 6 (in CSS pixels from the inside's corner).
    const px = (x: number, y: number) => p(4 + x, 4 + y)
    for (const x of [2, 5, 9]) for (const y of [5, 6]) expect(px(x, y), `${label}: dash at ${x},${y}`).toEqual(r.ink)
    for (const [x, y] of [[1, 5], [10, 5], [5, 4], [5, 7], [0, 0]] as const) expect(px(x, y), `${label}: ${x},${y} is paper`).toEqual(r.paper)
  } else {
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) expect(inside(x, y), `${label}: empty cell ${x},${y}`).toEqual(r.paper)
  }
}

async function makeList(page: Page) {
  const title = `Checks ${test.info().project.name} ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  const items = ['Alpha', 'Beta', 'Gamma'].map((name, n) => ({ title: name, timeToConsumeMinutes: 30, group: n < 2 ? 'Season 1' : 'Season 2' }))
  await page.request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return { id: list.id as string, title }
}

for (const skin of SKINS) {
  test(`${skin}: the list's done box is the card's 16px box with its cell, the tick and the dash drawn in pixels; a done title is ink2 with a 2px line`, async ({ page }) => {
    const list = await makeList(page)
    try {
      await boot(page, skin)
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: list.title }).click()
      await page.locator('.q-group').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      const r = await roles(page)

      const first = page.locator('.q-item').first().locator('.q-done > span')
      await readBox(page, first, r, 'an item box, undone', 'none')
      await page.locator('.q-item').first().locator('.q-done').click()
      await expect(page.locator('.q-item').first().locator('.q-done')).toHaveAttribute('aria-checked', 'true')
      await readBox(page, first, r, 'an item box, done', 'tick')

      // The title: ink2 and a 2px line through it, no lighter weight.
      const title = page.locator('.q-item').first().locator('.title')
      expect(await style(title, ['color', 'text-decoration-line', 'text-decoration-thickness', 'font-weight'])).toEqual({
        color: css('#' + r.ink2.map((n) => n.toString(16).padStart(2, '0')).join('')),
        'text-decoration-line': 'line-through',
        'text-decoration-thickness': '2px',
        'font-weight': '400',
      })

      // The first group has two items, one done: "some".
      const head = page.locator('.q-group').first().locator('.q-done')
      await expect(head).toHaveAttribute('aria-checked', 'mixed')
      await readBox(page, head.locator('> span'), r, 'a group box, some done', 'dash')
    } finally {
      await page.request.delete(`/api/lists/${list.id}`)
    }
  })

  test(`${skin}: Settings' checkboxes are the native input drawn as the box (cell, tick, label ink, hover highlight); the disabled one is dotted with an ink2 tick and label`, async ({ page }) => {
    await boot(page, skin)
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('label.q-settings-check').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const r = await roles(page)

    const reduce = page.locator('label.q-settings-check input').first()
    expect(await reduce.evaluate((el) => (el as HTMLInputElement).type), 'still the native input').toBe('checkbox')
    expect(await reduce.isChecked(), 'Reduce animation motion is on in this run').toBe(true)
    await readBox(page, reduce, r, 'Reduce animation motion (checked)', 'tick')
    const unchecked = page.locator('label.q-settings-check input:not(:checked):not(:disabled)').first()
    await readBox(page, unchecked, r, 'an unchecked setting', 'none')

    // The label is ink, and the whole line takes the highlight on hover.
    const label = page.locator('label.q-settings-check').first()
    await page.mouse.move(0, 0)
    expect((await style(label, ['color', 'gap', 'padding-left']))).toEqual({ color: css('#' + r.ink.map((n) => n.toString(16).padStart(2, '0')).join('')), gap: '16px', 'padding-left': '8px' })
    await label.hover()
    expect(await style(label, ['background-color', 'color'])).toEqual({ 'background-color': css(r.acc), color: css(r.accInk) })
    await page.mouse.move(0, 0)

    // Show Spectrum border: disabled on Lotus only.
    const border = page.locator('label.q-settings-check', { hasText: 'Spectrum' })
    const input = border.locator('input')
    if (skin !== 'exzed-1l') {
      expect(await input.isDisabled()).toBe(false)

      return
    }
    expect(await input.isDisabled(), 'disabled on Lotus').toBe(true)
    expect(await input.isChecked(), 'the stored value is on').toBe(true)
    const b = (await input.boundingBox())!
    expect([b.width, b.height], 'the box keeps its size').toEqual([16, 16])
    expect(await style(border, ['cursor', 'outline-style', 'color']), 'the row: not-allowed, no outline, ink2').toEqual({ cursor: 'not-allowed', 'outline-style': 'none', color: css('#' + r.ink2.map((n) => n.toString(16).padStart(2, '0')).join('')) })
    await page.mouse.move(0, 0)
    const { pixels, scale } = await shoot(page, b, 2)
    const p = (x: number, y: number) => at(pixels, scale, x, y)
    // The border is the dotted `ink2` line: dashes of 2px with 2px gaps, from the box's corner (the clip's 2px in).
    expect([p(2.5, 2.5), p(4.5, 2.5), p(6.5, 2.5), p(8.5, 2.5)], 'the top edge: dash, gap, dash, gap').toEqual([r.ink2, r.paper, r.ink2, r.paper])
    expect([p(2.5, 4.5), p(2.5, 6.5)], 'the left edge: gap, dash').toEqual([r.paper, r.ink2])
    for (const [x, y] of TICK) expect(p(4 + x * 2 + 1, 4 + y * 2 + 1), `the tick cell ${x},${y} is ink2`).toEqual(r.ink2)
    await border.hover()
    expect((await style(border, ['background-color']))['background-color'], 'no hover on a disabled row').toBe('rgba(0, 0, 0, 0)')
  })

  test(`${skin}: About's links are the surrounding colour with a dotted 2px underline, the highlight on hover, and end with the pixel ↗`, async ({ page }) => {
    await boot(page, skin)
    await page.goto('/')
    await page.getByRole('button', { name: 'About', exact: true }).click()
    await page.locator('.q-about-link').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const r = await roles(page)

    for (const selector of ['.q-about-credit-link', '.q-about-link']) {
      const link = page.locator(selector).first()
      const own = await link.evaluate((el) => {
        const css = getComputedStyle(el)
        const parent = getComputedStyle(el.parentElement!)

        return { color: css.color, parent: parent.color, line: css.textDecorationLine, padding: css.paddingBottom, image: css.backgroundImage.includes('repeating-linear-gradient'), size: css.backgroundSize }
      })
      expect(own.color, `${selector}: the surrounding colour`).toBe(own.parent)
      expect([own.line, own.padding, own.image, own.size], `${selector}: no underline of the browser's, a dotted 2px one drawn`).toEqual(['none', '4px', true, '100% 2px'])

      const icon = link.locator('> span[aria-hidden="true"]')
      expect(await style(icon, ['width', 'height', 'vertical-align']), `${selector}: the ↗ is 16px, 2px below the baseline`).toMatchObject({ width: '16px', height: '16px', 'vertical-align': '-2px' })
      await page.mouse.move(0, 0)
      const ib = (await icon.boundingBox())!
      const { pixels, scale } = await shoot(page, ib, 0)
      const colour = await link.evaluate((el) => getComputedStyle(el).color)
      const want = colour.match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number]
      for (const [x, y] of ARROW) expect(at(pixels, scale, x * 2 + 1, y * 2 + 1), `${selector}: ↗ cell ${x},${y} in the link's colour`).toEqual(want)
      for (const [x, y] of [[0, 0], [0, 7], [1, 0], [2, 1]] as const) expect(at(pixels, scale, x * 2 + 1, y * 2 + 1), `${selector}: ↗ cell ${x},${y} is empty`).not.toEqual(want)

      // The text is the Spectrum font at its body size (16px, no weight: found by the owner at Checkpoint G2, where Quantum's 12.5px and 500 had been left on it), and the ↗ stays inside the link's box,
      // so the highlight is under all of it (it had hung below the box, black ink on a black page).
      expect(await style(link, ['font-size', 'font-weight']), `${selector}: 16px, regular`).toEqual({ 'font-size': '16px', 'font-weight': '400' })
      const box = (await link.boundingBox())!
      expect(ib.y, `${selector}: the ↗ starts inside the link's box`).toBeGreaterThanOrEqual(box.y)
      expect(ib.y + ib.height, `${selector}: the ↗ ends inside the link's box`).toBeLessThanOrEqual(box.y + box.height)
      expect(ib.x + ib.width, `${selector}: the ↗ ends inside the link's box, to the right`).toBeLessThanOrEqual(box.x + box.width)

      await link.hover()
      expect(await style(link, ['background-color', 'color']), `${selector}: hover is the highlight`).toEqual({ 'background-color': css(r.acc), color: css(r.accInk) })
      const lit = await shoot(page, ib, 0)
      expect(at(lit.pixels, lit.scale, 0.5, 14.5), `${selector}: the highlight is under the ↗'s empty corner`).toEqual(rbg(r.acc))
      for (const [x, y] of ARROW) expect(at(lit.pixels, lit.scale, x * 2 + 1, y * 2 + 1), `${selector}: ↗ cell ${x},${y} in the highlight's ink`).toEqual(rbg(r.accInk))
      await page.mouse.move(0, 0)
    }
  })
}
