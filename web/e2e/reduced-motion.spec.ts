import { expect, test } from '@playwright/test'

/**
 * 10.9c's own carried-forward check (docs/DECISIONS.md, "The drum cascade's
 * rise amounts are not the prototype's `DY`, and why") — code-reviewed but
 * never toggled live. `page.emulateMedia` drives real engine media
 * evaluation, so this can actually assert the cut rather than trust the
 * CSS by inspection.
 */
test('a pushed layer drums in, and re-seats the layer it covers, under normal motion', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'New List' }).click()

  const entering = page.locator('.q-layer.enter')
  await expect(entering).toHaveCount(1)
  await expect
    .poll(() => entering.evaluate((el) => getComputedStyle(el).animationName))
    .toContain('q-drumIn')

  const covered = page.locator('.q-layer.covered')
  const transitionProperty = await covered.evaluate((el) => getComputedStyle(el).transitionProperty)
  expect(transitionProperty).toContain('top')
})

test('reduced motion cuts both the drum-in and the re-seat transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'New List' }).click()

  const entering = page.locator('.q-layer.enter')
  await expect(entering).toHaveCount(1)
  const animationName = await entering.evaluate((el) => getComputedStyle(el).animationName)
  expect(animationName).toBe('none')

  const covered = page.locator('.q-layer.covered')
  const transitionProperty = await covered.evaluate((el) => getComputedStyle(el).transitionProperty)
  expect(transitionProperty).toBe('none')

  const tab = page.locator('.q-layer-tab')
  const tabAnimationName = await tab.evaluate((el) => getComputedStyle(el).animationName)
  expect(tabAnimationName).toBe('none')
})
