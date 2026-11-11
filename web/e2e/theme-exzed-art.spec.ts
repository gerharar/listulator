import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { decodePng, type Pixels } from './pngPixels.js'

/**
 * eX-Zed's skin art (Phase 50, X-006), in both engines. 50.1 Lode (`exzed-1d`): the brick wall behind the window and the cornice under the header. 50.2 Focal
 * (`exzed-1a`) and Glemt (`exzed-1b`): a stone wall (2004px wide, 1542 high, repeated), the 16px dither fade under the header and, over the wall and under the window,
 * its rings and the fade, one long four-band diagonal on each side (`side-stripes`, 2304px square, at 1:1: the left one comes out from under the window 128px in and runs
 * down and left, the right one from 200px inside the window's right edge and runs up and right; the app's box clips both). The art covers the app's screen, which stops
 * growing at 2560px and is centred. Read as pixels, not as styles: each skin's picture is composited here from its own PNG files at the places design gives, and the
 * ground beside the window, the strips under the header and the stripes' own pixels in a screenshot must equal it, device pixel by device pixel. Only the active skin's
 * files are requested; Quantum requests none.
 */
const ART = new URL('../src/styles/theme/art/', import.meta.url).pathname
const png = (name: string) => decodePng(readFileSync(`${ART}${name}.png`))

type Colour = [number, number, number]

/** One picture at a place: its top left on the page, whether it repeats along each axis, and the box that clips it. */
interface Layer {
  image: Pixels
  x: number
  y: number
  repeatX: boolean
  repeatY: boolean
  clip: { left: number; top: number; right: number; bottom: number }
}

/** The layer's pixel at a page position as `[r, g, b, alpha]`, or `null` where it is not drawn. */
function sample(layer: Layer, px: number, py: number): [number, number, number, number] | null {
  const { image, clip } = layer
  if (px < clip.left || px >= clip.right || py < clip.top || py >= clip.bottom) return null
  let u = px - layer.x
  let v = py - layer.y
  if (layer.repeatX) u = ((u % image.width) + image.width) % image.width
  if (layer.repeatY) v = ((v % image.height) + image.height) % image.height
  if (u < 0 || u >= image.width || v < 0 || v >= image.height) return null
  const at = (v * image.width + u) * 4

  return [image.data[at]!, image.data[at + 1]!, image.data[at + 2]!, image.data[at + 3]!]
}

/** What the page shows at a position: the layers from the bottom up, each over what is under it, on the stage's black. */
function expectedAt(layers: readonly Layer[], px: number, py: number): { colour: Colour; touchedBy: Set<Layer> } {
  let colour: Colour = [0, 0, 0]
  const touchedBy = new Set<Layer>()
  for (const layer of layers) {
    const pixel = sample(layer, px, py)
    if (!pixel || pixel[3] === 0) continue
    touchedBy.add(layer)
    const alpha = pixel[3] / 255
    colour = [0, 1, 2].map((channel) => Math.round(pixel[channel]! * alpha + colour[channel]! * (1 - alpha))) as Colour
  }

  return { colour, touchedBy }
}

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
  // The pictures are CSS backgrounds: wait for the ground's to be decoded before a screenshot reads it.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const slot = document.querySelector('.q-backdrop > [data-slot="window"]')
        const url = slot ? /url\("?([^")]+)"?\)/.exec(getComputedStyle(slot).backgroundImage)?.[1] : undefined
        if (!url) return 0
        const image = new Image()
        image.src = url
        await image.decode().catch(() => undefined)
        return image.naturalWidth
      }),
    )
    .toBeGreaterThan(0)
}

/**
 * How many device pixels of `clip` (page coordinates) differ from the expected picture, and which layers the clip really shows. A screenshot has `devicePixelRatio`
 * device pixels to a CSS pixel (WebKit's runs at 2) and the art is drawn pixelated, so each CSS pixel of a picture must be a whole square of its colour.
 */
async function compare(page: Page, layers: readonly Layer[], clip: { x: number; y: number; width: number; height: number }) {
  const ratio = await page.evaluate(() => window.devicePixelRatio)
  const seen = decodePng(await page.screenshot({ clip }))
  expect([seen.width, seen.height], 'the screenshot is the clip at the device ratio').toEqual([clip.width * ratio, clip.height * ratio])
  let different = 0
  const shown = new Set<Layer>()
  for (let y = 0; y < clip.height; y++) {
    for (let x = 0; x < clip.width; x++) {
      const { colour, touchedBy } = expectedAt(layers, clip.x + x, clip.y + y)
      touchedBy.forEach((layer) => shown.add(layer))
      for (let dy = 0; dy < ratio; dy++) {
        for (let dx = 0; dx < ratio; dx++) {
          const at = ((y * ratio + dy) * seen.width + x * ratio + dx) * 4
          if (seen.data[at] !== colour[0] || seen.data[at + 1] !== colour[1] || seen.data[at + 2] !== colour[2]) different++
        }
      }
    }
  }

  return { different, shown }
}

