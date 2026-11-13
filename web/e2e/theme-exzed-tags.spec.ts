import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng, type Pixels } from './pngPixels.js'

/**
 * eX-Zed's tags, marks and chips (51.6, X-007; design's Tag and Mark cards, the Choose Your Fighter board), on the real screens, in both engines and all six skins, read in pixels:
 * **a status tag (Complete, Ongoing, NEW) is a 20px block of its fixed Spectrum colour with a 2px `chip-ink` ring outside it and `chip-ink` text; a mark (curated star, complete,
 * ongoing, added by hand) is the Icons board's 8x8 drawing, 16px, in its colour on a `chip-ink` cell with a 2px ring, on every skin, Lotus included; the medium and platform tags are
 * a 2px `ink2` outline, centred, every one in a column as wide as the longest; the count chip is a 20px box with a 2px `frame` border.** Quantum draws none of it.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
/** The Icons board's drawings (8x8, one rect each: `M x y h w v h H x z`), as the design system's asset store has them. */
const ICONS = {
  star: 'M3 0h2v2H3zM0 2h8v1H0zM1 3h6v1H1zM2 4h4v1H2zM1 5h6v1H1zM1 6h2v1H1zM5 6h2v1H5z',
  complete: 'M0 0h8v1H0zM0 1h1v1H0zM7 1h1v1H7zM0 2h8v1H0zM1 3h1v3H1zM6 3h1v3H6zM3 4h2v1H3zM1 6h6v1H1z',
  ongoing: 'M1 0h2v4H1zM1 5h2v1H1zM5 2h2v4H5zM5 7h2v1H5z',
  hand: 'M1 1h1v3H1zM3 0h1v4H3zM5 1h1v3H5zM7 3h1v2H7zM1 4h6v3H1zM2 7h4v1H2z',
  add: 'M3 0h2v3H3zM0 3h8v2H0zM3 5h2v3H3z',
  done: 'M7 1h1v1H7zM6 2h1v1H6zM5 3h1v1H5zM4 4h1v1H4zM0 4h1v1H0zM1 5h1v1H1zM3 5h1v1H3zM2 6h1v1H2z',
} as const
type IconName = keyof typeof ICONS
type Rgb = [number, number, number]

const cells = (path: string) => {
  const filled = new Set<string>()
  for (const [, x, y, w, h] of path.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)H\d+z/g)) {
    for (let dx = 0; dx < Number(w); dx++) for (let dy = 0; dy < Number(h); dy++) filled.add(`${Number(x) + dx},${Number(y) + dy}`)
  }

  return filled
}

const SUMMARY = {
  id: 'L1',
  title: 'Marks and tags',
  description: null as string | null,
  mediaType: 'game',
  source: 'canonical',
  externalRef: null,
  status: 'ongoing' as string | null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  stats: { totalItems: 4, consumedItems: 0, newItems: 0, completionPercent: 0, timeRemainingMinutes: 360, lastConsumedAt: null },
}
const item = (n: number, extra: Record<string, unknown>) => ({
  id: `i${n}`,
  listId: 'L1',
  title: `Game ${n}`,
  orderIndex: n,
  timeToConsumeMinutes: 90,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'canonical',
  year: null,
  yearUnk: 0,
  group: null,
  tags: null,
  notes: null,
  isNew: false,
  ...extra,
})
const ITEMS = [item(1, { tags: ['PS3'], isNew: true }), item(2, { tags: ['X360'] }), item(3, { tags: ['PS3', 'X360'] }), item(4, { tags: ['PS4'] }), item(5, { tags: null })]
/** Home's two lists: a curated complete one, and a by-hand ongoing one with three new items. */
const HOME = [
  { ...SUMMARY, id: 'L1', title: 'Curated and complete', status: 'complete' },
  { ...SUMMARY, id: 'L2', title: 'By hand and ongoing', source: 'manual', status: 'ongoing', stats: { ...SUMMARY.stats, newItems: 3 } },
]

