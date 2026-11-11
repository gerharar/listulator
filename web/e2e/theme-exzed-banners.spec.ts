import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { decodePng, type Pixels } from './pngPixels.js'

/**
 * The category banners (50.9, X-006), in both engines, under eX-Zed only. Each is a raster mask (the file's opaque pixels are its shape) filled with the skin's progress colour at
 * two screen pixels to an art pixel (the Category art README's sizes), in the list header (24px from the right, on the bottom, behind the header's content, a narrow header crops it
 * from the left) and in a Choose Your Fighter tile (anchored to the tile's bottom, 50% or 100% across, the tile crops it; on hover the tile is the accent and the art its ink).
 * Compared pixel for pixel against the file in device pixels (the engines snap where a picture starts: the bottom edge to the nearest pixel, a half pixel either way).
 */
const ART = new URL('../src/styles/theme/art/', import.meta.url).pathname
type Colour = [number, number, number]

/** Registry key → the picture, its README size in art pixels, and where a tile crops it (the board's). */
const BANNERS = {
  movie: { header: 'movies', tile: 'movies', w: 193, h: 53, x: 1 },
  tv: { header: 'tv-series', tile: 'tv-series', w: 154, h: 58, x: 0.5 },
  animation: { header: 'animation', tile: 'animation', w: 182, h: 74, x: 0.5 },
  documentary: { header: 'documentaries', tile: 'documentaries', w: 201, h: 50, x: 1 },
  wrestling: { header: 'pro-wrestling', tile: 'pro-wrestling-tile', w: 202, h: 54, tileW: 151, tileH: 54, x: 0.5 },
  mma: { header: 'mma', tile: 'mma', w: 202, h: 60, x: 0.5 },
  game: { header: 'games', tile: 'games', w: 230, h: 56, x: 0.5 },
  comic: { header: 'comics', tile: 'comics', w: 203, h: 71, x: 0.5 },
  book: { header: 'books', tile: 'books', w: 186, h: 57, x: 0.5 },
  music: { header: 'music', tile: 'music', w: 199, h: 46, x: 0.5 },
  youtube: { header: 'youtube', tile: 'youtube', w: 193, h: 81, x: 0.5 },
  mega: { header: 'mega', tile: 'mega', w: 203, h: 60, x: 0.5 },
} as const
type Key = keyof typeof BANNERS
const KEYS = Object.keys(BANNERS) as Key[]

const pictures = new Map<string, Pixels>()
const picture = (name: string) => {
  if (!pictures.has(name)) pictures.set(name, decodePng(readFileSync(`${ART}${name}.png`)))

  return pictures.get(name)!
}

const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

const SUMMARY = (mediaType: string, title = 'Banner list') => ({
  id: 'L1',
  title,
  description: null,
  mediaType,
  source: 'manual',
  externalRef: null,
  status: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  stats: { totalItems: 1, consumedItems: 0, newItems: 0, completionPercent: 0, timeRemainingMinutes: 90, lastConsumedAt: null },
})
const ITEM = {
  id: 'i1',
  listId: 'L1',
  title: 'First',
  orderIndex: 0,
  timeToConsumeMinutes: 90,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'manual',
  year: null,
  yearUnk: 0,
  group: null,
  tags: null,
  notes: null,
  isNew: false,
}

async function boot(page: Page, { skin = 'exzed-1d', theme = 'exzed', width = 1440, height = 1000, mediaType = null as string | null, title = 'Banner list' } = {}) {
  await page.setViewportSize({ width, height })
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  // No list: the first run's picker is the base layer. One list of the given type: Home, and the list opens from it.
  await page.route('**/api/lists', (route) => route.fulfill({ json: mediaType ? [SUMMARY(mediaType, title)] : [] }))
  if (mediaType) await page.route('**/api/lists/L1', (route) => route.fulfill({ json: { ...SUMMARY(mediaType, title), items: [ITEM], groups: [] } }))
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme, exzedSkin: skin }))
}

async function openPicker(page: Page) {
  await page.goto('/')
  await page.locator('.q-picker').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('.q-tile')).toHaveCount(12)
}

