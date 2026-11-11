import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { decodePng, pixelOver } from './pngPixels.js'

/**
 * eX-Zed's skin art (Phase 50, X-006), in both engines. 50.1: Lode (`exzed-1d`), the brick wall behind the window (240x84, repeated from the screen's top left, at its
 * own size) and the cornice under the header (64x16, repeated along it). The art covers the app's screen, which stops growing at 2560px and is centred, so on a wide
 * screen it starts where the app does. Read as pixels, not as styles: a screenshot of the ground beside the window is the art file's own picture, byte for byte, in a
 * whole tile (what the board draws). Only the active skin's files are requested; Quantum requests none.
 */
const ART = new URL('../src/styles/theme/art/', import.meta.url).pathname
const WALL = decodePng(readFileSync(`${ART}red-bricks-wall.png`))
const CORNICE = decodePng(readFileSync(`${ART}red-bricks-cornice.png`))

async function boot(page: Page, stored: Record<string, string>, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', ...stored }))
}

async function open(page: Page) {
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  // The pictures are CSS backgrounds: wait for them to be decoded before a screenshot reads them.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const slot = document.querySelector('.q-backdrop > [data-slot="window"]')
        const url = slot ? /url\("?([^")]+)"?\)/.exec(getComputedStyle(slot).backgroundImage)?.[1] : undefined
        if (!url) return 'none'
        const image = new Image()
        image.src = url
        await image.decode().catch(() => undefined)
        return image.naturalWidth
      }),
    )
    .toBe(240)
}

/**
 * Every device pixel of `clip` (page coordinates) against the picture `tile`, whose origin is at (originX, originY) on the page. A screenshot has `devicePixelRatio`
 * device pixels to a CSS pixel (WebKit's runs at 2), and the art is drawn pixelated, so each CSS pixel of the file must be a whole square of that colour.
 */
async function wrong(page: Page, tile: typeof WALL, clip: { x: number; y: number; width: number; height: number }, originX: number, originY: number) {
  const ratio = await page.evaluate(() => window.devicePixelRatio)
  const seen = decodePng(await page.screenshot({ clip }))
  expect([seen.width, seen.height], 'the screenshot is the clip at the device ratio').toEqual([clip.width * ratio, clip.height * ratio])
  let different = 0
  for (let y = 0; y < seen.height; y++) {
    for (let x = 0; x < seen.width; x++) {
      const [r, g, b] = pixelOver(tile, (clip.x + Math.floor(x / ratio) - originX) % tile.width, (clip.y + Math.floor(y / ratio) - originY) % tile.height, [0, 0, 0])
      const at = (y * seen.width + x) * 4
      if (seen.data[at] !== r || seen.data[at + 1] !== g || seen.data[at + 2] !== b) different++
    }
  }

  return different
}

for (const [width, height] of [[1440, 900], [2560, 1600], [3440, 1440]] as const) {
  test(`Lode at ${width}x${height}: the ground beside the window is the brick wall, and the cornice runs under the header, pixel for pixel`, async ({ page }) => {
    await boot(page, { theme: 'exzed', exzedSkin: 'exzed-1d' }, width, height)
    await open(page)
    // The app's box: the screen up to 2560px wide, centred; the art starts at its left edge.
    const left = Math.max(0, (width - 2560) / 2)

    // One whole tile high of ground in the gap left of the window (its ring starts 84px from the app's edge at 1440) and again at the app's right edge, 1000-odd
    // pixels along the tile's own width, where a tile that is a pixel too wide or too narrow has drifted: clear of the header and the cornice.
    expect(await wrong(page, WALL, { x: left, y: 100, width: 60, height: 84 }, left, 0), 'wall pixels that differ from the file, at the left edge').toBe(0)
    expect(await wrong(page, WALL, { x: left + Math.min(width, 2560) - 60, y: 100, width: 60, height: 84 }, left, 0), 'wall pixels that differ from the file, at the right edge').toBe(0)
    // The cornice: 16px high at the header's bottom edge, under nothing but the header, three tiles of it along the strip.
    expect(await wrong(page, CORNICE, { x: left, y: 64, width: 192, height: 16 }, left, 64), 'cornice pixels that differ from the file').toBe(0)
    expect(await wrong(page, CORNICE, { x: left + Math.min(width, 2560) - 192, y: 64, width: 192, height: 16 }, left, 64), 'cornice pixels at the right edge').toBe(0)
  })
}

test('Lode: the art slots are where the board has them, and the window and header have not moved', async ({ page }) => {
  await boot(page, { theme: 'exzed', exzedSkin: 'exzed-1d' }, 3440, 1440)
  await open(page)

  const seen = await page.evaluate(() => ({
    slots: Object.fromEntries(
      [...document.querySelectorAll('.q-backdrop > [data-slot]')].map((el) => {
        const box = el.getBoundingClientRect()
        return [el.getAttribute('data-slot'), { left: box.left, top: box.top, width: box.width, height: box.height }]
      }),
    ),
    header: document.querySelector('.q-appheader')!.getBoundingClientRect().height,
    window: document.querySelector('.q-layer')!.getBoundingClientRect().top,
    rendering: getComputedStyle(document.querySelector('.q-backdrop > [data-slot="window"]')!).imageRendering,
  }))

  // The ground fills the app's 2560px box, centred on the 3440px screen; the cornice is 16px high at the header's bottom edge; the slots of the other skins' art are empty.
  expect(seen.slots['window']).toEqual({ left: 440, top: 0, width: 2560, height: 1440 })
  expect(seen.slots['header']).toEqual({ left: 440, top: 64, width: 2560, height: 16 })
  for (const name of ['bottom', 'sides', 'scene']) expect(seen.slots[name]!.height, `${name} takes no height`).toBe(0)
  expect(seen.rendering).toBe('pixelated')
  expect([seen.header, seen.window]).toEqual([64, 108])
})

test('only the active skin’s pictures are requested: Lode asks for its bricks, Focal for none of them, Quantum for no art', async ({ page }) => {
  // The pictures a page asks for, in a page of its own so one skin's requests never count for another's.
  const requested = async (stored: Record<string, string>) => {
    const fresh = await page.context().newPage()
    const urls: string[] = []
    fresh.on('request', (request) => urls.push(request.url()))
    await boot(fresh, stored, 1440, 900)
    await fresh.goto('/')
    await fresh.locator('.q-home-row').first().waitFor()
    await fresh.waitForLoadState('networkidle')
    await fresh.close()

    return urls.filter((url) => /red-bricks|theme\/art\//.test(url))
  }

  const lode = await requested({ theme: 'exzed', exzedSkin: 'exzed-1d' })
  expect(lode.some((url) => url.includes('red-bricks-wall'))).toBe(true)
  expect(lode.some((url) => url.includes('red-bricks-cornice'))).toBe(true)

  expect(await requested({ theme: 'exzed', exzedSkin: 'exzed-1a' })).toEqual([])
  expect(await requested({ theme: 'quantum' })).toEqual([])
})
