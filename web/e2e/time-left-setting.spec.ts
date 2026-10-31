import { expect, test, type Page } from '@playwright/test'
import { q, useHomeFixture } from './fixtures.js'

/**
 * The setting "Show time left in My Lists" (canvas H-024, owner 2026-10-31, task 44.3), in a real browser: Settings → Screen has the box after
 * "Enhance group arrows", unticked, with the canvas's words on hover; the choice survives a restart (a reload here; the desktop keeps it in
 * `preferences.json`). What the box does to My Lists is task 44.4's, and `progress-bar.spec.ts` (44.5) looks at it.
 */
async function openSettings(page: Page) {
  await useHomeFixture(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: q.home.title })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: q.settings.title, exact: true }).click()
  await expect(page.getByRole('heading', { name: q.settings.title })).toBeVisible()
}

const box = (page: Page) => page.getByRole('checkbox', { name: q.settings.showTimeLeft })

test('the box is the last of Screen, after Enhance group arrows, and unticked by default', async ({ page }) => {
  await openSettings(page)

  await expect(box(page)).toBeVisible()
  await expect(box(page)).not.toBeChecked()
  const labels = await page.locator('label.q-settings-check').allTextContents()
  expect(labels.at(-1)).toBe(q.settings.showTimeLeft)
  expect(labels.at(-2)).toBe(q.settings.markOpenGroups)
})

test('its row says why on hover, in the canvas’s words', async ({ page }) => {
  await openSettings(page)
  await page.waitForFunction(() => document.getAnimations().length === 0)

  await page.locator('label.q-settings-check', { hasText: q.settings.showTimeLeft }).hover()

  await expect(page.getByRole('tooltip')).toHaveText(q.settings.showTimeLeftTip)
})

test('ticking it survives a restart, and so does unticking it', async ({ page }) => {
  await openSettings(page)
  await box(page).check()

  await page.reload()
  await page.getByRole('button', { name: q.settings.title, exact: true }).click()
  await expect(box(page)).toBeChecked()

  await box(page).uncheck()
  await page.reload()
  await page.getByRole('button', { name: q.settings.title, exact: true }).click()
  await expect(box(page)).not.toBeChecked()
})
