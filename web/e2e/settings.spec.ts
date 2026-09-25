import { expect, test, type Page } from '@playwright/test'
import { useHomeFixture } from './fixtures.js'

/**
 * The Settings layer (task 10.30) in a real browser: every preference has to
 * survive a reload, and the two motion switches have to change what the
 * stylesheets actually do (jsdom has no CSS, so only a browser can say).
 */
async function openHome(page: Page) {
  await useHomeFixture(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible({ timeout: 15_000 })
}

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
}

const closeSettings = (page: Page) => page.getByRole('button', { name: 'Close', exact: true }).click()

/** Pushes a layer and reports the entrance animation it plays. */
async function enteringAnimation(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'New List' }).click()
  const entering = page.locator('.q-layer.enter')
  await expect(entering).toHaveCount(1)
  return entering.evaluate((el) => getComputedStyle(el).animationName)
}

test('the gear opens Settings over Home, and Close returns to Home', async ({ page }) => {
  await openHome(page)

  await openSettings(page)
  await expect(page.getByRole('button', { name: 'Quantum' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.q-layer-tab')).toContainText('My Lists')

  await closeSettings(page)
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible()
})

test('a skin picked in Settings re-themes the app, is announced, and survives a reload', async ({ page }) => {
  await openHome(page)
  await openSettings(page)

  await page.getByRole('button', { name: 'Light bone' }).click()

  await expect(page.locator('.q-root')).toHaveAttribute('data-theme', 'light-bone')
  await expect(page.locator('.q-live')).toHaveText('Switched to the Light bone skin.')
  await expect(page.getByRole('button', { name: 'Light bone' })).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  await expect(page.locator('.q-root')).toHaveAttribute('data-theme', 'light-bone')
})

test('Fast push swaps the entrance animation, and the choice survives a reload', async ({ page }) => {
  await openHome(page)
  await openSettings(page)
  await page.getByRole('button', { name: 'Fast push — 210ms' }).click()
  await expect(page.locator('.q-root')).toHaveAttribute('data-motion', 'push')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.q-root')).toHaveAttribute('data-motion', 'push')
  expect(await enteringAnimation(page)).toContain('q-pushIn')
})

test('Reduce motion cuts the entrance and the re-seat with the system asking for nothing, and survives a reload', async ({ page }) => {
  await openHome(page)
  await openSettings(page)
  await page.getByRole('checkbox', { name: /Reduce motion/ }).check()
  await expect(page.locator('.q-root')).toHaveAttribute('data-reduced', '')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible({ timeout: 15_000 })
  expect(await enteringAnimation(page)).toBe('none')
  const covered = page.locator('.q-layer.covered')
  expect(await covered.evaluate((el) => getComputedStyle(el).transitionProperty)).toBe('none')
})

test('with the system asking for less, the box starts ticked, and unticking it brings the motion back', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openHome(page)
  await openSettings(page)
  const box = page.getByRole('checkbox', { name: /Reduce motion/ })
  await expect(box).toBeChecked()

  await box.uncheck()
  await expect(page.locator('.q-root')).not.toHaveAttribute('data-reduced', '')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible({ timeout: 15_000 })
  expect(await enteringAnimation(page)).toContain('q-drumIn')
})

test('switching to Русский rewrites Settings at once and is still Russian after a reload', async ({ page }) => {
  await openHome(page)
  await openSettings(page)

  await page.getByRole('button', { name: 'Русский' }).click()
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0)
  // The rest of the shell follows too, without Settings having to close first.
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible({ timeout: 15_000 })
})
