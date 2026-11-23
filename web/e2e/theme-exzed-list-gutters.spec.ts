import { expect, test, type Page } from '@playwright/test'

/**
 * The list screen's gutters under eX-Zed (57.7b, design's D57 and D58): the head, the filter bar and the rows' area are 24px in from the window's border on each side (the Window card's
 * `space-3`; Quantum's 26px and 22px are not on the theme's 8px steps), the head 24px above, the filter bar 12px above and below its 40px control (its row is the same 64px, a 1px line
 * under it: D58 made 13/11 whole 2px steps), the rows' area 24px at the bottom, the progress row 24px all round and the error strip 10px above with 24px at its sides. The rail, whose cap
 * follows the window's outside (D55), does not move. In both engines, six skins at 1440; the progress row (a delayed fetch) and the error strip (a failed write) in Lode.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

async function openList(page: Page, skin: string, options: { slowFetch?: boolean } = {}) {
  const rows = Array.from({ length: 30 }, (_, n) => `  - { title: "Item ${n + 1}", minutes: 30, group: "Season ${Math.floor(n / 10) + 1}" }`)
  const title = `e2e list gutters ${skin} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`
  const made = await page.request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  const id = (await made.json()).id as string
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
  if (options.slowFetch) {
    await page.route(`**/api/lists/${id}`, async (route) => {
      if (route.request().method() === 'GET') await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })
  }
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()

  return { id, title }
}

const paddings = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((element) => {
    const style = getComputedStyle(element)

    return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
  })

for (const skin of SKINS) {
  test(`${skin}: the head, the filter bar and the rows' area are 24px in from the window's border`, async ({ page }) => {
    const { id } = await openList(page, skin)
    try {
      await page.locator('.q-item').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(500)

      expect(await paddings(page, '.q-list-head'), 'the head: 24px above and at the sides').toEqual(['24px', '24px', '0px', '24px'])
      expect(await paddings(page, '.q-filterbar'), 'the filter bar: 12px above and below, 24px at the sides').toEqual(['12px', '24px', '12px', '24px'])
      expect(await paddings(page, '.q-list-body'), 'the rows’ area: 24px at the sides and below').toEqual(['0px', '24px', '24px', '24px'])

      const at = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
        const layer = box('.q-layer')
        const border = parseFloat(getComputedStyle(document.querySelector('.q-layer')!).borderLeftWidth)
        const body = box('.q-list-body')

        return {
          inner: layer.left + border,
          innerRight: layer.right - border,
          title: box('.q-list-title').left,
          filter: box('.q-filter-input').left,
          filterBarHeight: box('.q-filterbar').height,
          item: box('.q-item').left,
          itemRight: box('.q-item').right,
          bodyLeft: body.left,
          bodyRight: body.right,
          rail: box('.q-rail').left,
          railWidth: box('.q-rail').width,
        }
      })

      expect(at.title, 'the list’s name starts 24px in').toBe(at.inner + 24)
      expect(at.filter, 'the filter field starts 24px in').toBe(at.inner + 24)
      expect(at.filterBarHeight, 'the filter bar is as high as ever: 12 + 40 + 12 and its 1px line').toBe(65)
      expect(at.item - at.bodyLeft, 'the first row is 24px in from the rows’ area').toBe(24)
      expect(at.bodyRight - at.itemRight, 'and 24px from its right edge').toBe(24)
      expect(at.rail, 'the rail still starts at the window’s inner edge').toBe(at.inner)
      expect(at.railWidth, 'and is as wide as ever').toBeGreaterThan(0)
      expect(at.bodyRight, 'the rows’ area ends at the window’s inner edge').toBe(at.innerRight)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}

test('the progress row, while a list loads, is 24px all round', async ({ page }) => {
  const { id } = await openList(page, 'exzed-1d', { slowFetch: true })
  try {
    await page.locator('.q-list-progress').waitFor({ timeout: 4000 })

    expect(await paddings(page, '.q-list-progress')).toEqual(['24px', '24px', '24px', '24px'])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the error strip, after a write fails, is 10px above and 24px at the sides', async ({ page }) => {
  const { id } = await openList(page, 'exzed-1d')
  try {
    await page.locator('.q-item').first().waitFor()
    await page.route('**/api/lists/**', async (route) => {
      if (route.request().method() !== 'GET') await route.fulfill({ status: 500, body: '{"error":"boom"}' })
      else await route.continue()
    })
    await page.locator('.q-item .q-check, .q-item [role=checkbox], .q-item input[type=checkbox]').first().click()
    await page.locator('.q-list-error').waitFor({ timeout: 4000 })

    expect(await paddings(page, '.q-list-error')).toEqual(['10px', '24px', '0px', '24px'])
  } finally {
    await page.unroute('**/api/lists/**')
    await page.request.delete(`/api/lists/${id}`)
  }
})
