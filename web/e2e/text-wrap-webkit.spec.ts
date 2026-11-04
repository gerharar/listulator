import { expect, test } from '@playwright/test'

/**
 * BL-161 (the owner, Mac, 2026-11-04): WebKit's `text-wrap: pretty` ended every line of a list description 50 to 60 px short of its box (727, 720, 716, 726 of 787
 * px, where plain wrapping gave 776, 783, 773, 557); Chromium wraps the same either way. `pretty` (H-021) now stays everywhere but WebKit.
 * Real writes on the dev server, removed in a `finally`.
 */
const description =
  "All releases in the Marvel Cinematic Universe (MCU) franchise made by Marvel Studios, in release order. Includes Agents Of S.H.I.E.L.D. (early seasons tie into the mainline MCU movies) and Netflix series (confirmed canonical). Does not include TV series and animated series not related to MCU (Inhumans, X-Men '97, etc). Seasons 1 and 2 of Agents of S.H.I.E.L.D. are split up to fit around the corresponding MCU movies in chronological viewing order"

test('a long list description reaches the edge of its box on every line but the last, and keeps `pretty` where it is safe', async ({ browserName, baseURL, page, request }) => {
  const title = `e2e text-wrap ${Date.now()}`
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv', description } })).json()

  try {
    await page.setViewportSize({ width: 1000, height: 900 })
    await page.goto(baseURL!)
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.locator('.q-list-description').waitFor()

    const read = await page.evaluate(() => {
      const element = document.querySelector('.q-list-description') as HTMLElement
      const box = element.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(element)
      const ends = new Map<number, number>()
      for (const rect of range.getClientRects()) ends.set(Math.round(rect.top), Math.max(ends.get(Math.round(rect.top)) ?? 0, rect.right))

      return { style: getComputedStyle(element).textWrapStyle, box: box.width, lines: [...ends.values()].map((right) => right - box.left) }
    })
    const full = read.lines.slice(0, -1)

    expect(full.length, JSON.stringify(read)).toBeGreaterThanOrEqual(2)
    // Plain wrapping leaves a line at most one short word under the box; the bug left 50 to 60 px.
    expect(Math.min(...full), JSON.stringify(read)).toBeGreaterThan(read.box - 40)
    // `text-wrap: wrap` leaves the style at its initial `auto`.
    expect(read.style).toBe(browserName === 'webkit' ? 'auto' : 'pretty')
  } finally {
    await request.delete(`/api/lists/${list.id}`)
  }
})