async function openList(page: Page) {
  await page.goto('/')
  await page.locator('.q-home-row').first().click()
  await page.locator('.q-list-head').waitFor()
  await page.evaluate(() => document.fonts.ready)
}

const colourOf = (value: string): Colour => {
  // A custom property's computed value keeps the space after its colon (` #d70000`), and a computed colour is `rgb(r, g, b)`.
  const css = value.trim()
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css)
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)]
  const rgb = /^rgba?\((\d+), (\d+), (\d+)/.exec(css)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  throw new Error(`not a colour: ${value}`)
}

/** The colour a box shows behind its art: its own background, or the nearest ancestor's that is not transparent. */
const groundOf = (locator: Locator) =>
  locator.evaluate((element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const value = getComputedStyle(node).backgroundColor
      const alpha = /^rgba\(\d+, \d+, \d+, ([\d.]+)\)$/.exec(value)
      if (value !== 'rgba(0, 0, 0, 0)' && (!alpha || Number(alpha[1]) > 0)) return value
    }

    return 'rgb(0, 0, 0)'
  })

const rectOf = (locator: Locator) => locator.evaluate((element) => element.getBoundingClientRect().toJSON() as { left: number; top: number; right: number; bottom: number; width: number; height: number })

/**
 * The element's box as a screenshot shows it, against the banner it should draw: the ground, and the file's opaque pixels at `w` x `h` screen px, with the picture's left edge
 * `across` of the way (0.5 centred, 1 flush right) in the box and its bottom edge on the box's. Worked out in device pixels: the bottom edge to the nearest, an odd width's half
 * pixel either way. Returns the number of pixels that are not what the picture says.
 */
async function wrong(page: Page, box: { left: number; top: number; right: number; bottom: number; width: number }, file: string, w: number, h: number, across: number, ground: Colour, ink: Colour) {
  const r = await page.evaluate(() => window.devicePixelRatio)
  const x0 = Math.ceil(box.left)
  const y0 = Math.ceil(box.top)
  const clip = { x: x0, y: y0, width: Math.floor(box.right) - x0, height: Math.floor(box.bottom) - y0 }
  const seen = decodePng(await page.screenshot({ clip }))
  expect([seen.width, seen.height], 'the screenshot is the clip at the device ratio').toEqual([clip.width * r, clip.height * r])
  const image = picture(file)
  const bottom = Math.round(box.bottom * r)
  const top = bottom - h * r
  const wanted = (box.left + (box.width - w) * across) * r
  const lefts = [...new Set([Math.floor(wanted), Math.ceil(wanted)])]
  const differences = lefts.map((left) => {
    let different = 0
    for (let dy = 0; dy < seen.height; dy++) {
      for (let dx = 0; dx < seen.width; dx++) {
        const X = x0 * r + dx
        const Y = y0 * r + dy
        const u = Math.floor(((X - left) * image.width) / (w * r))
        const v = Math.floor(((Y - top) * image.height) / (h * r))
        const inside = X >= left && X < left + w * r && Y >= top && Y < bottom
        const shape = inside && u >= 0 && u < image.width && v >= 0 && v < image.height && image.data[(v * image.width + u) * 4 + 3] === 255
        const expected = shape ? ink : ground
        const i = (dy * seen.width + dx) * 4
        if (seen.data[i] !== expected[0] || seen.data[i + 1] !== expected[1] || seen.data[i + 2] !== expected[2]) different++
      }
    }

    return different
  })

  return Math.min(...differences)
}

const tileOf = (page: Page, key: Key) => page.locator('.q-tile', { has: page.locator(`.q-catbanner[data-art="${BANNERS[key].tile}"]`) })
/** A tile's padding box, where its banner is drawn (the banner fills it). */
const bannerBox = (tile: Locator) => rectOf(tile.locator('.q-catbanner'))

