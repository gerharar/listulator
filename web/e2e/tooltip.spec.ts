import { expect, test } from '@playwright/test'

/**
 * The app's own hover text (11.19) in real browsers: it replaces the native `title`, waits half a second, opens for keyboard focus too, closes on leave and Esc, and stays on screen.
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

test('a row’s handle and a cut-off title get a tooltip; a title that fits does not', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 })
  const long = 'Better Call Saul Employee Training: Los Pollos Hermanos Employee Training, Season One, Disc Two'
  const title = `e2e tooltip rows ${Date.now()}`
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  await page.request.post(`/api/lists/${list.id}/items/import`, {
    data: {
      source: 'manual',
      items: [
        { title: long, timeToConsumeMinutes: 40, group: 'A group with a name that is far too long to fit in the row at this width, really' },
        { title: 'Pilot', timeToConsumeMinutes: 40 },
      ],
    },
  })

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.locator('.q-item', { hasText: 'Pilot' })).toBeVisible()
    await expect(page.locator('[title]')).toHaveCount(0) // no native tooltips left on the list screen

    const tip = page.getByRole('tooltip')
    await page.locator('.q-item .title', { hasText: 'Better Call Saul' }).hover()
    await expect(tip).toHaveText(long, { timeout: 2000 })
    await page.mouse.move(2, 400)
    await expect(tip).toHaveCount(0)

    await page.locator('.q-item .title', { hasText: 'Pilot' }).hover()
    await page.waitForTimeout(900)
    await expect(tip).toHaveCount(0) // fits: nothing to add

    await page.locator('.q-item', { hasText: 'Pilot' }).locator('.q-handle').hover()
    await expect(tip).toContainText('Drag', { timeout: 2000 })
    await page.mouse.move(2, 400)

    await page.locator('.q-group b').hover()
    await expect(tip).toContainText('A group with a name', { timeout: 2000 })
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})
