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
function expectedAt(layers: readonly Layer[], px: number, py: number, ground: Colour = [0, 0, 0]): { colour: Colour; touchedBy: Set<Layer> } {
  let colour: Colour = ground
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

async function open(page: Page, art = true) {
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  if (!art) return
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
async function compare(page: Page, layers: readonly Layer[], clip: { x: number; y: number; width: number; height: number }, ground: Colour = [0, 0, 0]) {
  const ratio = await page.evaluate(() => window.devicePixelRatio)
  const seen = decodePng(await page.screenshot({ clip }))
  expect([seen.width, seen.height], 'the screenshot is the clip at the device ratio').toEqual([clip.width * ratio, clip.height * ratio])
  let different = 0
  const shown = new Set<Layer>()
  for (let y = 0; y < clip.height; y++) {
    for (let x = 0; x < clip.width; x++) {
      const { colour, touchedBy } = expectedAt(layers, clip.x + x, clip.y + y, ground)
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

for (const [width, height] of SCREENS) {
  test(`Xen at ${width}x${height}: the star field, the ground strip and the outpost columns on it, pixel for pixel`, async ({ page }) => {
    await boot(page, { theme: 'exzed', exzedSkin: 'exzed-1c' }, width, height)
    await open(page)
    const at = await places(page, width, height)
    const box = { left: at.boxLeft, top: 0, right: at.boxLeft + at.boxWidth, bottom: height }
    const columns = png('space-left')
    const stars: Layer = { image: png('star-tile'), x: at.boxLeft, y: 0, repeatX: true, repeatY: true, clip: box }
    const strip: Layer = { image: png('space-parapet'), x: at.boxLeft, y: height - 28, repeatX: true, repeatY: false, clip: { ...box, top: height - 28 } }
    // The two columns stand on the strip (28px up, at 1:1) with their inner edges 16px from the window's border box: the left one ends 16px left of it, the right one starts
    // 16px right of it. They are over the star field and under the window.
    const left: Layer = { image: columns, x: at.layerLeft - 16 - 320, y: height - 28 - 1400, repeatX: false, repeatY: false, clip: box }
    const right: Layer = { image: png('space-right'), x: at.layerRight + 16, y: height - 28 - 1400, repeatX: false, repeatY: false, clip: box }
    const layers = [stars, strip, left, right]
    const edge = at.boxLeft + at.boxWidth

    // The ground left of the window (clear of its ring), from the screen's bottom up through the strip and the column's foot; and again from near the top, where on a tall
    // screen the column's head is (it is 1400px high and stands on the bottom: a taller screen shows more sky above it, never more column). Then the same on the right,
    // out at the app's edge where a star tile that is a pixel off has drifted.
    const bottom = Math.max(100, height - 800)
    const gap = (x: number, w: number, y: number, h: number) => ({ x, y, width: w, height: h })
    const clips = [
      ['left, bottom', gap(at.boxLeft, Math.min(at.layerLeft - 16 - at.boxLeft, 300), bottom, height - bottom), left],
      ['left, top', gap(at.boxLeft, Math.min(at.layerLeft - 16 - at.boxLeft, 300), 100, 300), left],
      ['right, bottom', gap(Math.max(at.layerRight + 16, edge - 300), Math.min(edge - at.layerRight - 16, 300), bottom, height - bottom), right],
      ['right, top', gap(Math.max(at.layerRight + 16, edge - 300), Math.min(edge - at.layerRight - 16, 300), 100, 300), right],
    ] as const
    for (const [name, clip, column] of clips) {
      const seen = await compare(page, layers, clip)
      expect(seen.different, `pixels that differ, ${name}`).toBe(0)
      if (name.endsWith('bottom')) {
        expect(seen.shown.has(column), `the column is in the ${name} clip`).toBe(true)
        expect(seen.shown.has(strip), `the strip is in the ${name} clip`).toBe(true)
      }
    }
  })
}

test('Xen: the strip is 28px high at the bottom of the app’s box, the columns’ box is the whole box, there is no strip under the header, and the window has not moved', async ({ page }) => {
  await boot(page, { theme: 'exzed', exzedSkin: 'exzed-1c' }, 3440, 1440)
  await open(page)
  const seen = await page.evaluate(() => {
    const box = (slot: string) => document.querySelector(`.q-backdrop > [data-slot="${slot}"]`)!.getBoundingClientRect().toJSON()
    const sides = document.querySelector('.q-backdrop > [data-slot="sides"]')!

    return {
      window: box('window'),
      bottom: box('bottom'),
      header: box('header'),
      sides: box('sides'),
      overflow: getComputedStyle(sides).overflow,
      children: sides.childNodes.length,
      layout: [document.querySelector('.q-appheader')!.getBoundingClientRect().height, document.querySelector('.q-layer')!.getBoundingClientRect().top],
    }
  })

  expect([seen.window.left, seen.window.top, seen.window.width, seen.window.height]).toEqual([440, 0, 2560, 1440])
  expect([seen.bottom.left, seen.bottom.top, seen.bottom.width, seen.bottom.height]).toEqual([440, 1440 - 28, 2560, 28])
  expect(seen.header.height, 'no strip under the header').toBe(0)
  expect([seen.sides.left, seen.sides.top, seen.sides.width, seen.sides.height]).toEqual([440, 0, 2560, 1440])
  expect([seen.overflow, seen.children]).toEqual(['hidden', 0])
  expect(seen.layout).toEqual([64, 108])
})

test('Xen: the strip never covers what stands over it: where the window overlaps it the window’s own ground is what shows', async ({ page }) => {
  await boot(page, { theme: 'exzed', exzedSkin: 'exzed-1c' }, 1440, 900)
  await open(page)
  // The window ends 24px above the bottom of the screen and the strip is 28px high, so the window's last 4px lie over the strip (the board has the same). A pixel just inside
  // the window's bottom edge, in its padding, must be the window's own background, not the strip's picture.
  const layer = await page.evaluate(() => {
    const rect = document.querySelector('.q-layer')!.getBoundingClientRect()
    const colour = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(document.querySelector('.q-layer')!).backgroundColor)!

    return { x: Math.round(rect.left + 40), bottom: rect.bottom, colour: [Number(colour[1]), Number(colour[2]), Number(colour[3])] }
  })
  const strip = png('space-parapet')
  const y = 900 - 27
  const under = [0, 1, 2].map((channel) => strip.data[((y - (900 - 28)) * strip.width + (layer.x % strip.width)) * 4 + channel]!)
  expect(under, 'the strip’s own pixel there differs from the window’s ground, or this proves nothing').not.toEqual(layer.colour)
  expect(layer.bottom, 'the window overlaps the strip').toBe(876)

  const seen = decodePng(await page.screenshot({ clip: { x: layer.x, y, width: 1, height: 1 } }))
  expect([seen.data[0], seen.data[1], seen.data[2]]).toEqual(layer.colour)
})

for (const [width, height] of SCREENS) {
  test(`Ikigai at ${width}x${height}: the stars, the hills-and-clouds, the waves and the castle and columns on them, pixel for pixel`, async ({ page }) => {
    await boot(page, { theme: 'exzed', exzedSkin: 'exzed-1e' }, width, height)
    await open(page)
    const at = await places(page, width, height)
    const box = { left: at.boxLeft, top: 0, right: at.boxLeft + at.boxWidth, bottom: height }
    const stars: Layer = { image: png('star-tile'), x: at.boxLeft, y: 0, repeatX: true, repeatY: true, clip: box }
    const waves: Layer = { image: png('island-waves'), x: at.boxLeft, y: height - 28, repeatX: true, repeatY: false, clip: { ...box, top: height - 28 } }
    // The castle ruin ends 16px left of the window's border box, the columns start 16px right of it, both 28px up, at 1:1 (the files are already scaled), over the stars.
    const castle: Layer = { image: png('island-shore-left'), x: at.layerLeft - 16 - 332, y: height - 28 - 1400, repeatX: false, repeatY: false, clip: box }
    const columns: Layer = { image: png('island-shore-right'), x: at.layerRight + 16, y: height - 28 - 1400, repeatX: false, repeatY: false, clip: box }
    // The strip under the header is 40px (64 to 104): the 16px of the others and the 24px of the ledge shift.
    const hills: Layer = { image: png('island-cornice'), x: at.boxLeft, y: 64, repeatX: true, repeatY: false, clip: { ...box, top: 64, bottom: 104 } }
    const layers = [stars, waves, castle, columns, hills]
    const edge = at.boxLeft + at.boxWidth
    const bottom = Math.max(110, height - 800)
    const gapLeft = { x: at.boxLeft, width: Math.min(at.layerLeft - 16 - at.boxLeft, 300) }
    const gapRight = { x: Math.max(at.layerRight + 16, edge - 300), width: Math.min(edge - at.layerRight - 16, 300) }

    for (const [name, gap, layer] of [['left', gapLeft, castle], ['right', gapRight, columns]] as const) {
      const seen = await compare(page, layers, { ...gap, y: bottom, height: height - bottom })
      expect(seen.different, `pixels that differ, ${name}, from the bottom`).toBe(0)
      expect(seen.shown.has(layer), `the ${name} shore is in the clip`).toBe(true)
      expect(seen.shown.has(waves), `the waves are in the ${name} clip`).toBe(true)
      expect((await compare(page, layers, { ...gap, y: 110, height: 300 })).different, `pixels that differ, ${name}, near the top`).toBe(0)
    }
    // The hills-and-clouds: more than one 380px tile of them at each end of the strip.
    expect((await compare(page, layers, { x: at.boxLeft, y: 64, width: 400, height: 40 })).different, 'hills at the left end').toBe(0)
    expect((await compare(page, layers, { x: edge - 400, y: 64, width: 400, height: 40 })).different, 'hills at the right end').toBe(0)
  })
}

/** Where the header, the strip under it and every layer are, as the page has them. */
const tops = (page: Page) =>
  page.evaluate(() => ({
    header: document.querySelector('.q-appheader')!.getBoundingClientRect().height,
    strip: document.querySelector('.q-backdrop > [data-slot="header"]')!.getBoundingClientRect().toJSON(),
    layers: Array.from(document.querySelectorAll('.q-layer')).map((layer) => layer.getBoundingClientRect().top),
  }))

test('Ikigai: the window starts 24px lower, over one layer and two, under a strip that ends at 104 and touches nothing', async ({ page }) => {
  await boot(page, { theme: 'exzed', exzedSkin: 'exzed-1e' }, 1440, 900)
  await open(page)

  // The header bar is as tall as ever; the strip under it is 40px (64 to 104); everything below starts 24px lower than in the other skins (132, 160 and 200 are
  // 108, 136 and 176 and 24; the covered layers' own tops, 120 and 160, are 96 and 136 and 24: the first is below the strip, which ends at 104).
  const alone = await tops(page)
  expect([alone.header, alone.strip.top, alone.strip.height, alone.layers]).toEqual([64, 64, 40, [132]])

  await page.getByRole('button', { name: 'New List', exact: true }).first().click()
  await page.locator('.q-picker').waitFor()
  await expect.poll(async () => (await tops(page)).layers).toEqual([120, 160])

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('.q-settings').waitFor()
  await expect.poll(async () => (await tops(page)).layers).toEqual([120, 160, 200])
  const stacked = await tops(page)
  expect(stacked.strip.top + stacked.strip.height, 'the strip ends above the first covered layer').toBeLessThanOrEqual(stacked.layers[0]!)
})

/**
 * The layers' tops are read from the page as the shell renders, and the skin that sets the shift is written on `<html>` in an effect after that render, so a skin that
 * arrives that way leaves the layers where the last one put them (found in 50.4's spike). Written before the render now, at boot, on a switch of skin, on a switch of theme.
 */
test('Ikigai: the first render already has the window at 132, and a switch of skin or theme moves it at once', async ({ page }) => {
  await boot(page, { theme: 'exzed', exzedSkin: 'exzed-1e' }, 1440, 900)
  // The layer's own `top` the first time it is in the page: the value the shell computed while it rendered, before any later render could correct it (the layer has a
  // 300ms transition on `top`, so a corrected value would slide in from the stale one, 24px, at every start in Ikigai).
  await page.addInitScript(() => {
    const record = () => {
      const layer = document.querySelector<HTMLElement>('.q-layer')
      if (!layer) return
      Object.assign(window, { __firstTop: layer.style.top })
      observer.disconnect()
    }
    const observer = new MutationObserver(record)
    observer.observe(document, { childList: true, subtree: true })
  })
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  expect(await page.evaluate(() => (window as unknown as { __firstTop?: string }).__firstTop), 'the first top the layer had, 44 + 24').toBe('68px')
  expect((await tops(page)).layers, 'at boot, with Ikigai stored').toEqual([132])

  // Ikigai to Lode and back, from Settings, without a reload: the window follows the skin's shift each time.
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('.q-settings').waitFor()
  await expect.poll(async () => (await tops(page)).layers).toEqual([120, 160])
  await page.locator('.q-settings').getByRole('button', { name: 'Lode', exact: true }).click()
  await expect.poll(async () => (await tops(page)).layers, 'Lode: no shift').toEqual([96, 136])
  await page.locator('.q-settings').getByRole('button', { name: 'Ikigai', exact: true }).click()
  await expect.poll(async () => (await tops(page)).layers, 'Ikigai again').toEqual([120, 160])

  // Quantum to eX-Zed with Ikigai as its stored skin: the class goes on first, and the skin with it.
  await page.locator('.q-settings').getByRole('button', { name: 'Quantum', exact: true }).click()
  await page.locator('.q-settings').getByRole('button', { name: 'eX-Zed', exact: true }).click()
  await expect.poll(async () => (await tops(page)).layers, 'eX-Zed again, with Ikigai').toEqual([120, 160])
})

test('Ikigai: a list lays out the same as in Lode, 24px lower and 24px shorter (rows, scroll area, rail)', async ({ page }) => {
  const rows = Array.from({ length: 40 }, (_, n) => `  - { title: "Item ${String(n + 1).padStart(3, '0')}", minutes: 30, group: "Season ${Math.floor(n / 10) + 1}" }`)
  const title = `e2e ikigai list ${Date.now()}`
  const made = await page.request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  const id = (await made.json()).id as string

  try {
    const geometry = async (skin: string) => {
      await boot(page, { theme: 'exzed', exzedSkin: skin }, 1920, 900)
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-item').first().waitFor()
      await page.evaluate(() => document.fonts.ready)

      return page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
        const layer = rect('.q-layer')
        const body = rect('.q-layer-body')
        const rail = document.querySelector('.q-rail')?.getBoundingClientRect()
        const rowsShown = [...document.querySelectorAll('.q-item')].map((row) => row.getBoundingClientRect()).filter((row) => row.bottom > body.top && row.top < body.bottom)

        return {
          layerTop: layer.top,
          layerBottom: layer.bottom,
          bodyTop: body.top - layer.top,
          bodyHeight: body.height,
          firstRow: rect('.q-item').top - layer.top,
          railTop: rail ? rail.top - layer.top : null,
          railHeight: rail ? rail.height : null,
          // A row the scroll area clips at its bottom edge, or one that sits over its top edge.
          clipped: rowsShown.filter((row) => row.top < body.top - 0.5 || row.bottom > body.bottom + 0.5).length,
        }
      })
    }

    const lode = await geometry('exzed-1d')
    const ikigai = await geometry('exzed-1e')

    expect(ikigai.layerTop - lode.layerTop, 'the window starts 24px lower').toBe(24)
    expect(ikigai.layerBottom, 'and ends where it did').toBe(lode.layerBottom)
    expect(lode.bodyHeight - ikigai.bodyHeight, 'the scroll area is 24px shorter').toBe(24)
    expect([ikigai.bodyTop, ikigai.firstRow, ikigai.railTop], 'everything inside is where it was in the window').toEqual([lode.bodyTop, lode.firstRow, lode.railTop])
    expect(lode.railHeight! - ikigai.railHeight!, 'the rail is 24px shorter with the window').toBe(24)
    expect(ikigai.clipped, 'no row is cut at the scroll area’s edge').toBeLessThanOrEqual(lode.clipped + 2)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

/** A screenshot's pixels by CSS position: `at(x, y)` is the colour of the CSS pixel, which is `ratio` device pixels square (the art and the type are pixelated). */
async function shot(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const ratio = await page.evaluate(() => window.devicePixelRatio)
  const seen = decodePng(await page.screenshot({ clip }))
  const at = (x: number, y: number): Colour => {
    const i = ((Math.floor((y - clip.y) * ratio) + Math.floor(ratio / 2)) * seen.width + Math.floor((x - clip.x) * ratio) + Math.floor(ratio / 2)) * 4

    return [seen.data[i]!, seen.data[i + 1]!, seen.data[i + 2]!]
  }

  return { at, ratio }
}

const same = (a: Colour, b: Colour) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
const PAPER: Colour = [215, 215, 215]
const INK: Colour = [0, 0, 0]

for (const [width, height] of SCREENS) {
  test(`Lotus at ${width}x${height}: plain paper beside the window, the status line in its place, and the window ends 44px above the bottom`, async ({ page }) => {
    await boot(page, { theme: 'exzed', exzedSkin: 'exzed-1l' }, width, height)
    await open(page, false)
    const at = await places(page, width, height)
    const edge = at.boxLeft + at.boxWidth

    // No art: the ground is the paper of the skin (normal white, #d7d7d7) at the left and at the right of the window, from under the strip to the bottom of the screen.
    const gapLeft = { x: at.boxLeft, y: 100, width: Math.min(at.layerLeft - 16 - at.boxLeft, 300), height: height - 100 }
    const gapRight = { x: Math.max(at.layerRight + 16, edge - 300), y: 100, width: Math.min(edge - at.layerRight - 16, 300), height: height - 100 }
    expect((await compare(page, [], gapLeft, PAPER)).different, 'ground pixels that are not plain paper, left').toBe(0)
    expect((await compare(page, [], gapRight, PAPER)).different, 'ground pixels that are not plain paper, right').toBe(0)

    // The status line: 16px high, its top at 28px above the bottom (12px up from it), its left at the window's left edge. The text is 9 characters of 16px, then a 16px gap
    // and the K in a 16px cell of ink: its left edge at the window's left edge + 160.
    const lineTop = height - 28
    const view = await shot(page, { x: at.layerLeft - 8, y: lineTop - 8, width: 200, height: 32 })
    const row = (y: number, from: number, to: number) => Array.from({ length: to - from }, (_, n) => view.at(from + n, y))
    const column = (x: number, from: number, to: number) => Array.from({ length: to - from }, (_, n) => view.at(x, from + n))
    const kLeft = at.layerLeft + 160
    expect(column(kLeft - 1, lineTop, lineTop + 16).every((pixel) => same(pixel, PAPER)), 'paper just left of the K').toBe(true)
    expect(column(kLeft + 16, lineTop, lineTop + 16).every((pixel) => same(pixel, PAPER)), 'paper just right of the K').toBe(true)
    expect(row(lineTop - 1, at.layerLeft - 8, at.layerLeft + 190).every((pixel) => same(pixel, PAPER)), 'paper above the line').toBe(true)
    expect(row(lineTop + 16, at.layerLeft - 8, at.layerLeft + 190).every((pixel) => same(pixel, PAPER)), 'paper under the line').toBe(true)
    // The K is the cell of ink with the letter cut out in paper: its edge pixels in ink, and both colours inside.
    const cell = Array.from({ length: 16 }, (_, y) => row(lineTop + y, kLeft, kLeft + 16)).flat()
    const ink = cell.filter((pixel) => same(pixel, INK)).length
    const paper = cell.filter((pixel) => same(pixel, PAPER)).length
    expect(ink, 'the K cell is mostly ink').toBeGreaterThan(256 / 2)
    expect(paper, 'with the letter in paper').toBeGreaterThan(8)
    expect(same(view.at(kLeft, lineTop), INK) && same(view.at(kLeft + 15, lineTop + 15), INK), 'the cell’s corners are ink').toBe(true)
    // The text: ink on paper inside 144px from the window's left edge, and the 16px gap before the K is paper.
    const text = Array.from({ length: 16 }, (_, y) => row(lineTop + y, at.layerLeft, at.layerLeft + 144)).flat()
    expect(text.filter((pixel) => same(pixel, INK)).length, 'the report line has ink in it').toBeGreaterThan(60)
    expect(Array.from({ length: 16 }, (_, y) => row(lineTop + y, at.layerLeft + 144, kLeft)).flat().every((pixel) => same(pixel, PAPER)), 'the gap before the K is paper').toBe(true)

    // The line itself, glyph for glyph: the same text drawn as real elements at the places it should stand (its left edge at the window's, 16px high at 28px above the bottom,
    // the K's cell 160px along), on paper over the generated one, must be the same picture, device pixel by device pixel. A line a pixel off in any direction is not.
    const strip = { x: at.layerLeft, y: lineTop, width: 190, height: 16 }
    const generated = decodePng(await page.screenshot({ clip: strip }))
    await page.evaluate(
      ([left, top]) => {
        const style = 'position:fixed;z-index:99999;font-size:16px;line-height:16px;white-space:pre;margin:0;padding:0;'
        const cover = document.createElement('div')
        cover.style.cssText = `${style}left:${left}px;top:${top}px;width:190px;height:16px;background:#d7d7d7;color:#000;font-family:inherit`
        const text = document.createElement('span')
        text.textContent = '0 OK, 0:1'
        const k = document.createElement('span')
        k.textContent = 'K'
        k.style.cssText = 'position:absolute;left:160px;top:0;background:#000;color:#d7d7d7'
        cover.append(text, k)
        document.body.append(cover)
      },
      [at.layerLeft, lineTop],
    )
    const drawn = decodePng(await page.screenshot({ clip: strip }))
    let apart = 0
    for (let n = 0; n < generated.data.length; n++) if (generated.data[n] !== drawn.data[n]) apart++
    expect(apart, 'bytes of the generated line that differ from the real elements at the right places').toBe(0)

    // The window ends 44px above the bottom (the line fills the gap); the header and the window's top are as in the other skins.
    const layout = await page.evaluate(() => ({ header: document.querySelector('.q-appheader')!.getBoundingClientRect().height, layer: document.querySelector('.q-layer')!.getBoundingClientRect().toJSON() }))
    expect([layout.header, layout.layer.top, layout.layer.bottom]).toEqual([64, 108, height - 44])
  })
}

test('Lotus: the bottom slot is the 44px under the window, the line is generated text in the Spectrum’s type, and it is in no other skin', async ({ page }) => {
  const line = async (key: string) => {
    await boot(page, { theme: 'exzed', exzedSkin: key }, 3440, 1440)
    await open(page, key !== 'exzed-1l')

    return page.evaluate(() => {
      const slot = document.querySelector('.q-backdrop > [data-slot="bottom"]')!
      const before = getComputedStyle(slot, '::before')
      const after = getComputedStyle(slot, '::after')

      return { box: slot.getBoundingClientRect().toJSON(), before: before.content, after: after.content, font: before.fontFamily, size: before.fontSize, kInk: after.backgroundColor, kText: after.color }
    })
  }

  const lotus = await line('exzed-1l')
  expect([lotus.box.left, lotus.box.top, lotus.box.width, lotus.box.height]).toEqual([440, 1440 - 44, 2560, 44])
  expect([lotus.before, lotus.after]).toEqual(['"0 OK, 0:1"', '"K"'])
  expect(lotus.font).toContain('ZX Spectrum')
  expect(lotus.size).toBe('16px')
  // Inverse video: the cell is the ink (black) and the letter the paper (normal white).
  expect([lotus.kInk, lotus.kText]).toEqual(['rgb(0, 0, 0)', 'rgb(215, 215, 215)'])

  for (const key of ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e']) {
    const other = await line(key)
    expect([other.before, other.after], `${key} has no status line`).not.toContain('"0 OK, 0:1"')
    expect(other.after, `${key} has no K`).not.toBe('"K"')
  }
})

test('Lotus: the line is not in the page for a screen reader and cannot be reached with the keyboard', async ({ page }) => {
  await boot(page, { theme: 'exzed', exzedSkin: 'exzed-1l' }, 1440, 900)
  await open(page, false)

  expect(await page.getByText('0 OK', { exact: false }).count(), 'no element holds it').toBe(0)
  expect(await page.evaluate(() => document.body.innerText.includes('0 OK')), 'it is not in the page’s text').toBe(false)
  expect(await page.locator('.q-backdrop').getAttribute('aria-hidden'), 'the backdrop is hidden from assistive technology').toBe('true')
  // Tab through the page: focus never lands in the backdrop.
  let inBackdrop = false
  for (let n = 0; n < 12; n++) {
    await page.keyboard.press('Tab')
    inBackdrop ||= await page.evaluate(() => !!document.activeElement?.closest('.q-backdrop'))
  }
  expect(inBackdrop).toBe(false)
})

/**
 * The Spectrum border beyond 2560px (50.6, X-006): where the app stops growing and is centred, the screen shows static tape-loading stripes in the five dark skins (an 8x1440
 * tile of normal yellow and normal blue bars, repeated from the screen's top left at its own size) and plain bright white in Lotus; none of it at 2560px and under, none of it
 * over the app's box, and a setting (50.7) that turns it plain black, which is `data-border="off"` on `<html>`.
 */
const SKIN_KEYS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e'] as const
const WHITE: Colour = [255, 255, 255]

for (const [width, height] of [[3440, 1440], [3840, 2160]] as const) {
  for (const key of [...SKIN_KEYS, 'exzed-1l'] as const) {
    test(`the border at ${width}x${height} in ${key}: ${key === 'exzed-1l' ? 'plain bright white' : 'the stripes, repeated, with no line against the app'}`, async ({ page }) => {
      await boot(page, { theme: 'exzed', exzedSkin: key }, width, height)
      await open(page, key !== 'exzed-1l')
      const left = (width - 2560) / 2
      const right = left + 2560
      const stripes: Layer = { image: png('border-stripes'), x: 0, y: 0, repeatX: true, repeatY: true, clip: { left: 0, top: 0, right: width, bottom: height } }
      const layers = key === 'exzed-1l' ? [] : [stripes]
      const ground = key === 'exzed-1l' ? WHITE : ([0, 0, 0] as Colour)

      // Each side of the app, the whole height of the screen (the header's rows and past the tile's own 1440), out to the app's very edge: so a line, a gap or a stretched tile there
      // fails. On a 2160 screen the tile is repeated (the seam at 1440 is inside the clip).
      for (const [name, x] of [['left', 0], ['right', right]] as const) {
        const seen = await compare(page, layers, { x, y: 0, width: left, height }, ground)
        expect(seen.different, `${name} border pixels that differ`).toBe(0)
        if (key !== 'exzed-1l') expect(seen.shown.has(stripes), `the ${name} clip shows the stripes`).toBe(true)
      }
      // Nothing scrolls sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    })
  }
}

test('the border does not paint over the app: Lotus’s paper is inside the box, the border white outside it', async ({ page }) => {
  await boot(page, { theme: 'exzed', exzedSkin: 'exzed-1l' }, 3440, 1440)
  await open(page, false)
  const seen = await shot(page, { x: 430, y: 700, width: 30, height: 1 })

  expect([seen.at(439, 700), seen.at(440, 700)], 'white up to the app’s edge, paper from it').toEqual([WHITE, PAPER])
  expect([seen.at(430, 700), seen.at(459, 700)]).toEqual([WHITE, PAPER])
})

test('the border is for a screen wider than the app only: none at 2560px, none requested, and a window made wider asks for it', async ({ page }) => {
  const border = (stored: Record<string, string>, width: number) => async () => {
    const fresh = await page.context().newPage()
    const urls: string[] = []
    fresh.on('request', (request) => urls.push(request.url()))
    await boot(fresh, stored, width, 1000)
    await fresh.goto('/')
    await fresh.locator('.q-home-row').first().waitFor()
    await fresh.waitForLoadState('networkidle')
    const image = await fresh.evaluate(() => getComputedStyle(document.querySelector('.q-backdrop')!).backgroundImage)
    await fresh.close()

    return { image, asked: urls.some((url) => url.includes('border-stripes')) }
  }

  expect(await border({ theme: 'exzed', exzedSkin: 'exzed-1d' }, 2560)(), 'at 2560px').toEqual({ image: 'none', asked: false })
  expect(await border({ theme: 'exzed', exzedSkin: 'exzed-1d' }, 1440)(), 'at 1440px').toEqual({ image: 'none', asked: false })
  const wide = await border({ theme: 'exzed', exzedSkin: 'exzed-1d' }, 2600)()
  expect([wide.image.includes('border-stripes'), wide.asked], 'at 2600px').toEqual([true, true])
  expect(await border({ theme: 'exzed', exzedSkin: 'exzed-1l' }, 2600)(), 'Lotus has no picture there either').toEqual({ image: 'none', asked: false })
})

test('with data-border="off" on <html> the border is plain black in the dark skins and stays white in Lotus', async ({ page }) => {
  for (const [key, expected] of [['exzed-1d', [0, 0, 0]], ['exzed-1c', [0, 0, 0]], ['exzed-1l', WHITE]] as const) {
    await boot(page, { theme: 'exzed', exzedSkin: key }, 3440, 1440)
    await open(page, key !== 'exzed-1l')
    await page.evaluate(() => document.documentElement.setAttribute('data-border', 'off'))
    const seen = await compare(page, [], { x: 0, y: 0, width: 440, height: 1440 }, expected as Colour)

    expect(seen.different, `${key}: border pixels that are not plain`).toBe(0)
  }
})

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
  for (const name of ['bottom', 'sides']) expect(seen.slots[name]!.height, `${name} takes no height`).toBe(0)
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

test('only the active skin’s pictures are requested: each skin asks for its own files, Lotus and Quantum for none', async ({ page }) => {
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
  expect(await requested({ theme: 'exzed', exzedSkin: 'exzed-1c' })).toEqual(['space-left.png', 'space-parapet.png', 'space-right.png', 'star-tile.png'])
  expect(await requested({ theme: 'exzed', exzedSkin: 'exzed-1e' })).toEqual(['island-cornice.png', 'island-shore-left.png', 'island-shore-right.png', 'island-waves.png', 'star-tile.png'])
  expect(await requested({ theme: 'exzed', exzedSkin: 'exzed-1l' }), 'Lotus has no art').toEqual([])
  expect(await requested({ theme: 'quantum' })).toEqual([])
})
