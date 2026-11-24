import { readFileSync } from 'node:fs'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { finishedBands } from '../src/components/quantum/art/finishedBanner.js'
import { decodePng } from './pngPixels.js'

/**
 * A finished list's header banner in eX-Zed (57.11c; X-008, design's D64): the finished bar's rule drawn to the banner's box. Four bands, each a quarter of the box's width, red, yellow, green and cyan from the left, every edge slanted
 * 45 degrees (2px left for each 2px row down) and crossing its quarter point at the middle row, on the 2px grid; the category's mask cuts it; the paper cells stay over it; no flash. Read in pixels: with the header's own content hidden, every
 * pixel the movies mask keeps is named and compared with the band that rule puts there, in six skins and both engines.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
const MASK = decodePng(readFileSync(new URL('../src/styles/theme/art/movies.png', import.meta.url)))
const W = MASK.width
const H = MASK.height
const ROWS = finishedBands(W, H)

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
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items: Array.from({ length: count }, (_, n) => ({ title: `Item ${n + 1}`, timeToConsumeMinutes: 61 })) } })
  const items = ((await (await request.get(`/api/lists/${list.id}`)).json()).items as Array<{ id: string }>).slice(0, done)
  await Promise.all(items.map((item) => request.put(`/api/lists/${list.id}/items/${item.id}/consumed`, { data: { consumed: true } })))

  return list.id as string
}

const BANDS: Array<[number, number, number]> = [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255]]
const unique = () => `${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

for (const skin of SKINS) {
  test(`${skin}: a finished list's banner is the four bands, a quarter of the box each, slanted 45 degrees, cut by the category's mask`, async ({ page }) => {
    const title = `Banner done ${skin}-${unique()}`
    const id = await makeList(page.request, title, 3, 3)
    try {
      await seed(page, skin)
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-item').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      // The header's own content is hidden, so nothing is drawn over the banner: the paper cells are not under test here.
      await page.addStyleTag({ content: '.q-list-head > :not(.q-catbanner-clip) { visibility: hidden !important }' })
      const banner = page.locator('.q-list-head .q-catbanner')
      await expect(banner).toHaveAttribute('data-finished', '')
      const box = (await banner.boundingBox())!
      expect([box.width, box.height], 'the banner is the art’s box').toEqual([W, H])

      const shot = decodePng(await banner.screenshot())
      const scale = shot.width / W
      expect([shot.width, shot.height], 'the shot is the box at the device scale').toEqual([W * scale, H * scale])
      const bad: string[] = []
      let checked = 0
      for (let y = 0; y < H; y++) {
        const bands = ROWS[y >> 1]!.bands
        for (let x = 0; x < W; x++) {
          if (MASK.data[(y * W + x) * 4 + 3] !== 255) continue
          checked++
          const at = bands.findIndex((band) => x >= band.x && x < band.x + band.width)
          const want = BANDS[at]!
          const at4 = (Math.floor((y + 0.5) * scale) * shot.width + Math.floor((x + 0.5) * scale)) * 4
          const got = [shot.data[at4]!, shot.data[at4 + 1]!, shot.data[at4 + 2]!]
          if (got.some((channel, n) => Math.abs(channel - want[n]!) > 2)) bad.push(`(${x},${y}) got ${got} want ${want}`)
        }
      }
      expect(checked, 'the mask keeps a good part of the box').toBeGreaterThan(2000)
      expect(bad.slice(0, 5), `${bad.length} of ${checked} masked pixels are not the band the rule puts there`).toEqual([])
      expect(await banner.evaluate((el) => getComputedStyle(el).animationName), 'the banner does not flash').toBe('none')
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}

test('the banner follows the list: ticking the last item draws the bands, unticking takes them away; an unfinished list has none', async ({ page }) => {
  const title = `Banner live ${unique()}`
  const id = await makeList(page.request, title, 2, 1)
  try {
    await seed(page, 'exzed-1d')
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.locator('.q-item').first().waitFor()
    const banner = page.locator('.q-list-head .q-catbanner')
    await expect(banner).not.toHaveAttribute('data-finished', '')
    await expect(banner.locator('svg')).toHaveCount(0)

    const last = page.locator('.q-item', { hasText: 'Item 2' }).getByRole('checkbox')
    await last.click()
    await expect(banner).toHaveAttribute('data-finished', '')
    await expect(banner.locator('svg.q-catbanner-bands rect')).toHaveCount((H / 2) * 4)

    await last.click()
    await expect(banner).not.toHaveAttribute('data-finished', '')
    await expect(banner.locator('svg')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a list with no items has no bands (nothing is finished)', async ({ page }) => {
  const title = `Banner empty ${unique()}`
  const id = await makeList(page.request, title, 0, 0)
  try {
    await seed(page, 'exzed-1d')
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.locator('.q-list-head .q-catbanner')).toHaveCount(1)
    await expect(page.locator('.q-list-head .q-catbanner svg')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
