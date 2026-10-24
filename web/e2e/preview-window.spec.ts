import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 26.2 (BACKLOG BL-098): a long Preview draws only the rows near the view, in both engines. The source's answer is stubbed at the
 * browser boundary (a generated list, no network), so what is checked is the page's own: how many rows are drawn, how tall the scroller is
 * (the model's total: every row is 40px, a group head as well), that the end of the list can be reached, and that folding a group keeps
 * the reader where they are.
 */
const ROW = 40

function previewItems(count: number, per: number) {
  return Array.from({ length: count }, (_, n) => ({
    title: `Episode ${n}`,
    externalRef: `win:${n}`,
    year: 1960 + (n % 60),
    timeToConsumeMinutes: 20 + (n % 90),
    ...(per > 0 ? { group: `Volume ${Math.floor(n / per)}` } : {}),
  }))
}

async function openPreview(page: Page, count: number, per: number) {
  const items = previewItems(count, per)
  await page.route('**/api/media-types/music/search**', (route) =>
    route.fulfill({ json: { sources: [{ externalRef: 'win-1', title: 'Window source', detail: 'Group · XX', itemCount: count }] } }),
  )
  await page.route('**/api/media-types/music/expansion**', (route) =>
    route.fulfill({ json: route.request().url().includes('items=true') ? { itemCount: count, status: 'complete', items } : { itemCount: count } }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: 'Music' }).click()
  await expect(page.getByRole('tab', { name: 'Search', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Search MusicBrainz or List Vault', { exact: true }).fill('window')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('.q-result').first().waitFor()
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
  })
  await page.locator('.q-result').first().click()
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
  await page.locator('.q-preview-row').first().waitFor()
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
  })
}

