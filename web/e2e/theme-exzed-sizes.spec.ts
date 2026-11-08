import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * eX-Zed's sizes (Phase 48.4), computed in both engines and both themes. Rows: an item, a group header, a row's handle and done box and its
 * row-size buttons are 32px under eX-Zed (46, 47, 46, 46 and 46 in Quantum); controls: a button and a header icon button are 40px. A long list
 * (drawn as a window) still lands every row where the model puts it, which only holds if the model was laid out at the page's own row height.
 * What overflows inside a 32px row (the checkbox, the handle, the row buttons) is noted, not fixed, here: X-007 draws those parts. Real writes
 * on the dev server, removed in a `finally`.
 */
const ROWS = { exzed: { item: 32, group: 32 }, quantum: { item: 46, group: 47 } } as const

async function makeList(request: APIRequestContext, title: string, rows = 3) {
  const items = Array.from({ length: rows }, (_, n) => `  - { title: "Item ${String(n + 1).padStart(3, '0')}", minutes: 30, group: "${rows > 50 ? 'Long' : 'Season 1'}" }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${items.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

async function boot(page: Page, theme: string) {
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ theme, skin: 'dark-orange', reducedMotion: 'true' }))
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
}

const heightOf = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().height)

for (const theme of ['exzed', 'quantum'] as const) {
  test.describe(`with the theme ${theme}`, () => {
    test('an item row, a group header, a row’s handle and done box and its row-size buttons', async ({ page }) => {
      const title = `e2e sizes rows ${theme} ${Date.now()}`
      const id = await makeList(page.request, title)

      try {
        await boot(page, theme)
        await openList(page, title)

        expect(await heightOf(page, '.q-item')).toBe(ROWS[theme].item)
        expect(await heightOf(page, '.q-group')).toBe(ROWS[theme].group)
        expect(await heightOf(page, '.q-item .q-handle')).toBe(ROWS[theme].item)
        expect(await heightOf(page, '.q-item .q-done')).toBe(ROWS[theme].item)
        expect(await heightOf(page, '.q-item .q-icon-btn.row')).toBe(ROWS[theme].item)
      } finally {
        await page.request.delete(`/api/lists/${id}`)
      }
    })

    test('a button and the icon buttons', async ({ page }) => {
      const title = `e2e sizes controls ${theme} ${Date.now()}`
      const id = await makeList(page.request, title)

      try {
        await boot(page, theme)
        await page.goto('/')
        await page.locator('.q-home-row').first().waitFor()
        const quantum = theme === 'quantum'

        if (!quantum) expect(await heightOf(page, '.q-btn.primary')).toBe(40)
        expect(await heightOf(page, 'header .q-icon-btn, .q-icon-btn')).toBe(quantum ? 36 : 40)

        await openList(page, title)
        expect(await heightOf(page, '.q-icon-btn.list')).toBe(quantum ? 34 : 40)
      } finally {
        await page.request.delete(`/api/lists/${id}`)
      }
    })
  })
}

test('with the theme exzed, a long list is drawn as a window of 32px rows that tile exactly, and its last row is reachable', async ({ page }) => {
  const title = `e2e sizes window ${Date.now()}`
  const id = await makeList(page.request, title, 400)

  try {
    await boot(page, 'exzed')
    await openList(page, title)
    const scroller = page.locator('.q-list-body')

    const drawn = await page.locator('.q-item').count()
    expect(drawn, 'a window, not all 400 rows').toBeLessThan(400)

    // The rows that are drawn sit one under another with nothing between them.
    const tops = await page.locator('.q-item').evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().top))
    for (let n = 1; n < tops.length; n++) expect(tops[n]! - tops[n - 1]!).toBe(32)

    // Scrolled to the end, the last row is on screen, and the whole list is as tall as 400 rows plus a header.
    const total = await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight
      return el.scrollHeight
    })
    await page.locator('.q-item', { hasText: 'Item 400' }).waitFor()
    expect(total).toBeGreaterThanOrEqual(32 + 400 * 32)
    expect(total).toBeLessThan(32 + 400 * 32 + 400)
    const last = await page.locator('.q-item', { hasText: 'Item 400' }).evaluate((el) => el.getBoundingClientRect().bottom)
    const bottom = await scroller.evaluate((el) => el.getBoundingClientRect().bottom)
    expect(last).toBeLessThanOrEqual(bottom + 1)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
