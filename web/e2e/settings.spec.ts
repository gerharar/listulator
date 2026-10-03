import { expect, test, type Page } from '@playwright/test'
import { q, useHomeFixture } from './fixtures.js'

const jouhou = q.skin.labels['light-bone']

/**
 * The Settings layer (task 10.30) in a real browser: every preference has to
 * survive a reload, and the two motion switches have to change what the
 * stylesheets actually do (jsdom has no CSS, so only a browser can say).
 */
async function openHome(page: Page) {
  await useHomeFixture(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: q.home.title })).toBeVisible({ timeout: 15_000 })
}

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: q.settings.title, exact: true }).click()
  await expect(page.getByRole('heading', { name: q.settings.title })).toBeVisible()
}

const closeSettings = (page: Page) => page.getByRole('button', { name: q.settings.closeLabel, exact: true }).click()

/** Pushes a layer and reports the entrance animation it plays. */
async function enteringAnimation(page: Page): Promise<string> {
  await page.getByRole('button', { name: q.home.newList }).click()
  const entering = page.locator('.q-layer.enter')
  await expect(entering).toHaveCount(1)
  return entering.evaluate((el) => getComputedStyle(el).animationName)
}

test('the gear opens Settings over Home, and Close returns to Home', async ({ page }) => {
  await openHome(page)

  await openSettings(page)
  await expect(page.getByRole('button', { name: q.settings.themeQuantum })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.q-layer-tab')).toContainText('My Lists')

  await closeSettings(page)
  await expect(page.getByRole('heading', { name: q.settings.title })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: q.home.title })).toBeVisible()
})

test('a skin picked in Settings re-themes the app, is announced, and survives a reload', async ({ page }) => {
  await openHome(page)
  await openSettings(page)

  await page.getByRole('button', { name: jouhou }).click()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light-bone')
  await expect(page.locator('.q-live')).toHaveText(q.skin.changed(jouhou))
  await expect(page.getByRole('button', { name: jouhou })).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light-bone')
})

test('Reduce motion cuts the entrance and the re-seat with the system asking for nothing, and survives a reload', async ({ page }) => {
  await openHome(page)
  await openSettings(page)
  await page.getByRole('checkbox', { name: q.settings.reduceMotion }).check()
  await expect(page.locator('html')).toHaveAttribute('data-reduced', '')

  await page.reload()
  await expect(page.getByRole('heading', { name: q.home.title })).toBeVisible({ timeout: 15_000 })
  expect(await enteringAnimation(page)).toBe('none')
  const covered = page.locator('.q-layer.covered')
  expect(await covered.evaluate((el) => getComputedStyle(el).transitionProperty)).toBe('none')
})

test('with the system asking for less, the box starts ticked, and unticking it brings the motion back', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openHome(page)
  await openSettings(page)
  const box = page.getByRole('checkbox', { name: q.settings.reduceMotion })
  await expect(box).toBeChecked()

  await box.uncheck()
  await expect(page.locator('html')).not.toHaveAttribute('data-reduced', '')

  await page.reload()
  await expect(page.getByRole('heading', { name: q.home.title })).toBeVisible({ timeout: 15_000 })
  expect(await enteringAnimation(page)).toContain('q-drumIn')
})

test('switching to Русский rewrites Settings at once and is still Russian after a reload', async ({ page }) => {
  await openHome(page)
  await openSettings(page)

  await page.getByRole('button', { name: 'Русский' }).click()
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible()
  await expect(page.getByRole('heading', { name: q.settings.title })).toHaveCount(0)
  // The rest of the shell follows too, without Settings having to close first.
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible({ timeout: 15_000 })
})

test('the browser build has no API keys section — keys live in the server environment', async ({ page }) => {
  await openHome(page)
  await openSettings(page)

  await expect(page.getByText(q.settings.language, { exact: true })).toBeVisible()
  await expect(page.getByText(q.settings.keys.title)).toHaveCount(0)
  await expect(page.getByRole('button', { name: q.settings.keys.test, exact: true })).toHaveCount(0)
})

test('a popover portaled outside the app root still gets the skin — the tokens live on <html>', async ({ page }) => {
  await openHome(page)

  await page.getByRole('button', { name: 'Skin', exact: true }).click()
  const menu = page.locator('.q-pop')
  await expect(menu).toBeVisible()

  const background = await menu.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(background).not.toBe('rgba(0, 0, 0, 0)')
  expect(background).not.toBe('transparent')
})

test('a pre-Phase-10 install opens in one of the four dark skins and keeps it across restarts', async ({ page }) => {
  // The old app stored `listulator:theme` and no `skin`; that value must not be read.
  await page.addInitScript(() => {
    if (!localStorage.getItem('skin')) localStorage.setItem('listulator:theme', 'paper')
  })
  await openHome(page)

  const skin = await page.locator('html').getAttribute('data-theme')
  expect(['dark-orange', 'dark-green', 'dark-blue', 'dark-violet']).toContain(skin)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', skin!)
})