async function boot(page: Page, skin: string, lists: unknown[]) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.route('**/api/lists', (route) => route.fulfill({ json: lists }))
  await page.route('**/api/lists/L1', (route) => route.fulfill({ json: { ...SUMMARY, items: ITEMS, groups: [] } }))
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
  await page.locator('.q-home-row').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgbOf = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const css = (c: Rgb) => `rgb(${c.join(', ')})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)

async function roles(page: Page) {
  const names = ['paper', 'ink', 'ink2', 'frame', 'chip-ink', 'info', 'ok', 'warn', 'star', 'hand', 'acc', 'acc-ink'] as const
  const found = await Promise.all(names.map((n) => token(page, `--zx-${n}`)))

  return Object.fromEntries(names.map((n, i) => [n, rgbOf(found[i]!)])) as Record<(typeof names)[number], Rgb>
}
type Roles = Awaited<ReturnType<typeof roles>>

function at(pixels: Pixels, scale: number, x: number, y: number): Rgb {
  const i = (Math.floor(y * scale + scale / 2) * pixels.width + Math.floor(x * scale + scale / 2)) * 4

  return [pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!]
}
async function shoot(page: Page, box: { x: number; y: number; width: number; height: number }, pad: number) {
  // A box on a fractional position is painted on the nearest whole pixel; a half pixel goes up in Chromium and down in WebKit.
  const snap = (value: number) => (test.info().project.name === 'webkit' ? Math.ceil(value - 0.5) : Math.round(value))
  const clip = { x: snap(box.x - pad), y: snap(box.y - pad), width: Math.round(box.width + pad * 2), height: Math.round(box.height + pad * 2) }
  const pixels = decodePng(await page.screenshot({ clip }))

  return { pixels, scale: pixels.width / clip.width }
}

/** A mark: 16px, its 2px `chip-ink` ring, and each of the icon's 64 cells either its colour or the black cell. */
async function readMark(page: Page, mark: Locator, icon: IconName, colour: Rgb, r: Roles, label: string) {
  await page.mouse.move(0, 0)
  await mark.scrollIntoViewIfNeeded()
  const b = (await mark.boundingBox())!
  expect([b.width, b.height], `${label}: 16px`).toEqual([16, 16])
  const { pixels, scale } = await shoot(page, b, 2)
  const p = (x: number, y: number) => at(pixels, scale, x, y)
  expect(p(0.5, 10), `${label}: the 2px ring, left`).toEqual(r['chip-ink'])
  expect(p(10, 0.5), `${label}: the 2px ring, above`).toEqual(r['chip-ink'])
  const filled = cells(ICONS[icon])
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      expect(p(2 + x * 2 + 1, 2 + y * 2 + 1), `${label}: cell ${x},${y}`).toEqual(filled.has(`${x},${y}`) ? colour : r['chip-ink'])
    }
  }
}

/** A tag: 20px, the colour as its fill, `chip-ink` text, and the ring a 2px outline of `chip-ink`, never a shadow. */
async function readTag(page: Page, tag: Locator, fill: Rgb, r: Roles, label: string) {
  const s = await style(tag, ['height', 'background-color', 'color', 'outline-style', 'outline-width', 'outline-color', 'box-shadow', 'font-size', 'font-weight', 'text-transform'])
  expect(s, label).toMatchObject({
    height: '20px',
    'background-color': css(fill),
    color: css(r['chip-ink']),
    'outline-style': 'solid',
    'outline-width': '2px',
    'outline-color': css(r['chip-ink']),
    'box-shadow': 'none',
    'font-size': '16px',
    'font-weight': '400',
    'text-transform': 'uppercase',
  })
  await page.mouse.move(0, 0)
  const b = (await tag.boundingBox())!
  expect(b.height, `${label}: 20px high`).toBe(20)
  const { pixels, scale } = await shoot(page, b, 2)
  expect(at(pixels, scale, 3, 12), `${label}: its fill`).toEqual(fill)
  expect(at(pixels, scale, 0.5, 12), `${label}: the ring outside it`).toEqual(r['chip-ink'])
}

for (const skin of SKINS) {
  test(`${skin}: on My Lists a list's marks are the Icons board's drawings in black cells, and NEW is a 20px info tag with its ring`, async ({ page }) => {
    await boot(page, skin, HOME)
    const r = await roles(page)
    const curated = page.locator('.q-home-row', { hasText: 'Curated and complete' })
    const byHand = page.locator('.q-home-row', { hasText: 'By hand and ongoing' })

    await readMark(page, curated.locator('.q-star'), 'star', r.star, r, 'the curated star')
    await readMark(page, curated.locator('.q-status-mark'), 'complete', r.ok, r, 'the complete mark')
    await readMark(page, byHand.locator('.q-byhand'), 'hand', r.hand, r, 'the by-hand mark (the fixed `hand` colour, answer D18)')
    await readMark(page, byHand.locator('.q-status-mark'), 'ongoing', r.info, r, 'the ongoing mark')
    await readTag(page, byHand.locator('.q-new'), r.info, r, '3 NEW')
  })

  test(`${skin}: in a list the title's star and status tag, the NEW tag and the medium tags are the cards' blocks, and every platform tag is as wide as the longest`, async ({ page }) => {
    await boot(page, skin, [SUMMARY])
    await page.locator('.q-home-row').first().click()
    await page.locator('.q-item').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const r = await roles(page)

    await readMark(page, page.locator('.q-list-title .q-star'), 'star', r.star, r, 'the title’s star')
    await readTag(page, page.locator('.q-list-title .q-status'), r.info, r, 'the Ongoing tag')
    await readTag(page, page.locator('.q-item .q-new').first(), r.info, r, 'the NEW tag')

    // The platform tags: a 2px `ink2` outline on nothing, centred text, one width for the column (five characters, the card's `0 2px` and the 2px border).
    const chips = page.locator('.q-item .q-plat:not(.q-tag-add)')
    await expect(chips).toHaveCount(4)
    // One advance of the chip's own font (`1ch`), measured inside the chip so it is the chip's size that counts.
    const ch = await chips.first().evaluate((chip) => {
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;width:1ch'
      chip.append(probe)
      const width = probe.getBoundingClientRect().width
      probe.remove()

      return width
    })
    expect(ch, 'the font’s advance at 16px').toBe(16)
    for (let n = 0; n < 4; n++) {
      const chip = chips.nth(n)
      expect(await style(chip, ['height', 'border-top-width', 'border-top-style', 'border-top-color', 'background-color', 'color', 'text-align', 'box-shadow']), `platform tag ${n}`).toMatchObject({
        height: '20px',
        'border-top-width': '2px',
        'border-top-style': 'solid',
        'border-top-color': css(r.ink2),
        'background-color': 'rgba(0, 0, 0, 0)',
        color: css(r.ink2),
        'text-align': 'center',
        'box-shadow': 'none',
      })
      expect((await chip.boundingBox())!.width, `platform tag ${n}: five characters and 8px`).toBeCloseTo(5 * ch + 8, 0)
    }

    // The add-tag chip an untagged row shows (answer D17): the medium tag's box, the column's width, the `add` pixel icon centred in `ink2`; hover is the highlight.
    const add = page.locator('.q-item .q-plat.q-tag-add')
    await expect(add).toHaveCount(1)
    expect(await style(add, ['height', 'border-top-width', 'border-top-style', 'border-top-color', 'background-color', 'color'])).toMatchObject({
      height: '20px',
      'border-top-width': '2px',
      'border-top-style': 'solid',
      'border-top-color': css(r.ink2),
      'background-color': 'rgba(0, 0, 0, 0)',
      color: css(r.ink2),
    })
    await page.mouse.move(0, 0)
    const box = (await add.boundingBox())!
    expect(box.width, 'the column’s width').toBeCloseTo(5 * ch + 8, 0)
    const shot = await shoot(page, box, 0)
    const left = (box.width - 16) / 2
    const filled = cells(ICONS.add)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (filled.has(`${x},${y}`)) expect(at(shot.pixels, shot.scale, left + x * 2 + 1, 2 + y * 2 + 1), `the add icon: cell ${x},${y} in ink2`).toEqual(r.ink2)
      }
    }
    await add.hover()
    expect(await style(add, ['background-color', 'color'])).toEqual({ 'background-color': css(r['acc-ink']), color: css(r.acc) })

    // Hovering a platform tag (a button: it opens the platform list) lights the row (the highlight, everything in it `acc-ink`, 51.7), and the tag under the pointer is the row's lit-button
    // rule: an `acc-ink` block with its text in `acc` (an `acc` tag on an `acc` row would vanish).
    await chips.first().hover()
    expect(await style(chips.first(), ['background-color', 'color', 'border-top-color'])).toEqual({
      'background-color': css(r['acc-ink']),
      color: css(r.acc),
      'border-top-color': css(r['acc-ink']),
    })
  })
}

for (const skin of SKINS) {
  test(`${skin}: ALL DONE is the done pixel icon then the words, both ink2, with no tick glyph in the text (answer D19)`, async ({ page }) => {
    await boot(page, skin, [SUMMARY])
    const finished = ITEMS.map((entry) => ({ ...entry, consumedAt: '2026-01-02T00:00:00Z' }))
    await page.route('**/api/lists/L1', (route) => route.fulfill({ json: { ...SUMMARY, status: 'complete', stats: { ...SUMMARY.stats, consumedItems: 5, totalItems: 5 }, items: finished, groups: [] } }))
    await page.locator('.q-home-row').first().click()
    await page.locator('.q-item').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const r = await roles(page)
    const left = page.locator('.q-list-head .q-left.all-done')
    await expect(left).toHaveCount(1)
    expect(await left.evaluate((el) => (el as HTMLElement).innerText), 'the words, in capitals, without the glyph the font lacks').toBe('ALL DONE')
    expect((await style(left, ['color'])).color).toBe(css(r.ink2))

    const icon = left.locator('.q-done-icon')
    await expect(icon).toHaveCount(1)
    await page.mouse.move(0, 0)
    const b = (await icon.boundingBox())!
    expect([b.width, b.height], 'the icon is 16px').toEqual([16, 16])
    const { pixels, scale } = await shoot(page, b, 0)
    for (const key of cells(ICONS.done)) {
      const [x, y] = key.split(',').map(Number) as [number, number]
      expect(at(pixels, scale, x * 2 + 1, y * 2 + 1), `the done icon: cell ${key} in ink2`).toEqual(r.ink2)
    }
    const text = await left.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents([...el.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!)

      return range.getBoundingClientRect().left
    })
    expect(text - (b.x + b.width), 'the words start 8px after the icon').toBeCloseTo(8, 0)
  })

  test(`${skin}: the Music Live flag is a 4x4 square in the highlight colour, centred on the text line, 8px from the text (answer D20)`, async ({ page }) => {
    const music = { ...SUMMARY, mediaType: 'music' }
    await boot(page, skin, [music])
    await page.route('**/api/lists/L1', (route) => route.fulfill({ json: { ...music, items: [item(1, { tags: ['Album', 'Live'] }), item(2, { tags: ['Album'] })], groups: [] } }))
    await page.locator('.q-home-row').first().click()
    await page.locator('.q-item').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const r = await roles(page)
    const dot = page.locator('.q-item .q-tag-mark')
    await expect(dot).toHaveCount(1)
    expect(await style(dot, ['width', 'height', 'border-top-left-radius', 'border-bottom-right-radius', 'margin-left', 'background-color'])).toEqual({
      width: '4px',
      height: '4px',
      'border-top-left-radius': '0px',
      'border-bottom-right-radius': '0px',
      'margin-left': '8px',
      'background-color': css(r.acc),
    })
    // Centred on the 16px text line of its tag: the dot's middle is the label's middle.
    const placed = await dot.evaluate((el) => {
      const tag = el.parentElement!
      const label = document.createRange()
      label.selectNodeContents([...tag.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!)
      const text = label.getBoundingClientRect()
      const mark = el.getBoundingClientRect()

      return { middle: Math.abs(mark.top + mark.height / 2 - (text.top + text.height / 2)), gap: mark.left - text.right }
    })
    expect(placed.middle, 'centred on the text line').toBeLessThanOrEqual(1)
    expect(placed.gap, '8px from the text').toBeCloseTo(8, 0)
  })
}

test.describe('Choose Your Fighter', () => {
  for (const skin of SKINS) {
    test(`${skin}: a tile's count chip is a 20px box with a 2px frame border (the board's), and on hover its border is the highlight's ink`, async ({ page }) => {
      const list = await (await page.request.post('/api/lists', { data: { title: `Tags ${test.info().project.name} ${Date.now()}`, mediaType: 'documentary' } })).json()
      try {
        await page.setViewportSize({ width: 1440, height: 1000 })
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
        await page.getByRole('button', { name: 'New List', exact: true }).click()
        await page.locator('.q-tile').first().waitFor()
        await page.evaluate(() => document.fonts.ready)
        const r = await roles(page)
        const tile = page.locator('.q-tile', { hasText: 'Documentaries' })
        const chip = tile.locator('.q-count-chip')

        expect(await style(chip, ['height', 'border-top-width', 'border-top-style', 'border-top-color', 'padding-left', 'padding-right', 'background-color', 'color', 'box-sizing', 'font-size'])).toEqual({
          height: '20px',
          'border-top-width': '2px',
          'border-top-style': 'solid',
          'border-top-color': css(r.frame),
          'padding-left': '2px',
          'padding-right': '2px',
          'background-color': 'rgba(0, 0, 0, 0)',
          color: css(r.ink),
          'box-sizing': 'border-box',
          'font-size': '16px',
        })
        await tile.hover()
        expect((await style(chip, ['border-top-color']))['border-top-color'], 'on hover').toBe(css(r['acc-ink']))
      } finally {
        await page.request.delete(`/api/lists/${list.id}`)
      }
    })
  }
})