const body = (page: Page) => page.locator('.q-preview-body')
const drawn = (page: Page) => page.locator('.q-preview-row').count()
const scrollTo = async (page: Page, top: number) => {
  await body(page).evaluate((element, y) => {
    element.scrollTop = y
  }, top)
  // The window follows on the next frame.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

test.describe('a long Preview draws a window', () => {
  test('10,000 rows: a few dozen drawn, and the scroller is as tall as 10,000 rows of 40px', async ({ page }) => {
    await openPreview(page, 10_000, 0)

    expect(await drawn(page)).toBeLessThan(100)
    expect(await body(page).evaluate((element) => element.scrollHeight)).toBe(10_000 * ROW)
  })

  test('the end can be reached: the last row is in view above the footer, and the first are gone', async ({ page }) => {
    await openPreview(page, 10_000, 0)

    await scrollTo(page, 10_000 * ROW)

    const last = page.locator('.q-preview-row', { hasText: 'Episode 9999' })
    await expect(last).toBeVisible()
    const [row, footer] = await Promise.all([last.boundingBox(), page.locator('.q-preview-footer').boundingBox()])
    expect(row!.y + row!.height).toBeLessThanOrEqual(footer!.y + 1)
    await expect(page.locator('.q-preview-row', { hasText: /^Episode 0\b/ })).toHaveCount(0)
    expect(await drawn(page)).toBeLessThan(100)
  })

  test('in groups of 100: the heads and rows are flat in the body, and the height is the heads plus the rows', async ({ page }) => {
    await openPreview(page, 10_000, 100)

    expect(await body(page).evaluate((element) => element.scrollHeight)).toBe((10_000 + 100) * ROW)
    const nested = await body(page).evaluate((element) => [...element.querySelectorAll('.q-preview-group, .q-preview-row')].some((node) => node.parentElement !== element))
    expect(nested).toBe(false)
    expect(await drawn(page)).toBeLessThan(100)
  })

  test('End from a group head goes to the very bottom and Home back to the very top', async ({ page }) => {
    await openPreview(page, 10_000, 100)
    await page.getByRole('button', { name: 'Collapse Volume 0' }).focus()

    await page.keyboard.press('End')
    const last = page.locator('.q-preview-row', { hasText: 'Episode 9999' })
    await expect(last).toBeVisible()
    const [row, footer] = await Promise.all([last.boundingBox(), page.locator('.q-preview-footer').boundingBox()])
    expect(row!.y + row!.height).toBeLessThanOrEqual(footer!.y + 1)
    expect(await body(page).evaluate((element) => element.scrollTop + element.clientHeight)).toBeCloseTo(10_100 * ROW, 0)
    await expect(page.locator('.q-live')).toHaveText('Bottom of the list')
    expect(await drawn(page)).toBeLessThan(100)

    await page.keyboard.press('Home')
    await expect(page.locator('.q-preview-row', { hasText: /^Episode 0\b/ })).toBeVisible()
    expect(await body(page).evaluate((element) => element.scrollTop)).toBe(0)
    await expect(page.locator('.q-live')).toHaveText('Top of the list')
  })

  test('folding a group in the middle keeps it where it is on the screen, and unfolding puts its rows back there', async ({ page }) => {
    await openPreview(page, 10_000, 100)
    const start = 50 * 101 * ROW
    await scrollTo(page, start - 120)
    const head = page.getByRole('button', { name: 'Collapse Volume 50' })
    await expect(head).toBeVisible()
    const before = (await head.boundingBox())!.y

    await head.click()
    const folded = page.getByRole('button', { name: 'Expand Volume 50' })
    await expect(folded).toBeVisible()
    expect(Math.abs((await folded.boundingBox())!.y - before)).toBeLessThanOrEqual(1)
    expect(await body(page).evaluate((element) => element.scrollHeight)).toBe((10_100 - 100) * ROW)

    await folded.click()
    const open = page.getByRole('button', { name: 'Collapse Volume 50' })
    await expect(open).toBeVisible()
    expect(Math.abs((await open.boundingBox())!.y - before)).toBeLessThanOrEqual(1)
    await expect(page.locator('.q-preview-row', { hasText: /^Episode 5000\b/ })).toBeVisible()
  })

  test('with the switch off every row is drawn, with no spacer', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('listVirtualization', 'off'))
    await openPreview(page, 600, 0)

    expect(await drawn(page)).toBe(600)
    await expect(page.locator('.q-list-spacer')).toHaveCount(0)
    await expect(page.locator('.q-place')).toHaveCount(0)
  })

  test('under 200 rows every row is drawn, with no spacer', async ({ page }) => {
    await openPreview(page, 150, 25)

    expect(await drawn(page)).toBe(150)
    await expect(page.locator('.q-list-spacer')).toHaveCount(0)
  })

  test('each drawn row and head has its place in the accessibility tree, the layer says how it is drawn, and the hidden text takes no room', async ({ page }) => {
    await openPreview(page, 10_000, 100)

    await expect(page.locator('.q-preview-body > .q-place')).toHaveText('10000 items. Only the rows near the screen are drawn. Scroll to reach the others.')
    const head = page.getByRole('button', { name: 'Collapse Volume 0' })
    await expect(head.locator('.q-place')).toHaveText('Group 1 of 100')
    // A description, not a new name: the button is still called what it was.
    expect(await head.getAttribute('aria-label')).toBe('Collapse Volume 0')
    expect(await head.ariaSnapshot()).toContain('Group 1 of 100')
    const row = page.locator('.q-preview-row').first()
    await expect(row.locator('.q-place')).toHaveText('1 of 10000')
    expect(await row.ariaSnapshot()).toContain('1 of 10000')
    expect(await row.getAttribute('role')).toBeNull()
    expect(await row.evaluate((node) => parseFloat(getComputedStyle(node).height))).toBe(ROW)
    expect(await head.evaluate((node) => parseFloat(getComputedStyle(node).height))).toBe(ROW)
  })

  test('a short Preview says no place', async ({ page }) => {
    await openPreview(page, 150, 25)

    await expect(page.locator('.q-place')).toHaveCount(0)
  })
})
