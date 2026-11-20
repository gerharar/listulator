import { expect, test, type Page } from '@playwright/test'
import { q } from './fixtures.js'

const surpriseCopy = q.helper.surprise

/**
 * Surprise Me (task 10.29) in a real browser. The server reads the community
 * library from GitHub, so the two calls that depend on the network (the list of
 * untracked library lists, and the preview's expansion) are answered here; the
 * server side has its own tests. Nothing is written.
 */
const ENTRIES = [
  { externalRef: 'canonical:lists/book/lotr.yaml', title: 'The Lord of the Rings', category: 'book', itemCount: 3, description: 'Three volumes.', status: 'complete' },
  { externalRef: 'canonical:lists/mega/mcu.yaml', title: 'Marvel Cinematic Universe', category: 'mega', itemCount: 23 },
  { externalRef: 'canonical:lists/mma/ufc.yaml', title: 'All UFC Events', category: 'mma', itemCount: 757 },
]

async function stubLibrary(page: Page, reachable = true) {
  await page.route('**/api/library/untracked', (route) =>
    route.fulfill({ json: { entries: reachable ? ENTRIES : [], reachable } }),
  )
  await page.route('**/api/media-types/*/expansion**', (route) =>
    route.fulfill({ json: { itemCount: 2, items: [{ title: 'Item one', timeToConsumeMinutes: 30 }, { title: 'Item two', timeToConsumeMinutes: 30 }] } }),
  )
}

const surprise = (page: Page) => page.getByRole('button', { name: 'Surprise Me' })
const sheet = (page: Page) => page.locator('.q-sheet')

test('a shelf with nothing in it is a disabled chip: .45, aria-disabled, in the tab order with its tooltip, and neither a click, Enter nor Space picks it (design, 2026-11-20)', async ({ page, browserName }) => {
  await stubLibrary(page)
  await page.goto('/')
  await surprise(page).click()
  await expect(sheet(page)).toContainText(surpriseCopy.title)
  const empty = page.locator('.q-shelves .q-chip.none').first()
  await expect(empty).toHaveAttribute('aria-disabled', 'true')
  await expect(empty).not.toHaveAttribute('disabled', /.*/)
  expect(await empty.evaluate((node) => getComputedStyle(node).opacity)).toBe('0.45')

  // Playwright waits for an `aria-disabled` control to become enabled; a person can press this one, so the press is forced.
  await empty.click({ force: true })
  await expect(empty).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.q-shelves .q-chip', { hasText: 'Any' })).toHaveAttribute('aria-pressed', 'true')

  // The keyboard: focus lands on it (it is not skipped, as a `disabled` button would be), shows its tooltip at once, and Enter and Space do nothing.
  await empty.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await expect(empty).toHaveAttribute('aria-pressed', 'false')
  if (browserName === 'chromium') {
    // Tab onto it from the chip before it: keyboard focus, so the tooltip is at once.
    await page.mouse.move(0, 0)
    await empty.evaluate((node) => (node.previousElementSibling as HTMLElement).focus())
    await page.keyboard.press('Tab')
    await expect(empty).toBeFocused()
    await expect(page.getByRole('tooltip')).toHaveText(surpriseCopy.nothingHere)
  }
})

