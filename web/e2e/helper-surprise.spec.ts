import { expect, test, type Page } from '@playwright/test'

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

test('spins the dials, lands on a library list with its details, and This One opens its preview', async ({ page }) => {
  await stubLibrary(page)
  await page.goto('/')
  await surprise(page).click()
  await expect(sheet(page)).toContainText('Surprise, Motherfucker!')
  await expect(surprise(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet(page).getByRole('button', { name: 'Spin', exact: true })).toBeVisible()
  await expect(sheet(page)).toContainText('3 candidates across every shelf')

  await sheet(page).getByRole('button', { name: 'Spin', exact: true }).click()
  await expect(sheet(page).getByRole('button', { name: 'Spinning…' })).toBeDisabled()
  await expect(sheet(page).locator('.q-digit.ticking').first()).toBeVisible()
  await expect(sheet(page).getByRole('button', { name: 'This One' })).toBeVisible({ timeout: 6000 })

  const landed = (await sheet(page).locator('.q-reel-name').textContent()) ?? ''
  const entry = ENTRIES.find((candidate) => landed.includes(candidate.title))!
  expect(entry).toBeTruthy()
  await expect(sheet(page).locator('.q-reel-meta')).toContainText(`${entry.itemCount} items · curated list`)
  await expect(sheet(page).locator('.q-digit').filter({ hasText: /^\d$/ })).toHaveCount(6)
  await expect(sheet(page).locator('.q-digit.on')).toHaveCount(3)
  await page.screenshot({ path: 'test-results/surprise.png' })

  await sheet(page).getByRole('button', { name: 'This One' }).click()
  await expect(sheet(page)).toHaveCount(0)
  await expect(page.locator('.q-preview-title')).toContainText(entry.title)
})

test('a shelf narrows the draw, and only that shelf ever lands', async ({ page }) => {
  await stubLibrary(page)
  await page.goto('/')
  await surprise(page).click()
  await sheet(page).getByRole('button', { name: 'MMA', exact: true }).click()
  await expect(sheet(page)).toContainText('1 candidate on this shelf')

  await sheet(page).getByRole('button', { name: 'Spin', exact: true }).click()

  await expect(sheet(page).locator('.q-reel-name')).toContainText('All UFC Events', { timeout: 6000 })
  await expect(sheet(page).locator('.q-reel-meta')).toContainText('757 items')
})

test('reduced motion skips the show and lands at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await stubLibrary(page)
  await page.goto('/')
  await surprise(page).click()

  await sheet(page).getByRole('button', { name: 'Spin', exact: true }).click()

  // No spin to wait out: the result is there within a moment, and the dials never tick.
  await expect(sheet(page).getByRole('button', { name: 'This One' })).toBeVisible({ timeout: 1000 })
  await expect(sheet(page).locator('.q-digit.ticking')).toHaveCount(0)
})

test('says when the community library could not be reached', async ({ page }) => {
  await stubLibrary(page, false)
  await page.goto('/')
  await surprise(page).click()

  await expect(sheet(page)).toContainText('Could not reach the community library.')
  await expect(sheet(page).getByRole('button', { name: 'Try again' })).toBeVisible()
})