const SCREENS = [[1440, 900], [2560, 1600], [3440, 1440]] as const

/** Where the app's box and the window are on this page. */
const places = (page: Page, width: number, height: number) =>
  page.evaluate(
    ([w, h]) => {
      const layer = document.querySelector('.q-layer')!.getBoundingClientRect()
      const boxWidth = Math.min(w!, 2560)

      return { boxLeft: (w! - boxWidth) / 2, boxWidth, height: h!, layerLeft: layer.left, layerRight: layer.right }
    },
    [width, height],
  )

for (const [width, height] of SCREENS) {
  test(`Lode at ${width}x${height}: the ground beside the window is the brick wall, and the cornice runs under the header, pixel for pixel`, async ({ page }) => {
    await boot(page, { theme: 'exzed', exzedSkin: 'exzed-1d' }, width, height)
    await open(page)
    const at = await places(page, width, height)
    const box = { left: at.boxLeft, top: 0, right: at.boxLeft + at.boxWidth, bottom: height }
    const wall: Layer = { image: png('red-bricks-wall'), x: at.boxLeft, y: 0, repeatX: true, repeatY: true, clip: box }
    const cornice: Layer = { image: png('red-bricks-cornice'), x: at.boxLeft, y: 64, repeatX: true, repeatY: false, clip: { ...box, top: 64, bottom: 80 } }
    const layers = [wall, cornice]
    const right = at.boxLeft + at.boxWidth

    // One whole tile high of ground in the gap left of the window (its ring starts 84px from the app's edge at 1440) and again at the app's right edge, where a tile that
    // is a pixel too wide or too narrow has drifted: clear of the header and the cornice. The cornice: three tiles of it at each end of the strip.
    expect((await compare(page, layers, { x: at.boxLeft, y: 100, width: 60, height: 84 })).different, 'wall pixels at the left edge').toBe(0)
    expect((await compare(page, layers, { x: right - 60, y: 100, width: 60, height: 84 })).different, 'wall pixels at the right edge').toBe(0)
    expect((await compare(page, layers, { x: at.boxLeft, y: 64, width: 192, height: 16 })).different, 'cornice pixels at the left end').toBe(0)
    expect((await compare(page, layers, { x: right - 192, y: 64, width: 192, height: 16 })).different, 'cornice pixels at the right end').toBe(0)
  })
}

