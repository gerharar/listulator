import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The jump rail outside the card (H-019, task 32.1), measured in a real browser: with the room beside the card the rail leaves it and
 * is laid over the card's edge, starting level with the inside rail (its 2px top border over the toolbar's line), ending at the card's
 * bottom, and the card and the list body are as wide as without it; in a window without the room it stays inside; the switch happens on
 * resize. Real writes on the dev server, removed in a `finally`.
 */
async function makeGroupedList(request: APIRequestContext, title: string) {
  const rows = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map(
    (name, n) => `  - { title: "Item ${name}", minutes: 30, group: "${n < 3 ? 'Season 1' : 'Season 2'}" }`,
  )
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
  await settled(page)
}

/** The layer drums in over 380ms and moves over 300ms: measure after that, never during it. */
const settled = (page: Page) => page.waitForFunction(() => document.getAnimations().length === 0)

interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
}

/** Every box is read in one evaluation, so they all belong to the same frame. */
const boxes = (page: Page) =>
  page.evaluate(() => {
    const read = (node: Element) => {
      const r = node.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width }
    }
    const find = (selector: string) => document.querySelector(selector)!
    // The card is the list's own layer: Home's is under it in the stack.
    return { rail: read(find('.q-rail')), cols: read(find('.q-list-cols')), body: read(find('.q-list-body')), card: read(find('.q-list').closest('.q-layer')!) } satisfies Record<string, Box>
  })

for (const width of [1728, 1729, 1920, 1921]) {
  test(`at ${width}px the rail leaves the card and lies over its edge`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const title = `e2e rail outside ${width} ${Date.now()}`
    const id = await makeGroupedList(page.request, title)

    try {
      await openList(page, title)
      await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'outside')

      const { rail, cols, body, card } = await boxes(page)

      // The rail's right edge is the card's inner left edge; it starts 1px above the list (its border over the toolbar's line), ends at the card's bottom.
      expect(rail.right).toBeCloseTo(cols.left, 1)
      expect(rail.top).toBeCloseTo(cols.top - 1, 1)
      expect(rail.bottom).toBeCloseTo(card.bottom, 1)
      // Whole pixels: the card is centred on a whole pixel, so no 1px step and no seam.
      expect(Number.isInteger(card.left)).toBe(true)
      expect(Number.isInteger(card.right)).toBe(true)
      // The card keeps its width (1080, or 1079 at an odd window) and the list body takes all of its room: the rail takes none.
      expect(card.width).toBe(width % 2 === 0 ? 1080 : 1079)
      expect(body.width).toBeCloseTo(cols.width, 1)
      expect(body.left).toBeCloseTo(cols.left, 1)
      // It stays in the window with air to spare (the cap: margin - 16px).
      expect(rail.left).toBeGreaterThanOrEqual(36)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}

test('the outside rail starts at the height the inside rail does', async ({ page }) => {
  const title = `e2e rail heights ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openList(page, title)
    await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'inside')
    await settled(page)
    const { rail: inside, cols: insideCols } = await boxes(page)
    expect(inside.top).toBeCloseTo(insideCols.top, 1)

    await page.setViewportSize({ width: 1728, height: 900 })
    await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'outside')
    await settled(page)
    const { rail: outside, cols: outsideCols } = await boxes(page)
    // Its 2px border covers the 1px line above the list body and 1px of the body's first line.
    expect(outsideCols.top - outside.top).toBeCloseTo(1, 1)
    expect(outside.bottom).toBeGreaterThan(outsideCols.bottom)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the switch follows the window, with 16px of hysteresis', async ({ page }) => {
  const title = `e2e rail switch ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await page.setViewportSize({ width: 1512, height: 900 })
    await openList(page, title)
    const placement = () => page.locator('.q-rail').getAttribute('data-placement')

    expect(await placement()).toBe('inside')
    await page.setViewportSize({ width: 1552, height: 900 })
    await expect.poll(placement).toBe('outside')
    await page.setViewportSize({ width: 1530, height: 900 })
    await page.waitForTimeout(150)
    expect(await placement()).toBe('outside')
    await page.setViewportSize({ width: 1519, height: 900 })
    await expect.poll(placement).toBe('inside')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a press on the outside rail jumps to the group and does not close the layer', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 900 })
  const title = `e2e rail press ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await openList(page, title)
    await page.locator('.q-rail-entry', { hasText: 'Season 2' }).click()
    await expect(page.locator('.q-list')).toBeVisible()
    await expect(page.locator('.q-rail')).toBeVisible()
    await page.locator('.q-rail').click({ position: { x: 20, y: 300 } })
    await expect(page.locator('.q-list')).toBeVisible()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('with another layer on top, the covered list shows no outside rail', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 900 })
  const title = `e2e rail covered ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await openList(page, title)
    await expect(page.locator('.q-rail')).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.locator('.q-rail')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
