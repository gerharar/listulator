import { expect, test } from '@playwright/test'
import { useHomeFixture } from './fixtures.js'

/**
 * The Category picker against the real `/api/media-types` registry (task
 * 10.11) — the RTL suite feeds it a hand-built registry, so it can't catch
 * the live registry disagreeing with the design handoff's own table.
 */
test('New List opens the picker, driven by the live registry rather than the handoff’s table', async ({
  page,
}) => {
  await useHomeFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()

  await expect(page.getByRole('heading', { name: 'Pick A Category' })).toBeVisible()

  // Display labels come from the locale; the registry still says "TV Shows".
  const tvTile = page.locator('.q-tile', { hasText: 'TV Series' })
  const wrestlingTile = page.locator('.q-tile', { hasText: 'Pro Wrestling' })
  await expect(tvTile).toBeVisible()
  await expect(page.locator('.q-tile', { hasText: 'TV Shows' })).toHaveCount(0)

  // The handoff's table says Wrestling and MMA are "by hand"; the registry
  // has both on Wikipedia, and the registry wins.
  await expect(wrestlingTile.locator('.q-tile-src')).toHaveText('Wikipedia')
  await expect(page.locator('.q-tile', { hasText: 'MMA' }).locator('.q-tile-src')).toHaveText(
    'Wikipedia',
  )

  // The fixture list is a movie, so Movies alone shows a count chip.
  await expect(page.locator('.q-count-chip')).toHaveCount(1)
  await expect(page.locator('.q-tile.used .q-count-chip')).toHaveText('1')
})

test('picking a tile opens the Create layer for that category, Esc returns to the picker, and Close returns to Home', async ({
  page,
}) => {
  await useHomeFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible()

  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: 'Pro Wrestling' }).click()

  await expect(page.getByRole('heading', { name: 'New Pro Wrestling list' })).toBeVisible()
  // Wrestling's real source is Wikipedia, so the Search tab names it.
  await expect(page.getByRole('tab', { name: 'Search Wikipedia' })).toBeVisible()

  // Esc pops one layer — back to the picker, not all the way home.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Pick A Category' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'New Pro Wrestling list' })).toBeHidden()
})
