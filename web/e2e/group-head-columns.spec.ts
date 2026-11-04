import { chromium, expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { settled } from './groupLineMarks.js'

/**
 * BL-160 (the owner, Windows, 2026-11-04): the progress bars on a list's group heads sat in different columns, each moving left as its
 * count or time left grew longer, where My Lists keeps every bar in one. Every head now gives the count and the time the width of the widest
 * group at its longest, so the bars start at one x and the sentences end at one x. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  // Three groups whose count ("2/2", "12/12", "130/130") and time ("1h", "18h", "10h 50m") differ in length.
  const shapes = [
    { group: 'Short', size: 2, minutes: 30 },
    { group: 'Middle', size: 12, minutes: 90 },
    { group: 'Long', size: 130, minutes: 5 },
  ]
  const items = shapes.flatMap(({ group, size, minutes }) =>
    Array.from({ length: size }, (_, n) => ({ title: `${group} ${n}`, timeToConsumeMinutes: minutes, group })),
  )
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return list.id as string
}

/** The widest spread of a set of x positions: layout units are 1/64 px, and a text exactly as wide as its slot can land one unit past it, which no screen can show. */
const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs)

/** Where each head's bar starts and where its sentence ends, in one evaluation. */
const edges = (page: Page): Promise<{ bar: number; end: number }[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.q-group')].map((head) => {
      const bar = head.querySelector('.q-meter')!.getBoundingClientRect()
      const time = head.querySelector('.q-slot.time')!.getBoundingClientRect()

      return { bar: bar.left, end: time.right }
    }),
  )

test('every group head draws its bar in the same column, and a tick does not move any of them', async ({ baseURL, page, request }) => {
  const title = `e2e group-head-columns ${Date.now()}`
  const id = await makeList(request, title)

  try {
    await page.goto(baseURL!)
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.locator('.q-group').first().waitFor()
    await settled(page)

    const before = await edges(page)

    expect(before).toHaveLength(3)
    expect(spread(before.map((head) => head.bar)), `bar x per head: ${before.map((head) => head.bar).join(', ')}`).toBeLessThan(0.5)
    expect(spread(before.map((head) => head.end)), `sentence end x per head: ${before.map((head) => head.end).join(', ')}`).toBeLessThan(0.5)

    // Finishing the short group turns its time into "✓ All Done", drawn smaller: still the same column.
    await page.locator('.q-group').first().locator('.q-group-done').click()
    await expect(page.locator('.q-group').first().locator('.q-left.all-done')).toBeVisible()
    await settled(page)

    const after = await edges(page)

    expect(spread(after.map((head) => head.bar)), `bar x after the tick: ${after.map((head) => head.bar).join(', ')}`).toBeLessThan(0.5)
    expect(after[0]!.bar).toBeCloseTo(before[0]!.bar, 0)
  } finally {
    await request.delete(`/api/lists/${id}`)
  }
})

// The owner saw it on Windows at 125%: the real scale (Chromium's flag, as the repo's other scale specs do), where `ch` and the 7px cells land on fractions.
for (const scale of [1.25, 1.5]) {
  test(`at a display scale of ${scale} the bars and the sentences' ends are still in one column`, async ({ browserName, baseURL, request }) => {
    test.skip(browserName !== 'chromium', 'the flag is Chromium’s')
    const title = `e2e group-head-columns ${scale} ${Date.now()}`
    const id = await makeList(request, title)
    const browser = await chromium.launch({ args: [`--force-device-scale-factor=${scale}`] })
    const context = await browser.newContext({ baseURL: baseURL!, deviceScaleFactor: scale, viewport: { width: 1200, height: 900 } })

    try {
      const page = await context.newPage()
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-group').first().waitFor()
      await settled(page)

      const heads = await edges(page)

      expect(heads).toHaveLength(3)
      expect(spread(heads.map((head) => head.bar)), `bar x per head: ${heads.map((head) => head.bar).join(', ')}`).toBeLessThan(0.5)
      expect(spread(heads.map((head) => head.end)), `sentence end x per head: ${heads.map((head) => head.end).join(', ')}`).toBeLessThan(0.5)
    } finally {
      await context.close()
      await browser.close()
      await request.delete(`/api/lists/${id}`)
    }
  })
}
