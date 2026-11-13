import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng, type Pixels } from './pngPixels.js'

/**
 * eX-Zed's search results (51.8, X-007; design's Row card and the New List board), on the real screen, in both engines and all six skins. **A result is a two-line row (the name over its detail, 8px
 * apart) with the board's chevron, 8px of padding round it and 16px between its parts, and its count in a 200px column on the right (the number and a dim ITEMS); hover fills it with the highlight and
 * turns its text `acc-ink`; open, the details sit 32px in under a 2px `frame` rule on their left, in 16px text on 24px leading; no row has a rule under it.**
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
type Rgb = [number, number, number]
const CLOSED = 'M2 1h1v1H2zM3 2h1v1H3zM4 3h1v2H4zM3 5h1v1H3zM2 6h1v1H2z'
const OPEN = 'M1 2h1v1H1zM2 3h1v1H2zM3 4h2v1H3zM5 3h1v1H5zM6 2h1v1H6z'

async function openResults(page: Page, skin: string) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.route('**/api/media-types/music/search**', (route) =>
    route.fulfill({ json: { sources: [{ externalRef: 'sr-1', title: 'Result one', detail: 'Group · XX', itemCount: 7, description: 'A description of the first result.' }, { externalRef: 'sr-2', title: 'Result two', detail: 'Group · YY', itemCount: 3 }] } }),
  )
  await page.route('**/api/media-types/music/expansion**', (route) => route.fulfill({ json: { itemCount: 7 } }))
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
  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: 'Music' }).click()
  await expect(page.getByRole('tab', { name: 'Search', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Search MusicBrainz or List Vault', { exact: true }).fill('result')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('.q-result').first().waitFor()
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
  })
}

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgbOf = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const css = (c: Rgb) => `rgb(${c.join(', ')})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)
function at(pixels: Pixels, scale: number, x: number, y: number): Rgb {
  const i = (Math.floor(y * scale + scale / 2) * pixels.width + Math.floor(x * scale + scale / 2)) * 4

  return [pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!]
}
const cells = (path: string) => {
  const filled = new Set<string>()
  for (const [, x, y, w, h] of path.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)H\d+z/g)) for (let dx = 0; dx < Number(w); dx++) for (let dy = 0; dy < Number(h); dy++) filled.add(`${Number(x) + dx},${Number(y) + dy}`)

  return filled
}
async function readIcon(page: Page, target: Locator, path: string, colour: Rgb, label: string) {
  const b = (await target.boundingBox())!
  expect([b.width, b.height], `${label}: 16px`).toEqual([16, 16])
  const pixels = decodePng(await page.screenshot({ clip: { x: Math.round(b.x), y: Math.round(b.y), width: 16, height: 16 } }))
  const scale = pixels.width / 16
  for (const key of cells(path)) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    expect(at(pixels, scale, x * 2 + 0.5, y * 2 + 0.5), `${label}: cell ${key}`).toEqual(colour)
  }
}

for (const skin of SKINS) {
  test(`${skin}: a result is a flat two-line row with the board's chevron and its count in a 200px column; hover is the highlight; open, the details are 32px in under a 2px frame rule`, async ({ page }) => {
    await openResults(page, skin)
    const [ink, ink2, frame, acc, accInk] = (await Promise.all(['--zx-ink', '--zx-ink2', '--zx-frame', '--zx-acc', '--zx-acc-ink'].map((n) => token(page, n)))).map((hex) => rgbOf(hex))
    await page.mouse.move(0, 0)

    const row = page.locator('.q-result').first()
    expect(await style(row, ['padding-top', 'padding-right', 'padding-left', 'column-gap', 'border-bottom-width']), 'a row: 8px, 16px between parts, no rule').toEqual({
      'padding-top': '8px',
      'padding-right': '16px',
      'padding-left': '8px',
      'column-gap': '16px',
      'border-bottom-width': '0px',
    })
    expect(await style(row.locator('.title'), ['color', 'font-size', 'font-weight'])).toEqual({ color: css(ink!), 'font-size': '16px', 'font-weight': '400' })
    expect(await style(row.locator('.meta'), ['color', 'font-size', 'margin-top'])).toEqual({ color: css(ink2!), 'font-size': '16px', 'margin-top': '8px' })
    const count = row.locator('.n')
    expect((await style(count, ['width', 'font-size']))).toEqual({ width: '200px', 'font-size': '16px' })
    expect((await style(count.locator('.q-kicker'), ['color']))['color'], 'ITEMS is dim').toBe(css(ink2!))

    // The chevron: the board's, 16px, in the row's ink; right while shut.
    await readIcon(page, row.locator('.chev'), CLOSED, ink!, 'the shut result’s chevron')

    // Hover: the highlight and acc-ink text.
    await row.hover({ position: { x: 400, y: 20 } })
    expect(await style(row, ['background-color', 'color'])).toEqual({ 'background-color': css(acc!), color: css(accInk!) })
    expect((await style(row.locator('.meta'), ['color'])).color).toBe(css(accInk!))
    await page.mouse.move(0, 0)

    // Open: the chevron turns down; the details are 32px in, a 2px frame rule at their left, 16px text on 24px leading.
    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await page.mouse.move(0, 0)
    await readIcon(page, row.locator('.chev'), OPEN, ink!, 'the open result’s chevron')
    const more = page.locator('.q-result-more').first()
    expect(await style(more, ['margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'border-left-width', 'border-left-style', 'border-left-color', 'border-bottom-width'])).toEqual({
      'margin-left': '32px',
      'padding-top': '8px',
      'padding-right': '16px',
      'padding-bottom': '16px',
      'border-left-width': '2px',
      'border-left-style': 'solid',
      'border-left-color': css(frame!),
      'border-bottom-width': '0px',
    })
    expect(await style(more.locator('.desc'), ['font-size', 'line-height', 'color'])).toEqual({ 'font-size': '16px', 'line-height': '24px', color: css(ink!) })
    expect(await style(more.locator('.prov'), ['font-size', 'line-height', 'color'])).toEqual({ 'font-size': '16px', 'line-height': '24px', color: css(ink2!) })
  })
}
