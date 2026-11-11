import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { decodePng, type Pixels } from './pngPixels.js'

/**
 * Choose Your Fighter's bottom scene (50.8, X-006), in both engines, under eX-Zed only. Choose Your Fighter is also New List and the first run's screen. The scene is a mask
 * (the black of the file is only its shape) filled with the skin's progress colour, 3 screen px to an art pixel, centred in a box that is the scroll area's full width and
 * crops it evenly; the desk adds an edge line the whole width; it is the last thing in the picker's own scroll area, on the window's bottom edge when there is room and
 * otherwise 24px under the List Vault shelf, scrolling with the rest. Which of the two is picked each time the screen opens: a test fixes `Math.random` before the app starts.
 */
const ART = new URL('../src/styles/theme/art/', import.meta.url).pathname
const SCENE_FILES = { desk: { file: '80s-desk', w: 553, h: 135 }, landscape: { file: 'fantasy-landscape', w: 583, h: 122 } } as const
type SceneName = keyof typeof SCENE_FILES
const png = (name: string) => decodePng(readFileSync(`${ART}${name}.png`))
const IMAGES = { desk: png('80s-desk'), landscape: png('fantasy-landscape') } satisfies Record<SceneName, Pixels>

type Colour = [number, number, number]

async function boot(page: Page, random: number, width: number, height: number, stored: Record<string, string> = {}) {
  await page.setViewportSize({ width, height })
  // The List Vault shelf fills in from the network, and what it adds moves the scene: a fixed answer, so the layout is the same at every look.
  await page.route('**/api/library/untracked', (route) =>
    route.fulfill({
      json: {
        entries: [
          { externalRef: 'canonical:lists/book/lotr.yaml', title: 'The Lord of the Rings', category: 'book', itemCount: 3, status: 'complete' },
          { externalRef: 'canonical:lists/movie/alien.yaml', title: 'The Alien franchise', category: 'movie', itemCount: 8, status: 'complete' },
          { externalRef: 'canonical:lists/comic/watchmen.yaml', title: 'Watchmen', category: 'comic', itemCount: 12, status: 'complete' },
        ],
        reachable: true,
      },
    }),
  )
  await page.addInitScript(
    ([value, entries]) => {
      Object.assign(window, { __random: value })
      Math.random = () => (window as unknown as { __random: number }).__random
      try {
        if (sessionStorage.getItem('__seeded')) return
        sessionStorage.setItem('__seeded', '1')
      } catch {
        return
      }
      for (const [key, v] of entries as [string, string][]) localStorage.setItem(key, v)
    },
    [random, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: 'exzed-1d', ...stored })] as const,
  )
}

async function openPicker(page: Page) {
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('button', { name: 'New List', exact: true }).first().click()
  await page.locator('.q-picker').waitFor()
  await settle(page)
}

/** The shelf has its entries and the picture's file is in: nothing is left to move the layout. */
async function settle(page: Page) {
  await expect(page.locator('.q-vault button').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    const art = document.querySelector('.q-scene-art')
    const url = art && /url\("?([^")]+)"?\)/.exec(getComputedStyle(art, '::before').maskImage)?.[1]
    if (!url) return
    const image = new Image()
    image.src = url
    await image.decode().catch(() => undefined)
  })
}

/** The geometry of the picker's scroll area, the scene and the shelf, in page pixels. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector)

      return element ? element.getBoundingClientRect().toJSON() : null
    }
    const body = document.querySelector('.q-picker-body')!

    return {
      body: rect('.q-picker-body')!,
      art: rect('.q-scene-art'),
      scene: rect('.q-scene'),
      vault: rect('.q-vault'),
      tiles: [...document.querySelectorAll('.q-tile')].map((tile) => tile.getBoundingClientRect().toJSON()),
      scrollTop: body.scrollTop,
      scrollable: body.scrollHeight > body.clientHeight,
      kind: document.querySelector('.q-scene-art')?.getAttribute('data-scene') ?? null,
      last: body.lastElementChild?.className ?? null,
    }
  })

const scrollToEnd = (page: Page) => page.evaluate(() => document.querySelector('.q-picker-body')!.scrollTo(0, document.querySelector('.q-picker-body')!.scrollHeight))

const colourOf = (value: string): Colour => {
  // A custom property's computed value keeps the space after its colon (` #d70000`), and a computed colour is `rgb(r, g, b)`.
  const css = value.trim()
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css)
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)]
  const rgb = /(\d+), (\d+), (\d+)/.exec(css)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  throw new Error(`not a colour: ${value}`)
}

/**
 * The scene's art box as a screenshot shows it, against the picture it should be: the card's paper, the desk's line (full width, 18px up and 9px high), the mask of the file at 3x
 * in the progress colour. Worked out in device pixels, because the engines snap where a picture starts to whole pixels of their own: the bottom edge to the nearest, an odd width's
 * half pixel (the picture is centred on its middle) either way. Those are the only liberties: a picture a whole pixel off from where its box and its size put it fails.
 */