const HIDE_TILE_TEXT = '.q-tile-name, .q-tile-foot { visibility: hidden !important }'
/** Whole-pixel tiles: the grid's columns are fractional widths today (X-007 gives the tiles their own grid), and an engine squeezes a picture by a pixel across a fractional box. */
const WHOLE_TILES = '.q-tiles { grid-template-columns: repeat(4, 224px) !important }'
const HIDE_HEADER_CONTENT = '.q-list-head > :not(.q-catbanner-clip) { visibility: hidden !important }'
const progress = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zx-prog-dim'))
const accent = (page: Page) => page.evaluate(() => [getComputedStyle(document.documentElement).getPropertyValue('--zx-acc'), getComputedStyle(document.documentElement).getPropertyValue('--zx-acc-ink')])

test.describe('the picker’s tiles', () => {
  test('every category’s tile draws its own banner, pixel for pixel, in the progress colour on the tile’s ground', async ({ page }) => {
    await boot(page)
    await openPicker(page)
    await page.addStyleTag({ content: HIDE_TILE_TEXT + WHOLE_TILES })
    const ink = colourOf(await progress(page))

    for (const key of KEYS) {
      const tile = tileOf(page, key)
      await tile.scrollIntoViewIfNeeded()
      const entry = BANNERS[key]
      const w = ('tileW' in entry ? entry.tileW : entry.w) * 2
      const h = ('tileH' in entry ? entry.tileH : entry.h) * 2
      expect(await wrong(page, await bannerBox(tile), entry.tile, w, h, entry.x, colourOf(await groundOf(tile)), ink), `${key}: pixels that are not the banner`).toBe(0)
    }
  })

  test('on hover the tile is the accent and the art is its ink, still the same picture', async ({ page }) => {
    await boot(page)
    await openPicker(page)
    await page.addStyleTag({ content: HIDE_TILE_TEXT + WHOLE_TILES })
    const [fill, inkOnFill] = (await accent(page)).map(colourOf) as [Colour, Colour]

    for (const key of ['movie', 'game', 'wrestling'] as const) {
      const tile = tileOf(page, key)
      await tile.scrollIntoViewIfNeeded()
      await tile.hover()
      expect(colourOf(await groundOf(tile)), `${key}: the tile is the accent`).toEqual(fill)
      const entry = BANNERS[key]
      const w = ('tileW' in entry ? entry.tileW : entry.w) * 2
      const h = ('tileH' in entry ? entry.tileH : entry.h) * 2
      expect(await wrong(page, await bannerBox(tile), entry.tile, w, h, entry.x, fill, inkOnFill), `${key}: pixels that are not the banner in the accent's ink`).toBe(0)
    }
  })

  for (const skin of SKINS) {
    test(`${skin}: the banner is that skin's progress colour (a screenshot reading and the computed colour)`, async ({ page }) => {
      await boot(page, { skin })
      await openPicker(page)
      await page.addStyleTag({ content: HIDE_TILE_TEXT + WHOLE_TILES })
      const ink = colourOf(await progress(page))
      const tile = tileOf(page, 'movie')
      await tile.scrollIntoViewIfNeeded()

      expect(colourOf(await tile.locator('.q-catbanner').evaluate((element) => getComputedStyle(element).backgroundColor))).toEqual(ink)
      expect(await wrong(page, await bannerBox(tile), 'movies', 386, 106, 1, colourOf(await groundOf(tile)), ink)).toBe(0)
    })
  }

  test('only the files a tile names are asked for: Pro Wrestling’s ring-only tile file, never its header file; and in Quantum none, with the line art kept', async ({ page, browser }) => {
    const asked: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/theme/art/')) asked.push(request.url().split('/').pop()!.split('?')[0]!)
    })
    await boot(page)
    await openPicker(page)
    await page.waitForLoadState('networkidle')
    const bannerFiles = new Set(KEYS.flatMap((key) => [`${BANNERS[key].header}.png`, `${BANNERS[key].tile}.png`]))
    expect(asked.filter((name) => bannerFiles.has(name)).sort()).toEqual([...new Set(KEYS.map((key) => `${BANNERS[key].tile}.png`))].sort())
    expect(asked).not.toContain('pro-wrestling.png')

    const quantum = await browser.newPage()
    const askedInQuantum: string[] = []
    quantum.on('request', (request) => {
      if (request.url().includes('/theme/art/')) askedInQuantum.push(request.url())
    })
    await boot(quantum, { theme: 'quantum' })
    await openPicker(quantum)
    await quantum.waitForLoadState('networkidle')
    expect(askedInQuantum.filter((url) => [...bannerFiles].some((name) => url.includes(`/${name}`)))).toEqual([])
    expect(await quantum.locator('.q-catbanner').count()).toBe(0)
    expect(await quantum.locator('.q-category-art').count()).toBe(12)
    await quantum.close()
  })

  test('a registry key with no art draws no banner, no empty box and no error, and its tile is there', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await boot(page)
    await page.route('**/api/media-types', async (route) => {
      const real = await route.fetch()
      const types = (await real.json()) as { key: string; label: string; sortOrder: number; defaultDurationMinutes: number; searchAvailable: boolean; previewable: boolean }[]
      await route.fulfill({ response: real, json: [...types, { key: 'podcast', label: 'Podcasts', sortOrder: 999, defaultDurationMinutes: 40, searchAvailable: false, previewable: false }] })
    })
    await page.goto('/')
    await page.locator('.q-picker').waitFor()
    await expect(page.locator('.q-tile')).toHaveCount(13)

    const podcast = page.locator('.q-tile', { hasText: 'Podcasts' })
    await expect(podcast).toHaveCount(1)
    expect(await podcast.locator('.q-catbanner').count()).toBe(0)
    expect(await podcast.locator('.q-category-art').count()).toBe(0)
    expect(await podcast.evaluate((element) => [...element.children].map((child) => child.className))).not.toContain('')
    expect(errors).toEqual([])
  })
})

