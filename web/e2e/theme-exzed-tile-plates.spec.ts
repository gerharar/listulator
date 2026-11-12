import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng } from './pngPixels.js'

/**
 * The plates behind a Choose Your Fighter tile's text (50.12, X-006), in both engines. The board gives every text group of a tile (`.lab`: the name with its count chip, the
 * "free key needed" chip, the source line) the paper as its ground, so the words never sit on the banner; padding 2px 4px 2px 2px; on hover the plate is the accent. Quantum
 * has none. The plate hugs its words (the board's tile is a column with `align-items: flex-start`).
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

async function boot(page: Page, { skin = 'exzed-1d', theme = 'exzed' } = {}) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  // No list: the first run's picker is the base layer.
  await page.route('**/api/lists', (route) => route.fulfill({ json: [] }))
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
  await page.locator('.q-picker').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('.q-tile')).toHaveCount(12)
}

const tileOf = (page: Page, art: string) => page.locator('.q-tile', { has: page.locator(`.q-catbanner[data-art="${art}"]`) })
const tokens = (page: Page) => page.evaluate(() => ['--zx-paper', '--zx-acc', '--zx-acc-ink'].map((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()))
const styleOf = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element)

    return { background: style.backgroundColor, color: style.color, padding: style.padding, width: element.getBoundingClientRect().width }
  })
const rgb = (hex: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new Error(`not a colour: ${hex}`)

  return `rgb(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)})`
}

/** Pixels in the element's box (a pixel in from each edge: an engine snaps a fractional edge) that are not `ground`, with the words made invisible so only the plate and what shows through it count. */
async function notGround(page: Page, locator: Locator, ground: string) {
  const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(ground)!
  const want = [Number(m[1]), Number(m[2]), Number(m[3])]
  const r = await page.evaluate(() => window.devicePixelRatio)
  const box = await locator.evaluate((element) => element.getBoundingClientRect().toJSON() as { left: number; top: number; right: number; bottom: number })
  const x0 = Math.ceil(box.left) + 1
  const y0 = Math.ceil(box.top) + 1
  const clip = { x: x0, y: y0, width: Math.floor(box.right) - 1 - x0, height: Math.floor(box.bottom) - 1 - y0 }
  const seen = decodePng(await page.screenshot({ clip }))
  expect(seen.width, 'the screenshot is the clip at the device ratio').toBe(clip.width * r)
  let different = 0
  for (let i = 0; i < seen.width * seen.height; i++) {
    if (seen.data[i * 4] !== want[0] || seen.data[i * 4 + 1] !== want[1] || seen.data[i * 4 + 2] !== want[2]) different++
  }

  return different
}

const WORDS_GONE = '.q-tile-name b, .q-tile-src, .q-count-chip, .q-key-chip { color: transparent !important }'

test.describe('the tile text plates', () => {
  test('the name and the source line each sit on a paper plate with the board’s padding, hugging the words, not the tile’s width', async ({ page }) => {
    await boot(page)
    const [paper] = await tokens(page)
    const tile = tileOf(page, 'games')
    for (const part of ['.q-tile-name', '.q-tile-src']) {
      const plate = await styleOf(tile.locator(part))
      expect(plate.background, `${part}: the plate is the paper`).toBe(rgb(paper!))
      expect(plate.padding, `${part}: the board's padding`).toBe('2px 4px 2px 2px')
      expect(plate.width, `${part}: it hugs its words`).toBeLessThan(150)
    }
  })

  test('the plate hides the banner: with the words made invisible, every pixel of the plate is the paper, and without the plate the banner shows there', async ({ page }) => {
    await boot(page)
    await page.addStyleTag({ content: WORDS_GONE })
    const [paper] = await tokens(page)
    // YouTube's banner fills its whole tile; Games' fills the bottom, where the source line is.
    for (const [art, part] of [['youtube', '.q-tile-name'], ['games', '.q-tile-src']] as const) {
      const plate = tileOf(page, art).locator(part)
      await plate.scrollIntoViewIfNeeded()
      expect(await notGround(page, plate, rgb(paper!)), `${art} ${part}: pixels that are not the paper`).toBe(0)
    }

    // The same boxes with their ground taken away show the picture: the test sees what it is meant to hide.
    await page.addStyleTag({ content: '.q-tile-name, .q-tile-src { background: transparent !important }' })
    for (const [art, part] of [['youtube', '.q-tile-name'], ['games', '.q-tile-src']] as const) {
      expect(await notGround(page, tileOf(page, art).locator(part), rgb(paper!)), `${art} ${part}: the banner shows without the plate`).toBeGreaterThan(0)
    }
  })

  test('on hover the plates are the accent, their words its ink', async ({ page }) => {
    await boot(page)
    const [, acc, accInk] = await tokens(page)
    const tile = tileOf(page, 'games')
    await tile.hover()
    for (const part of ['.q-tile-name b', '.q-tile-src']) {
      const plate = tile.locator(part.replace(' b', ''))
      expect((await styleOf(plate)).background, `${part}: the plate is the accent`).toBe(rgb(acc!))
      expect((await styleOf(tile.locator(part))).color, `${part}: its words are the accent's ink`).toBe(rgb(accInk!))
    }
  })

  test('the free-key chip is a plate too: paper at rest, the accent with its ink on hover', async ({ page }) => {
    await boot(page)
    const [paper, acc, accInk] = await tokens(page)
    const tile = tileOf(page, 'games')
    // The web build never needs a key (only the desktop app does): put the chip in as the markup has it.
    await tile.locator('.q-tile-foot').evaluate((foot) => {
      const chip = document.createElement('span')
      chip.className = 'q-key-chip'
      chip.textContent = 'Free key needed'
      foot.append(chip)
    })
    const chip = tile.locator('.q-key-chip')
    expect((await styleOf(chip)).background).toBe(rgb(paper!))
    await tile.hover()
    const lit = await styleOf(chip)
    expect(lit.background).toBe(rgb(acc!))
    expect(lit.color).toBe(rgb(accInk!))
  })

  for (const skin of SKINS) {
    test(`${skin}: the plates are that skin's paper`, async ({ page }) => {
      await boot(page, { skin })
      const [paper] = await tokens(page)
      const tile = tileOf(page, 'games')
      expect((await styleOf(tile.locator('.q-tile-name'))).background).toBe(rgb(paper!))
      expect((await styleOf(tile.locator('.q-tile-src'))).background).toBe(rgb(paper!))
    })
  }

  test('Quantum has no plates: no ground, no padding, the words as they were', async ({ page }) => {
    await boot(page, { theme: 'quantum' })
    const tile = page.locator('.q-tile').first()
    for (const part of ['.q-tile-name', '.q-tile-src']) {
      const plate = await styleOf(tile.locator(part))
      expect(plate.background, `${part}: no ground`).toBe('rgba(0, 0, 0, 0)')
      expect(plate.padding, `${part}: no padding`).toBe('0px')
    }
  })
})
