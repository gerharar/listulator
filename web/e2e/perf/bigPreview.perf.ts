import { expect, test } from '@playwright/test'

/**
 * By hand, for the owner (Phase 26.5): opens a big Preview in a visible browser and leaves it open to be tried. A real big source is not
 * reachable otherwise (the community library is read from GitHub; a connector's answer is never 10,000 rows), so the source's answer is a
 * generated one, stubbed at the browser boundary, in the production build. Skipped unless `BIG_PREVIEW` is set to `count` or `count:groupSize`.
 *   cd web && BIG_PREVIEW=10000:100 npx playwright test -c playwright.perf.config.ts bigPreview --headed --project=webkit --timeout=0
 * WebKit is the Mac app's engine. Close the browser window to end it. "Add This List" is answered with an error (nothing is created).
 */
const spec = process.env['BIG_PREVIEW']

test('a big Preview, left open', async ({ page }) => {
  test.skip(!spec, 'by hand: set BIG_PREVIEW=10000:100')
  const [count = 10_000, per = 0] = spec!.split(':').map(Number)
  const items = Array.from({ length: count }, (_, n) => ({
    title: `Episode ${n}: a title of ordinary length`,
    externalRef: `big:${n}`,
    year: 1960 + (n % 60),
    timeToConsumeMinutes: 20 + (n % 90),
    ...(per > 0 ? { group: `Volume ${Math.floor(n / per)}` } : {}),
  }))
  await page.route('**/api/media-types/music/search**', (route) =>
    route.fulfill({ json: { sources: [{ externalRef: 'big-1', title: `A source of ${count} items`, detail: 'Group · XX', itemCount: count }] } }),
  )
  await page.route('**/api/media-types/music/expansion**', (route) =>
    route.fulfill({ json: route.request().url().includes('items=true') ? { itemCount: count, status: 'complete', items } : { itemCount: count } }),
  )
  await page.route('**/api/lists/from-source', (route) => route.fulfill({ status: 500, json: { message: 'by hand: nothing is created' } }))

  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: 'Music' }).click()
  await expect(page.getByRole('tab', { name: 'Search', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Search MusicBrainz or List Vault', { exact: true }).fill('big')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('.q-result').first().click()
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
  await expect(page.locator('.q-preview-row').first()).toBeVisible({ timeout: 120_000 })

  await page.waitForEvent('close', { timeout: 0 })
})
