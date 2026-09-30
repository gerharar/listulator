import { expect, test, type Page } from '@playwright/test'
import { useHomeFixture } from './fixtures.js'

/**
 * The About layer (task 11.21) in a real browser: jsdom cannot load an image
 * or say whether a link would open a new tab.
 */
async function openAbout(page: Page) {
  await useHomeFixture(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'About', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible()
}

test('the ⓘ opens About once, and Close returns to Home', async ({ page }) => {
  await openAbout(page)

  await page.getByRole('button', { name: 'About', exact: true }).click()
  await expect(page.locator('.q-about')).toHaveCount(1)

  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.q-about')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible()
})

test('TMDB’s logo loads at its own size, never squeezed, beside the notice', async ({ page }) => {
  await openAbout(page)
  const logo = page.getByRole('img', { name: 'The Movie Database (TMDB)' })

  await expect(logo).toBeVisible()
  expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  // Layout size, not the on-screen box: a layer card is drawn slightly scaled as the stack settles.
  expect(await logo.evaluate((img: HTMLImageElement) => [img.offsetWidth, img.offsetHeight])).toEqual([182, 24])
  await expect(page.getByText(/This application uses TMDB and the TMDB APIs/)).toBeVisible()
})

test('a source link opens a new tab and leaves the app where it was', async ({ page, context }) => {
  await openAbout(page)
  const appUrl = page.url()
  await context.route('https://musicbrainz.org/**', (route) => route.fulfill({ body: 'stub' }))

  const [tab] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: /musicbrainz\.org/ }).click(),
  ])

  expect(tab.url()).toBe('https://musicbrainz.org/')
  expect(page.url()).toBe(appUrl)
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible()
  await tab.close()
})
