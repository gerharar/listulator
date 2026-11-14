import { expect, test, type Page } from '@playwright/test'
import { decodePng } from './pngPixels.js'

/**
 * The italic (design's D39, 2026-11-14: drawn after Code Name: Viper) in a 40px field, in all six skins and both engines. Design's two notes: Й, Ё, Ä, Ö, Ü and ä put their marks one row above the font's ascent, and Viper's
 * descenders (g, j, p, q, y) reach a second row below the baseline, 2px lower than the regular face's. A field clips what falls outside its content box, so the placeholder is read in pixels: the ink must not touch the
 * content box's first or last row, in either alphabet.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
const PLACEHOLDERS = ['Йёäöü ÄÖÜ ЙЁ Ää gjpqy', 'Щщ Ђђ ЙйЁё Ддж ру gjpqy Zy']

async function open(page: Page, skin: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.addInitScript((entries) => {
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin }))
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

for (const skin of SKINS) {
  test(`${skin}: the italic's marks and descenders are not cut off in a 40px field`, async ({ page }) => {
    await open(page, skin)
    for (const [index, text] of PLACEHOLDERS.entries()) {
      await page.evaluate(
        ([placeholder, id]) => {
          const field = document.createElement('input')
          field.className = 'q-input'
          field.id = `probe-${id}`
          field.placeholder = placeholder!
          field.style.cssText = 'position:fixed;left:40px;top:120px;width:480px;z-index:9999'
          document.body.append(field)
        },
        [text, String(index)],
      )
      const field = page.locator(`#probe-${index}`)
      await page.evaluate(() => document.fonts.ready)
      const geometry = await field.evaluate((element) => {
        const s = getComputedStyle(element)
        const px = (v: string) => parseFloat(v)
        const rect = element.getBoundingClientRect()

        return {
          height: rect.height,
          top: px(s.borderTopWidth) + px(s.paddingTop),
          bottom: rect.height - px(s.borderBottomWidth) - px(s.paddingBottom),
          left: px(s.borderLeftWidth) + px(s.paddingLeft),
          right: rect.width - px(s.borderRightWidth) - px(s.paddingRight),
          background: s.backgroundColor,
          italic: s.fontStyle,
        }
      })
      expect(geometry.height, 'a 40px field').toBe(40)
      expect(geometry.italic, 'the placeholder is the italic').toBeDefined()

      const picture = decodePng(await field.screenshot({ scale: 'css' }))
      const [r, g, b] = geometry.background.match(/\d+/g)!.map(Number) as [number, number, number]
      let first = Infinity
      let last = -Infinity
      for (let y = Math.ceil(geometry.top); y < Math.floor(geometry.bottom); y++) {
        for (let x = Math.ceil(geometry.left); x < Math.floor(geometry.right); x++) {
          const i = (y * picture.width + x) * 4
          if (Math.abs(picture.data[i]! - r) + Math.abs(picture.data[i + 1]! - g) + Math.abs(picture.data[i + 2]! - b) > 30) {
            first = Math.min(first, y)
            last = Math.max(last, y)
          }
        }
      }
      expect(Number.isFinite(first), `${text}: the placeholder is drawn`).toBe(true)
      expect(first, `${text}: the top of the ink (${first}) is inside the content box (from ${geometry.top})`).toBeGreaterThan(geometry.top)
      expect(last, `${text}: the bottom of the ink (${last}) is inside the content box (to ${geometry.bottom})`).toBeLessThan(geometry.bottom - 1)
    }
  })
}
