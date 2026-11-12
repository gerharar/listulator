import { expect, test, type Page } from '@playwright/test'

/**
 * Choose Your Fighter's tiles under eX-Zed (found by the owner at Checkpoint G1: "Documentaries" ran out of its card, the tiles being narrower than the label). Design's board is a
 * grid of fixed-height tiles, 4 to a row below 2000px at 160px high and more from 2000px at 184px; here a tile is at least 250px and as many fit as there is room for (4 at 1440,
 * 3 at the narrowest window, 5 on a wide screen), and **no label is cut off**: the name, with its count chip under it when they do not fit together, lies inside the tile.
 */
async function open(page: Page, width: number, skin = 'exzed-1d') {
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
  await page.getByRole('button', { name: 'New List', exact: true }).click()
  await page.locator('.q-tile').first().waitFor()
  await expect(page.locator('.q-tile')).toHaveCount(12)
  await page.evaluate(() => document.fonts.ready)
}

/** The tiles' columns and heights, and what in each leaves its box. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.q-tile')]
    const lefts = new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().left)))
    const out: string[] = []
    for (const tile of tiles) {
      const box = tile.getBoundingClientRect()
      const css = getComputedStyle(tile)
      const left = box.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft)
      const right = box.right - parseFloat(css.borderRightWidth) - parseFloat(css.paddingRight)
      const label = (tile.querySelector('.q-tile-name b')?.textContent ?? '').trim()
      for (const part of tile.querySelectorAll('.q-tile-name > *, .q-tile-foot > *')) {
        const r = part.getBoundingClientRect()
        if (r.width > 0 && (r.right > right + 1 || r.left < left - 1)) out.push(`${label}: ${part.className || part.tagName} ${Math.round(r.left - left)} to ${Math.round(r.right - right)}`)
      }
      const b = tile.querySelector('.q-tile-name b') as HTMLElement
      // A word broken across lines would make a label of one word two.
      const words = label.split(/\s+/).length
      const lines = Math.round(b.getBoundingClientRect().height / parseFloat(getComputedStyle(b).lineHeight || '16'))
      if (lines > words + 1) out.push(`${label}: broken into ${lines} lines`)
    }

    return { columns: lefts.size, heights: [...new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().height)))], out }
  })

for (const [width, columns, height] of [[1440, 4, 160], [1128, 3, 160], [2560, 5, 184]] as const) {
  test(`a ${width}px screen: ${columns} columns of tiles ${height}px high, every label inside its card (a documentary list gives Documentaries its count chip)`, async ({ page }) => {
    const list = await (await page.request.post('/api/lists', { data: { title: `Tile ${Date.now()}`, mediaType: 'documentary' } })).json()
    try {
      await open(page, width)
      const seen = await measure(page)
      expect([seen.columns, seen.heights]).toEqual([columns, [height]])
      expect(seen.out, 'what leaves its tile').toEqual([])
      await expect(page.locator('.q-tile', { hasText: 'Documentaries' }).locator('.q-count-chip')).toHaveCount(1)
    } finally {
      await page.request.delete(`/api/lists/${list.id}`)
    }
  })
}