test.describe('the list header', () => {
  for (const key of KEYS) {
    test(`${key}: the banner is 24px from the header's right edge, on its bottom, pixel for pixel`, async ({ page }) => {
      await boot(page, { mediaType: key })
      await openList(page)
      await page.addStyleTag({ content: HIDE_HEADER_CONTENT })
      const entry = BANNERS[key]
      const head = page.locator('.q-list-head')
      const banner = page.locator('.q-list-head .q-catbanner')
      await expect(banner).toHaveAttribute('data-art', entry.header)

      const at = await rectOf(banner)
      const area = await rectOf(head)
      // 24px from the header's right edge, on its bottom (above the 2px rule), the README's size at two screen px to an art pixel.
      expect(Math.abs(area.right - at.right - 24), 'right 24px').toBeLessThan(1)
      expect(Math.abs(at.bottom - (area.bottom - 2)), 'on the bottom').toBeLessThan(1)
      expect([at.width, at.height]).toEqual([entry.w * 2, entry.h * 2])

      const ground = colourOf(await groundOf(head))
      const ink = colourOf(await progress(page))
      const header = { left: area.left, top: area.top, right: area.right, bottom: area.bottom - 2, width: area.width }
      // The header as a whole: the picture where the element puts it, the header's ground everywhere else.
      expect(await wrong(page, header, entry.header, entry.w * 2, entry.h * 2, 1 - 24 / (area.width - entry.w * 2), ground, ink), 'pixels that are not the banner').toBe(0)
    })
  }
})