test.describe('the free-key chip on a tile', () => {
  for (const skin of SKINS) {
    test(`${skin}: it is the board's 20px box with a 2px frame border on a paper plate, standing above the source line with 6px between`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
      await page.route('**/api/lists', (route) => route.fulfill({ json: [] }))
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
      await page.locator('.q-tile').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      const r = await roles(page)
      const tile = page.locator('.q-tile', { has: page.locator('.q-catbanner[data-art="games"]') })
      // The web build never needs a key (only the desktop app does): put the chip in as the markup has it, after the source line.
      await tile.locator('.q-tile-foot').evaluate((foot) => {
        const chip = document.createElement('span')
        chip.className = 'q-key-chip'
        chip.textContent = 'Free key needed'
        foot.append(chip)
      })
      const chip = tile.locator('.q-key-chip')

      expect(await style(chip, ['height', 'border-top-width', 'border-top-style', 'border-top-color', 'padding-left', 'background-color', 'color', 'font-size'])).toEqual({
        height: '20px',
        'border-top-width': '2px',
        'border-top-style': 'solid',
        'border-top-color': css(r.frame),
        'padding-left': '2px',
        'background-color': css(r.paper),
        color: css(r.ink),
        'font-size': '16px',
      })
      const key = (await chip.boundingBox())!
      const source = (await tile.locator('.q-tile-src').boundingBox())!
      expect(key.y + key.height, 'the chip is above the source line').toBeLessThanOrEqual(source.y)
      expect(source.y - (key.y + key.height), 'with 6px between').toBe(6)
      expect(Math.abs(key.x - source.x), 'both start at the tile’s left').toBeLessThanOrEqual(2)
    })
  }
})