for (const [skin, key, wallName, separatorName] of [
  ['Focal', 'exzed-1a', 'blue-stones-wall', 'blue-stones-separator'],
  ['Glemt', 'exzed-1b', 'grey-stones-wall', 'grey-stones-separator'],
] as const) {
  for (const [width, height] of SCREENS) {
    test(`${skin} at ${width}x${height}: the stone wall, the stripes under the window and the dither fade under the header, pixel for pixel`, async ({ page }) => {
      await boot(page, { theme: 'exzed', exzedSkin: key }, width, height)
      await open(page)
      const at = await places(page, width, height)
      const box = { left: at.boxLeft, top: 0, right: at.boxLeft + at.boxWidth, bottom: height }
      const stripes = png('side-stripes')
      const wall: Layer = { image: png(wallName), x: at.boxLeft, y: 0, repeatX: true, repeatY: true, clip: box }
      // The window's border box is where the stripes are tied: the left one 128px inside its left edge, its bottom 1824px below the screen's; the right one 200px inside its right
      // edge, its top 1860px above the screen's.
      const left: Layer = { image: stripes, x: at.layerLeft + 128 - 2304, y: height + 1824 - 2304, repeatX: false, repeatY: false, clip: box }
      const right: Layer = { image: stripes, x: at.layerRight - 200, y: -1860, repeatX: false, repeatY: false, clip: box }
      const fade: Layer = { image: png(separatorName), x: at.boxLeft, y: 64, repeatX: true, repeatY: false, clip: { ...box, top: 64, bottom: 80 } }
      const layers = [wall, left, right, fade]
      const edge = at.boxLeft + at.boxWidth

      // The ground in the gap left of the window (a ring and 4px clear of it), down to the screen's bottom end where the left stripe runs out, and the gap right of it,
      // at the top where the right one does: each must show its own stripe, or the position is not being tested.
      const top = Math.max(100, height - 700)
      const gapLeft = { x: at.boxLeft, y: top, width: Math.min(at.layerLeft - 16 - at.boxLeft, 300), height: height - 40 - top }
      const gapRight = { x: Math.max(at.layerRight + 16, edge - 300), y: 100, width: Math.min(edge - at.layerRight - 16, 300), height: 700 }
      const seenLeft = await compare(page, layers, gapLeft)
      const seenRight = await compare(page, layers, gapRight)
      expect(seenLeft.different, 'pixels at the left of the window that differ').toBe(0)
      expect(seenLeft.shown.has(left), 'the left stripe is in the left clip').toBe(true)
      expect(seenRight.different, 'pixels at the right of the window that differ').toBe(0)
      expect(seenRight.shown.has(right), 'the right stripe is in the right clip').toBe(true)

      // The dither fade: 16px high under the header, over the wall (and over a stripe where one crosses it, at the right).
      expect((await compare(page, layers, { x: at.boxLeft, y: 64, width: 192, height: 16 })).different, 'fade pixels at the left end').toBe(0)
      expect((await compare(page, layers, { x: edge - 192, y: 64, width: 192, height: 16 })).different, 'fade pixels at the right end').toBe(0)
    })
  }
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

test('Focal and Glemt: the strip under the header is 16px, the side art is the app’s whole box, and the window and header have not moved', async ({ page }) => {
  for (const key of ['exzed-1a', 'exzed-1b']) {
    await boot(page, { theme: 'exzed', exzedSkin: key }, 3440, 1440)
    await open(page)
    const seen = await page.evaluate(() => ({
      header: document.querySelector('.q-backdrop > [data-slot="header"]')!.getBoundingClientRect().toJSON(),
      sides: document.querySelector('.q-backdrop > [data-slot="sides"]')!.getBoundingClientRect().toJSON(),
      children: document.querySelector('.q-backdrop > [data-slot="sides"]')!.childNodes.length,
      overflow: getComputedStyle(document.querySelector('.q-backdrop > [data-slot="sides"]')!).overflow,
      order: [...document.querySelectorAll('.q-backdrop > [data-slot]')].map((el) => [el.getAttribute('data-slot'), getComputedStyle(el).zIndex]),
      layout: [document.querySelector('.q-appheader')!.getBoundingClientRect().height, document.querySelector('.q-layer')!.getBoundingClientRect().top],
    }))

    expect([seen.header.left, seen.header.top, seen.header.width, seen.header.height], key).toEqual([440, 64, 2560, 16])
    expect([seen.sides.left, seen.sides.top, seen.sides.width, seen.sides.height], key).toEqual([440, 0, 2560, 1440])
    // The stripes are drawn by the slot's own pseudo-elements (no DOM is added), which the box clips; they stand under the strip under the header.
    expect([seen.children, seen.overflow], key).toEqual([0, 'hidden'])
    const z = Object.fromEntries(seen.order as [string, string][])
    expect(Number(z['sides']), 'the stripes are over the ground').toBeGreaterThan(Number(z['window']))
    expect(Number(z['header']), 'the strip under the header is over the stripes').toBeGreaterThan(Number(z['sides']))
    expect(seen.layout, key).toEqual([64, 108])
  }
})

test('only the active skin’s pictures are requested: each skin asks for its own files, Xen and Quantum for none', async ({ page }) => {
  // The art files a page asks for, in a page of its own so one skin's requests never count for another's.
  const requested = async (stored: Record<string, string>) => {
    const fresh = await page.context().newPage()
    const urls: string[] = []
    fresh.on('request', (request) => urls.push(request.url()))
    await boot(fresh, stored, 1440, 900)
    await fresh.goto('/')
    await fresh.locator('.q-home-row').first().waitFor()
    await fresh.waitForLoadState('networkidle')
    await fresh.close()

    // The two separators are tiny (114 and 118 bytes) and a production build inlines them in the stylesheet; the development server this runs against asks for them.
    return urls.filter((url) => /theme\/art\//.test(url)).map((url) => /\/art\/([^/?]+?)(?:\?.*)?$/.exec(url)![1]!).sort()
  }

  expect(await requested({ theme: 'exzed', exzedSkin: 'exzed-1d' })).toEqual(['red-bricks-cornice.png', 'red-bricks-wall.png'])
  expect(await requested({ theme: 'exzed', exzedSkin: 'exzed-1a' })).toEqual(['blue-stones-separator.png', 'blue-stones-wall.png', 'side-stripes.png'])
  expect(await requested({ theme: 'exzed', exzedSkin: 'exzed-1b' })).toEqual(['grey-stones-separator.png', 'grey-stones-wall.png', 'side-stripes.png'])
  expect(await requested({ theme: 'exzed', exzedSkin: 'exzed-1c' })).toEqual([])
  expect(await requested({ theme: 'quantum' })).toEqual([])
})
