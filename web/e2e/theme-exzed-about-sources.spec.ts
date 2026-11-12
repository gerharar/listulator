import { expect, test, type Page } from '@playwright/test'

/**
 * About's Data sources table under eX-Zed (51.2d, X-007; found by the owner at Checkpoint G1: "MusicBrainz" and "Wikipedia" ran into the description beside them and "Open Library" and
 * "Comic Vine" broke in two). Quantum's 120px name column was measured in its font; this one is about 2.1 times as wide. On the real screen, in both engines and all six skins, at the
 * window's narrowest and widest: **every source's name stays on one line, inside its own cell, and the description starts to the right of it**, in the same column in every row.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
const WIDTHS = [1080, 1620] as const

async function boot(page: Page, skin: string, width: number) {
  await page.setViewportSize({ width, height: 900 })
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
  await page.getByRole('button', { name: 'About', exact: true }).click()
  await page.locator('.q-about-source').first().waitFor()
  // The Spectrum font decides every width here: measure after it has loaded, not with the fallback.
  await page.evaluate(() => document.fonts.ready)
}

const measure = (page: Page) =>
  page.locator('.q-about-source').evaluateAll((rows) =>
    rows.map((row) => {
      const name = row.querySelector('.q-about-source-name')!
      const powers = row.querySelector('.q-about-source-powers')!
      // The words only (TMDB's name carries a chevron, whose box is taller than a line of text).
      const range = document.createRange()
      const walker = document.createTreeWalker(name, NodeFilter.SHOW_TEXT)
      const rects: DOMRect[] = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        range.selectNodeContents(node)
        rects.push(...range.getClientRects())
      }
      const cell = name.getBoundingClientRect()
      const lines = new Set(rects.map((r) => Math.round(r.top))).size
      const text = { right: Math.max(...rects.map((r) => r.right)) }
      return {
        source: name.textContent!.trim(),
        lines,
        textRight: Math.round(text.right),
        cellRight: Math.round(cell.right),
        powersLeft: Math.round(powers.getBoundingClientRect().left),
        nameLeft: Math.round(cell.left),
      }
    }),
  )

for (const skin of SKINS) {
  for (const width of WIDTHS) {
    test(`${skin} at ${width}px: every source's name is on one line inside its cell, the descriptions start in one column to the right of the names`, async ({ page }) => {
      await boot(page, skin, width)
      const rows = await measure(page)
      expect(rows.length).toBeGreaterThanOrEqual(6)
      for (const row of rows) {
        expect(row.lines, `${row.source} on one line`).toBe(1)
        expect(row.textRight, `${row.source} inside its cell`).toBeLessThanOrEqual(row.cellRight)
        expect(row.powersLeft, `${row.source} clear of its description`).toBeGreaterThan(row.textRight)
      }
      expect(new Set(rows.map((row) => row.powersLeft)).size, 'one column of descriptions').toBe(1)
    })
  }
}
