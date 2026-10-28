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

/** The layer drums in over 380ms: a hover or a measurement made before it has settled lands on a row that is still moving. */
const settled = (page: Page) => page.waitForFunction(() => document.getAnimations().length === 0)

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

test('the Mark open and closed groups row has its tooltip on hover, and the other Screen boxes have none (H-022, 38.8b)', async ({ page }) => {
  await openHome(page)
  await openSettings(page)
  await settled(page)

  await page.locator('label.q-settings-check', { hasText: q.settings.markOpenGroups }).hover()
  await expect(page.getByRole('tooltip')).toHaveText(q.settings.markOpenGroupsTip)

  await page.getByRole('checkbox', { name: q.settings.reduceMotion }).hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('the same tooltip shows when Tab reaches the box (H-022, 38.8b)', async ({ page, browserName }) => {
  // WebKit's default is that Tab skips checkboxes (a system setting), so only Chromium can walk to it.
  test.skip(browserName !== 'chromium', 'Tab does not reach a checkbox in WebKit by default')
  await openHome(page)
  await openSettings(page)
  const box = page.getByRole('checkbox', { name: q.settings.markOpenGroups })

  await page.mouse.move(0, 0)
  for (let step = 0; step < 40; step += 1) {
    if (await box.evaluate((node) => node === document.activeElement)) break
    await page.keyboard.press('Tab')
  }

  await expect(box).toBeFocused()
  await expect(page.getByRole('tooltip')).toHaveText(q.settings.markOpenGroupsTip)
})

test('the tooltip sits over the box and its words, not over the empty rest of a row that spans the section (H-022, 38.8b)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openHome(page)
  await openSettings(page)
  await settled(page)
  const row = page.locator('label.q-settings-check', { hasText: q.settings.markOpenGroups })

  await row.hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  const tip = (await page.getByRole('tooltip').boundingBox())!
  const row$ = (await row.boundingBox())!
  // What the row holds: the box and the words, as the browser lays them out.
  const content = await row.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const rect = range.getBoundingClientRect()

    return { left: rect.left, right: rect.right }
  })

  // The row is as wide as what is in it (a few pixels of play), so a tooltip centred on the row is centred on the box and its words.
  expect(row$.width).toBeLessThan(content.right - content.left + 8)
  const centre = tip.x + tip.width / 2
  expect(centre).toBeGreaterThanOrEqual(content.left)
  expect(centre).toBeLessThanOrEqual(content.right)
})

