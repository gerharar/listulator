import { chromium, expect, test, type APIRequestContext } from '@playwright/test'
import { lineRowsPerHead, settled } from './groupLineMarks.js'

/**
 * BL-153 (the owner, Windows at 125%, 2026-10-28): the group line is "1px", which is 1.25 device pixels at 125%, so the screen snapped it to 1 pixel row
 * on some group heads and 2 on others (heads 58.75 device pixels apart). It is now a whole number of device pixels, the same on every head: read from
 * the rendered pixels at several display scales (the layout alone says "1px" everywhere). Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  const items = Array.from({ length: 48 }, (_, n) => ({ title: `Entry ${n}`, timeToConsumeMinutes: 30, group: `Season ${Math.floor(n / 2) + 1}` }))
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return list.id as string
}

// The real scale, as the repo's other scale specs do (the flag is Chromium's; Windows' WebView2 is Chromium): a context's `deviceScaleFactor` alone only
// emulates it, and the emulation anti-aliases a line where the real thing snaps it to whole pixel rows, which is what the owner saw.
for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
  test(`at a display scale of ${scale} every shut head's line is the same whole number of pixel rows`, async ({ browserName, baseURL, request }) => {
    test.skip(browserName !== 'chromium', 'the flag is Chromium’s')
    const title = `e2e group-line-scale ${scale} ${Date.now()}`
    const id = await makeList(request, title)
    const browser = await chromium.launch({ args: [`--force-device-scale-factor=${scale}`] })
    const context = await browser.newContext({ baseURL: baseURL!, deviceScaleFactor: scale, viewport: { width: 1200, height: 1100 } })

    try {
      const page = await context.newPage()
      await page.addInitScript(() => localStorage.setItem('markOpenGroups', 'true'))
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-group').first().waitFor()
      await page.locator('.q-fold').click()
      await settled(page)

      const rows = await lineRowsPerHead(page, 14)

      expect(rows).toHaveLength(14)
      // One thickness for all of them, and the whole number of device pixels nearest 1px (a tie goes down: 150% stays one row), never a fraction that snaps both ways.
      expect(new Set(rows), `rows per head: ${rows.join(',')}`).toEqual(new Set([Math.max(1, Math.ceil(scale - 0.5))]))
    } finally {
      await context.close()
      await browser.close()
      await request.delete(`/api/lists/${id}`)
    }
  })
}
