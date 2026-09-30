import { expect, test } from '@playwright/test'

/**
 * The app's own hover text (11.19) in real browsers: it replaces the native `title`, waits about a quarter
 * of a second, opens for keyboard focus too, closes on leave and Esc, and stays on screen.
 */
test('an icon button’s tooltip opens after a short wait, on hover and on keyboard focus, and closes on leave and Esc', async ({ page }) => {
  await page.goto('/')
  const button = page.getByRole('button', { name: 'Settings' })
  await expect(button).toBeVisible()
  await expect(button).not.toHaveAttribute('title', /.+/)

  await button.hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0) // not at once: this is not the instant kind
  await expect(page.getByRole('tooltip')).toHaveText('Settings', { timeout: 2000 })
  const box = (await page.getByRole('tooltip').boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y).toBeGreaterThanOrEqual(0)

  await page.mouse.move(5, 300)
  await expect(page.getByRole('tooltip')).toHaveCount(0)

  // Keyboard focus shows it, Esc puts it away.
  await button.focus()
  await expect(page.getByRole('tooltip')).toHaveText('Settings', { timeout: 2000 })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})