test('spins the dials, lands on a library list with its details, and This One opens its preview', async ({ page }) => {
  await stubLibrary(page)
  await page.goto('/')
  await surprise(page).click()
  await expect(sheet(page)).toContainText(surpriseCopy.title)
  await expect(surprise(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet(page).getByRole('button', { name: surpriseCopy.spin, exact: true })).toBeVisible()
  await expect(sheet(page)).toContainText(surpriseCopy.pool(3, 0))

  await sheet(page).getByRole('button', { name: surpriseCopy.spin, exact: true }).click()
  await expect(sheet(page).getByRole('button', { name: surpriseCopy.spinning })).toBeDisabled()
  await expect(sheet(page).locator('.q-digit.ticking').first()).toBeVisible()
  await expect(sheet(page).getByRole('button', { name: surpriseCopy.thisOne })).toBeVisible({ timeout: 6000 })

  const landed = (await sheet(page).locator('.q-reel-name').textContent()) ?? ''
  const entry = ENTRIES.find((candidate) => landed.includes(candidate.title))!
  expect(entry).toBeTruthy()
  await expect(sheet(page).locator('.q-reel-meta')).toContainText(surpriseCopy.meta('', entry.itemCount))
  await expect(sheet(page).locator('.q-digit').filter({ hasText: /^\d$/ })).toHaveCount(6)
  await expect(sheet(page).locator('.q-digit.on')).toHaveCount(3)
  await page.screenshot({ path: 'test-results/surprise.png' })

  await sheet(page).getByRole('button', { name: surpriseCopy.thisOne }).click()
  await expect(sheet(page)).toHaveCount(0)
  await expect(page.locator('.q-preview-title')).toContainText(entry.title)
})

test('Add list on the preview sends the request a search result sends: the entry’s canonical ref and its own category', async ({ page }) => {
  await stubLibrary(page)
  let sent: Record<string, unknown> | undefined
  // Only the creation is stubbed (nothing is written); the server's own canonical path has its tests.
  await page.route('**/api/lists/from-source', (route) => {
    sent = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({ status: 201, json: { id: 'stub-list', title: 'stub', mediaType: 'book', status: null, stats: {} } })
  })
  await page.route('**/api/lists/stub-list', (route) => route.fulfill({ status: 404, json: { error: 'stub' } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Surprise Me' }).click()
  await sheet(page).getByRole('button', { name: 'Books', exact: true }).click()
  await sheet(page).getByRole('button', { name: surpriseCopy.spin, exact: true }).click()
  await expect(sheet(page).getByRole('button', { name: surpriseCopy.thisOne })).toBeVisible({ timeout: 6000 })
  await sheet(page).getByRole('button', { name: surpriseCopy.thisOne }).click()
  await expect(page.locator('.q-preview-title')).toContainText('The Lord of the Rings')

  await page.getByRole('button', { name: 'Add This List', exact: true }).click()

  await expect.poll(() => sent).toEqual({
    mediaType: 'book',
    externalRef: 'canonical:lists/book/lotr.yaml',
    title: 'The Lord of the Rings',
  })
})

test('a shelf narrows the draw, and only that shelf ever lands', async ({ page }) => {
  await stubLibrary(page)
  await page.goto('/')
  await surprise(page).click()
  await sheet(page).getByRole('button', { name: 'MMA', exact: true }).click()
  await expect(sheet(page)).toContainText('1 candidate in this category')

  await sheet(page).getByRole('button', { name: surpriseCopy.spin, exact: true }).click()

  await expect(sheet(page).locator('.q-reel-name')).toContainText('All UFC Events', { timeout: 6000 })
  await expect(sheet(page).locator('.q-reel-meta')).toContainText('757 items')
})

test('reduced motion skips the show and lands at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await stubLibrary(page)
  await page.goto('/')
  await surprise(page).click()

  await sheet(page).getByRole('button', { name: surpriseCopy.spin, exact: true }).click()

  // No spin to wait out: the result is there within a moment, and the dials never tick.
  await expect(sheet(page).getByRole('button', { name: surpriseCopy.thisOne })).toBeVisible({ timeout: 1000 })
  await expect(sheet(page).locator('.q-digit.ticking')).toHaveCount(0)
})

test('says when the community library could not be reached', async ({ page }) => {
  await stubLibrary(page, false)
  await page.goto('/')
  await surprise(page).click()

  await expect(sheet(page)).toContainText(surpriseCopy.unreachable)
  await expect(sheet(page).getByRole('button', { name: q.helper.retry })).toBeVisible()
})