async function wrong(page: Page, scene: SceneName) {
  const at = await geometry(page)
  const art = at.art!
  const { w, h } = SCENE_FILES[scene]
  const colours = await page.evaluate(() => ({
    paper: getComputedStyle(document.querySelector('.q-layer')!).backgroundColor,
    dim: getComputedStyle(document.documentElement).getPropertyValue('--zx-prog-dim'),
    ratio: window.devicePixelRatio,
  }))
  const paper = colourOf(colours.paper)
  const dim = colourOf(colours.dim)
  const r = colours.ratio
  const x0 = Math.ceil(art.left)
  const y0 = Math.ceil(art.top)
  const clip = { x: x0, y: y0, width: Math.floor(art.right) - x0, height: Math.floor(art.bottom) - y0 }
  const seen = decodePng(await page.screenshot({ clip }))
  expect([seen.width, seen.height], 'the screenshot is the clip at the device ratio').toEqual([clip.width * r, clip.height * r])

  const image = IMAGES[scene]
  const block = 3 * r
  const bottom = Math.round(art.bottom * r)
  const top = bottom - h * block
  const middle = (art.left + art.width / 2) * r
  const lefts = [...new Set([Math.floor(middle - (w * block) / 2), Math.ceil(middle - (w * block) / 2)])]
  const differences = lefts.map((left) => {
    let different = 0
    for (let dy = 0; dy < seen.height; dy++) {
      for (let dx = 0; dx < seen.width; dx++) {
        const X = x0 * r + dx
        const Y = y0 * r + dy
        const u = Math.floor((X - left) / block)
        const v = Math.floor((Y - top) / block)
        const inPicture = u >= 0 && u < w && v >= 0 && v < h && image.data[(v * w + u) * 4 + 3] === 255
        const line = scene === 'desk' && Y >= bottom - 27 * r && Y < bottom - 18 * r
        const expected = inPicture || line ? dim : paper
        const i = (dy * seen.width + dx) * 4
        if (seen.data[i] !== expected[0] || seen.data[i + 1] !== expected[1] || seen.data[i + 2] !== expected[2]) different++
      }
    }

    return different
  })

  return Math.min(...differences)
}

for (const [scene, random] of [['desk', 0.1], ['landscape', 0.9]] as const) {
  for (const [width, height] of [[1440, 1000], [1920, 1080], [1128, 1000], [1812, 1000]] as const) {
    test(`the ${scene} at ${width}x${height}: the picture, pixel for pixel, in the progress colour on the paper`, async ({ page }) => {
      await boot(page, random, width, height)
      await openPicker(page)
      await scrollToEnd(page)

      const at = await geometry(page)
      expect(at.kind).toBe(scene)
      expect(at.art!.height, 'the scene box is the picture’s height').toBe(scene === 'desk' ? 405 : 366)
      expect(await wrong(page, scene), 'pixels that are not the picture').toBe(0)
    })
  }
}

