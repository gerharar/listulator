import { chromium, expect, test, type Page } from '@playwright/test'

/**
 * The jump rail on the Preview layer (H-019, task 32.5a), measured in a real browser as on the list: inside the card in a window with no
 * room beside it, outside with it (laid over the card's edge, its top border carrying the header's bottom rule, its bottom at the card's
 * bottom beside the footer), folded in place to a strip, and exact at a screen scale like Windows 125%. The source's answer is stubbed at
 * the browser boundary, as in preview-window.spec.ts.
 */
function previewItems(count: number, per: number) {
  return Array.from({ length: count }, (_, n) => ({
    title: `Episode ${n}`,
    externalRef: `rail:${n}`,
    timeToConsumeMinutes: 30,
    group: `Volume ${Math.floor(n / per)}`,
  }))
}

async function settled(page: Page) {
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

async function openPreview(page: Page, count = 12, per = 4) {
  const items = previewItems(count, per)
  await page.route('**/api/media-types/music/search**', (route) =>
    route.fulfill({ json: { sources: [{ externalRef: 'rail-1', title: 'Rail source', detail: 'Group · XX', itemCount: count }] } }),
  )
  await page.route('**/api/media-types/music/expansion**', (route) =>
    route.fulfill({ json: route.request().url().includes('items=true') ? { itemCount: count, status: 'complete', items } : { itemCount: count } }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: 'Music' }).click()
  await expect(page.getByRole('tab', { name: 'Search', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Search MusicBrainz or List Vault', { exact: true }).fill('rail')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('.q-result').first().waitFor()
  await settled(page)
  await page.locator('.q-result').first().click()
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
  await page.locator('.q-preview-row').first().waitFor()
  await settled(page)
}

/** Every box is read in one evaluation, so they all belong to the same frame. */
const boxes = (page: Page) =>
  page.evaluate(() => {
    const read = (node: Element) => {
      const r = node.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width }
    }
    const find = (selector: string) => document.querySelector(selector)!

    return {
      rail: read(find('.q-rail')),
      head: read(find('.q-preview-head')),
      body: read(find('.q-preview-body')),
      cols: read(find('.q-preview-cols')),
      card: read(find('.q-preview')!.closest('.q-layer')!),
    }
  })

test('in a window with no room the rail is inside the card, beside the rows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openPreview(page)

  await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'inside')
  const { rail, cols, card } = await boxes(page)
  expect(rail.left).toBeGreaterThan(card.left)
  expect(rail.top).toBeCloseTo(cols.top, 1)
})

for (const width of [1728, 1729]) {
  test(`at ${width}px the rail leaves the card, carries the header's rule and ends at the card's bottom`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openPreview(page)

    await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'outside')
    await expect(page.locator('.q-rail-entry')).toHaveCount(3)
    const { rail, head, body, cols, card } = await boxes(page)

    // Its right edge is the card's outer edge, so the card's own border is the line beside it.
    expect(rail.right).toBeCloseTo(card.left, 1)
    // Its 2px top border lies exactly over the header's 2px bottom border.
    expect(rail.top).toBeCloseTo(head.bottom - 2, 1)
    expect(rail.bottom).toBeCloseTo(card.bottom, 1)
    // The rows take all the room the card has.
    expect(body.width).toBeCloseTo(cols.width, 1)
    expect(Number.isInteger(card.left)).toBe(true)
    expect(card.width).toBe(width % 2 === 0 ? 1080 : 1079)
  })
}

test('the rail folds to a strip outside, a press brings it back, and a press on a group jumps to it', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 500 })
  await openPreview(page, 60, 10)
  const width = () => page.locator('.q-rail').evaluate((node) => node.getBoundingClientRect().width)

  await page.getByRole('button', { name: 'Collapse group jumper' }).click()
  await settled(page)
  expect(await width()).toBeCloseTo(38, 0)
  await page.locator('.q-rail .label').click()
  await settled(page)
  expect(await width()).toBeCloseTo(200, 0)

  await page.locator('.q-rail-entry', { hasText: 'Volume 4' }).click()
  await expect.poll(() => page.locator('.q-preview-body').evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await expect(page.locator('.q-preview-group', { hasText: 'Volume 4' })).toBeVisible()
  await expect(page.locator('.q-preview')).toBeVisible()
})

for (const ratio of [1.25, 1.5625]) {
  test(`at a screen scale of ${ratio} the rail ends on the card's bottom line and meets its border`, async ({ browserName, baseURL }) => {
    test.skip(browserName !== 'chromium', 'the flag is Chromium’s')
    const browser = await chromium.launch({ args: [`--force-device-scale-factor=${ratio}`] })
    const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: Math.round(3440 / ratio), height: 1000 }, deviceScaleFactor: ratio })
    const page = await context.newPage()

    try {
      await openPreview(page)
      const { rail, head, card } = await boxes(page)

      expect(rail.bottom).toBeCloseTo(card.bottom, 1)
      expect(rail.right).toBeCloseTo(card.left, 1)
      expect(rail.top).toBeCloseTo(head.bottom - (await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.q-preview-head')!).borderBottomWidth))), 1)
    } finally {
      await browser.close()
    }
  })
}