test.describe('the list header: where the banner sits', () => {
  test('a header narrower than the banner crops it from the left, never the right: 24px stay clear on the right', async ({ page }) => {
    await boot(page, { mediaType: 'game' })
    await openList(page)
    await page.addStyleTag({ content: HIDE_HEADER_CONTENT + '.q-list-head { width: 300px !important; flex: none !important }' })
    const head = page.locator('.q-list-head')
    const banner = page.locator('.q-list-head .q-catbanner')
    const area = await rectOf(head)
    const at = await rectOf(banner)

    // 300px wide, the banner 460: it is as wide as the header less the 24px on its right, its left edge on the header's.
    expect(area.width).toBe(300)
    expect(Math.abs(at.left - area.left), 'its left edge is the header’s').toBeLessThan(1)
    expect(Math.abs(area.right - at.right - 24), 'right 24px').toBeLessThan(1)
    const box = { left: area.left, top: area.top, right: area.right, bottom: area.bottom - 2, width: area.width }
    // The picture is anchored to its right edge: its left part is what the header crops, so the right end of the art is whole.
    expect(await wrong(page, box, 'games', 460, 112, 1 - 24 / (area.width - 460), colourOf(await groundOf(head)), colourOf(await progress(page))), 'pixels that are not the banner').toBe(0)
  })

  for (const width of [1080, 1440, 1920]) {
    test(`at ${width}px the banner is behind the title, the progress and the buttons, wherever they meet it`, async ({ page }) => {
      await boot(page, { mediaType: 'youtube', width, title: 'The complete and unabridged chronicle of everything that ever happened on the channel, in the order it was published' })
      await openList(page)
      await page.addStyleTag({ content: '.q-catbanner-clip, .q-catbanner { pointer-events: auto !important }' })

      const found = await page.evaluate(() => {
        const head = document.querySelector('.q-list-head')!
        const art = document.querySelector('.q-list-head .q-catbanner')!.getBoundingClientRect()
        const clip = head.getBoundingClientRect()
        const visible = { left: Math.max(art.left, clip.left), top: Math.max(art.top, clip.top), right: Math.min(art.right, clip.right), bottom: Math.min(art.bottom, clip.bottom - 2) }
        const out: { name: string; meets: boolean; above: boolean }[] = []
        for (const selector of ['.q-kicker', '.q-list-title', '.q-progress', '.q-list-actions button']) {
          for (const [at, element] of head.querySelectorAll(selector).entries()) {
            const box = element.getBoundingClientRect()
            const left = Math.max(box.left, visible.left)
            const right = Math.min(box.right, visible.right)
            const top = Math.max(box.top, visible.top)
            const bottom = Math.min(box.bottom, visible.bottom)
            if (right <= left || bottom <= top) {
              out.push({ name: `${selector} ${at}`, meets: false, above: true })
              continue
            }
            const stack = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2)
            const mine = stack.findIndex((node) => element.contains(node))
            const theirs = stack.findIndex((node) => node.classList.contains('q-catbanner') || node.classList.contains('q-catbanner-clip'))
            out.push({ name: `${selector} ${at}`, meets: true, above: mine !== -1 && mine < theirs })
          }
        }

        return out
      })

      expect(found.filter((entry) => entry.meets).length, 'the banner does meet something here (a test that meets nothing proves nothing)').toBeGreaterThan(0)
      for (const entry of found) expect(entry.above, `${entry.name} is above the banner`).toBe(true)
      // The two buttons are in the banner's corner at every width, and so is the long title's second line.
      expect(found.filter((entry) => entry.meets && entry.name.startsWith('.q-list-actions button')).length).toBe(2)
    })
  }

  test('under Quantum the list header has no banner', async ({ page }) => {
    await boot(page, { mediaType: 'movie', theme: 'quantum' })
    await openList(page)

    expect(await page.locator('.q-catbanner, .q-catbanner-clip').count()).toBe(0)
  })

  test('a list of a type with no art has no banner and no empty box in its header', async ({ page }) => {
    await boot(page, { mediaType: 'podcast' })
    await openList(page)

    expect(await page.locator('.q-catbanner, .q-catbanner-clip').count()).toBe(0)
  })

  test('with the layout as it is today (tiles at fractional widths) the picture is the file’s, within the engine’s one-pixel squeeze', async ({ page }) => {
    await boot(page)
    await openPicker(page)
    await page.addStyleTag({ content: HIDE_TILE_TEXT })
    const tile = tileOf(page, 'movie')
    await tile.scrollIntoViewIfNeeded()
    const box = await bannerBox(tile)
    const wrongPixels = await wrong(page, box, 'movies', 386, 106, 1, colourOf(await groundOf(tile)), colourOf(await progress(page)))

    // A fractional box squeezes a picture by a pixel somewhere across it (the grid's columns are fractional until X-007 gives the tiles their own): some edge pixels move, no more.
    expect(wrongPixels / (Math.floor(box.width) * Math.floor(box.height))).toBeLessThan(0.08)
  })
})