test('the desk’s edge line runs the whole width of the scene box', async ({ page }) => {
  await boot(page, 0.1, 1128, 1000)
  await openPicker(page)
  await scrollToEnd(page)
  const at = await geometry(page)
  const art = at.art!
  const dim = colourOf(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zx-prog-dim')))
  const ratio = await page.evaluate(() => window.devicePixelRatio)
  const x0 = Math.ceil(art.left)
  const clip = { x: x0, y: Math.floor(art.bottom - 24), width: Math.floor(art.right) - x0, height: 1 }
  const seen = decodePng(await page.screenshot({ clip }))

  // A row inside the line (21px up from the bottom): every pixel of it, edge to edge, in the progress colour.
  for (let x = 0; x < clip.width * ratio; x++) expect([seen.data[x * 4], seen.data[x * 4 + 1], seen.data[x * 4 + 2]], `the line at x ${x}`).toEqual(dim)
})

test('it is cropped evenly at both ends in a window narrower than the picture (1080 and 1620)', async ({ page }) => {
  for (const [width, height] of [[1128, 1000], [1812, 1000]] as const) {
    await boot(page, 0.9, width, height)
    await openPicker(page)
    await scrollToEnd(page)
    const at = await geometry(page)
    const art = at.art!
    const picture = 583 * 3
    const crop = (picture - art.width) / 2

    expect(crop, `the picture is wider than the box at ${width}`).toBeGreaterThan(0)
    // The first and the last column of the box are picture pixels cut by the same amount each side (the engine snaps the half pixel).
    const left = Math.floor(art.left + art.width / 2 - picture / 2)
    expect(Math.abs(art.left - left - (left + picture - art.right)), 'the crops at the two ends differ by at most one pixel').toBeLessThanOrEqual(1)
  }
})

test('with room it sits on the window’s bottom edge, with none 24px under the List Vault shelf, scrolling with the rest and never over a card', async ({ page }) => {
  // Room: a tall window; the scene's box ends at the scroll area's bottom edge and is the last thing in it.
  await boot(page, 0.9, 1920, 1900)
  await openPicker(page)
  const roomy = await geometry(page)
  expect(roomy.last).toBe('q-scene')
  expect(roomy.scrollable, 'no scrolling with room').toBe(false)
  expect(Math.abs(roomy.scene!.bottom - roomy.body.bottom), 'on the scroll area’s bottom edge').toBeLessThanOrEqual(1)
  expect(roomy.scene!.top - roomy.vault!.bottom, 'at least 24px under the shelf').toBeGreaterThanOrEqual(24)

  // No room: a short window; 24px under the shelf, scrolls with the rest, never over a tile or a shelf card.
  await page.setViewportSize({ width: 1920, height: 760 })
  await expect.poll(async () => (await geometry(page)).scrollable).toBe(true)
  const tight = await geometry(page)
  expect(tight.scrollTop).toBe(0)
  expect(Math.abs(tight.art!.top - tight.vault!.bottom - 24), 'the scene’s picture starts 24px under the shelf').toBeLessThanOrEqual(1)
  for (const tile of tight.tiles) expect(tight.art!.top, 'no overlap with a tile').toBeGreaterThanOrEqual(tile.bottom)

  await scrollToEnd(page)
  const scrolled = await geometry(page)
  expect(scrolled.scrollTop, 'it scrolled').toBeGreaterThan(0)
  expect(tight.art!.top - scrolled.art!.top, 'the scene moved up by what the area scrolled').toBeCloseTo(scrolled.scrollTop, 0)
  expect(Math.abs(scrolled.scene!.bottom - scrolled.body.bottom), 'at the end of the scroll it is on the bottom edge: never hidden').toBeLessThanOrEqual(1)
})

test('a first-run picker has it too', async ({ page }) => {
  await boot(page, 0.1, 1440, 1000)
  await page.route('**/api/lists', (route) => route.fulfill({ json: [] }))
  await page.goto('/')
  await page.locator('.q-picker').waitFor({ timeout: 15_000 })
  await scrollToEnd(page)

  const at = await geometry(page)
  expect([at.last, at.kind]).toEqual(['q-scene', 'desk'])
  expect(await wrong(page, 'desk'), 'the first run’s scene, pixel for pixel').toBe(0)
})

test('one scene per opening: a re-render keeps it, closing and opening the screen picks again', async ({ page }) => {
  await boot(page, 0.1, 1440, 1000)
  await openPicker(page)
  expect((await geometry(page)).kind).toBe('desk')

  // The page's random now says landscape, but the screen is already open: resizing re-renders it and the scene stays.
  await page.evaluate(() => Object.assign(window, { __random: 0.9 }))
  await page.setViewportSize({ width: 1500, height: 1000 })
  await expect.poll(async () => (await geometry(page)).body.width).toBeGreaterThan(0)
  expect((await geometry(page)).kind, 'a re-render does not pick again').toBe('desk')

  await page.keyboard.press('Escape')
  await page.locator('.q-picker').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'New List', exact: true }).first().click()
  await page.locator('.q-picker').waitFor()
  expect((await geometry(page)).kind, 'opened again, it picks again').toBe('landscape')
})

test('Quantum’s picker has no scene, and asks for none of the files', async ({ page }) => {
  const urls: string[] = []
  page.on('request', (request) => urls.push(request.url()))
  await boot(page, 0.1, 1440, 1000, { theme: 'quantum' })
  await openPicker(page)
  await page.waitForLoadState('networkidle')

  expect((await geometry(page)).scene).toBeNull()
  expect(urls.filter((url) => /80s-desk|fantasy-landscape/.test(url))).toEqual([])
})

test('under eX-Zed only the picked scene’s file is asked for', async ({ page }) => {
  const urls: string[] = []
  page.on('request', (request) => urls.push(request.url()))
  await boot(page, 0.9, 1440, 1000)
  await openPicker(page)
  await page.waitForLoadState('networkidle')

  expect(urls.some((url) => url.includes('fantasy-landscape'))).toBe(true)
  expect(urls.some((url) => url.includes('80s-desk'))).toBe(false)
})
