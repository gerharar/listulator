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
  const items = Array.from({ length: rows }, (_, n) => `  - { title: "Item ${String(n + 1).padStart(3, '0')}", minutes: 30, group: "${rows > 50 ? 'Long' : n < 2 ? 'Season 1' : 'Season 2'}" }`)
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

/**
 * Widths (48.4, as design settled them in answers 3 and 7). Every eX-Zed layer, a list and a Preview too, is elastic: 1080px at the least and 1620px
 * at the most, the window minus 2 x 96 between (1440 -> 1248, 1920 and wider -> 1620), and as the window narrows the side gap shrinks from 96px to a
 * 24px floor first, so a layer stays 1080px down to a 1128px window and is the window minus 48 below that, as in Quantum. Quantum's list is 1080 like
 * the rest. The rail's rule reads the same card and gap, so it goes outside at 2244 (1620 + 2 x 96 + 2 x 216) and back inside below 2212; until
 * 48.5 caps the app at 2560 it also goes outside at 3440 and 3840.
 */
const layerWidth = (page: Page) => page.locator('.q-layer:not(.covered)').evaluate((el) => el.getBoundingClientRect().width)
const layerLeft = (page: Page) => page.locator('.q-layer:not(.covered)').evaluate((el) => el.getBoundingClientRect().left)

/** Window, then the width of a plain layer and of a list, and the gap each leaves at its left. */
const WIDTHS: readonly { window: number; home: number; list: number; gap: number }[] = [
  { window: 1440, home: 1248, list: 1248, gap: 96 },
  { window: 1920, home: 1620, list: 1620, gap: 150 },
  { window: 2560, home: 1620, list: 1620, gap: 470 },
  { window: 1272, home: 1080, list: 1080, gap: 96 },
  { window: 1200, home: 1080, list: 1080, gap: 60 },
  { window: 1128, home: 1080, list: 1080, gap: 24 },
  { window: 1127, home: 1079, list: 1079, gap: 24 },
  { window: 1000, home: 952, list: 952, gap: 24 },
  { window: 800, home: 752, list: 752, gap: 24 },
]

for (const { window: width, home, list, gap } of WIDTHS) {
  test(`with the theme exzed, at ${width}px a plain layer is ${home}px and a list ${list}px, ${gap}px from the left`, async ({ page }) => {
    const title = `e2e widths ${width} ${Date.now()}`
    const id = await makeList(page.request, title)

    try {
      await page.setViewportSize({ width, height: 900 })
      await boot(page, 'exzed')
      await page.goto('/')
      await page.locator('.q-home-row').first().waitFor()
      expect(await layerWidth(page)).toBe(home)
      expect(await layerLeft(page)).toBe(gap)

      await openList(page, title)
      expect(await layerWidth(page)).toBe(list)
      expect(await layerLeft(page)).toBe(gap)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}

test('with the theme quantum, the gap is 20px or more at any width and a list is 1080px at 1920 and 2560, as a plain layer is', async ({ page }) => {
  const title = `e2e widths quantum ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    for (const width of [1920, 2560]) {
      await page.setViewportSize({ width, height: 900 })
      await boot(page, 'quantum')
      await openList(page, title)
      expect(await layerWidth(page)).toBe(width % 2 === 0 ? 1080 : 1079)
    }
    for (const width of [800, 1000, 1128, 1272]) {
      await page.setViewportSize({ width, height: 900 })
      await openList(page, title)
      // Never less than 20px; a layer at its 1080 cap is centred, so wider windows give it more.
      const expected = Math.min(1080, width - 40)
      expect(await layerWidth(page), `the width at ${width}px`).toBe(expected)
      expect(await layerLeft(page), `the gap at ${width}px`).toBe((width - expected) / 2)
    }
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('with the theme exzed, the jump rail goes outside at 2244px, holds down to 2212 and not below, and a list opened at 2000px is laid out for eX-Zed from its first render', async ({ page }) => {
  const title = `e2e widths rail ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await boot(page, 'exzed')
    // 2000 is outside by Quantum's numbers (a 460px margin) and inside by eX-Zed's (94px): the first render must have had eX-Zed's.
    await page.setViewportSize({ width: 2000, height: 900 })
    await openList(page, title)
    await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'inside')

    await page.setViewportSize({ width: 2243, height: 900 })
    await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'inside')
    await page.setViewportSize({ width: 2244, height: 900 })
    await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'outside')

    // The 16px of hysteresis: once outside it holds down to 2212 and goes back in below that.
    await page.setViewportSize({ width: 2212, height: 900 })
    await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'outside')
    await page.setViewportSize({ width: 2211, height: 900 })
    await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'inside')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

/**
 * The covered layer's tab (48.4): 34px in Quantum and 48px in eX-Zed, and in both the layer in front leaves it whole: its bottom is no lower than
 * the front layer's top, one step back and two. (Scale and inset of the cascade are not this task's.)
 */
for (const theme of ['exzed', 'quantum'] as const) {
  test(`with the theme ${theme}, a covered layer's tab is ${theme === 'exzed' ? 48 : 34}px and nothing in front of it clips it, one layer back and two`, async ({ page }) => {
    const title = `e2e tab ${theme} ${Date.now()}`
    const id = await makeList(page.request, title)

    try {
      await boot(page, theme)
      await openList(page, title)
      // Home is one back; the Preview of a New List's search would be two, so open Settings over the list: list -> Settings, Home two back.
      await page.getByRole('button', { name: 'Settings' }).click()
      await page.locator('.q-layer:not(.covered)').first().waitFor()
      const rects = await page.evaluate(() => {
        const layers = Array.from(document.querySelectorAll('.q-layer'))
        return layers.map((layer) => {
          const tab = layer.querySelector('.q-layer-tab')
          return { top: layer.getBoundingClientRect().top, tab: tab ? { height: parseFloat(getComputedStyle(tab).height), bottom: tab.getBoundingClientRect().bottom } : null }
        })
      })
      // Bottom-most (front) layer is last in the DOM; the covered layers are before it, deepest first.
      expect(rects.length).toBe(3)
      const [deepest, middle, front] = rects as [(typeof rects)[number], (typeof rects)[number], (typeof rects)[number]]
      const height = theme === 'exzed' ? 48 : 34
      expect(deepest.tab!.height).toBe(height)
      expect(middle.tab!.height).toBe(height)
      expect(middle.tab!.bottom, 'the front layer does not cover the middle tab').toBeLessThanOrEqual(front.top + 1)
      expect(deepest.tab!.bottom, 'the middle layer does not cover the deepest tab').toBeLessThanOrEqual(middle.top + 1)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}
