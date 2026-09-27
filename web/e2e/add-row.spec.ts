import { expect, test } from '@playwright/test'

/**
 * The add row at the foot of a long list: its Group suggestions open above the
 * field when there is no room below, so the whole list is on screen. Real
 * writes, removed in a `finally`.
 */
test('the add row’s group list opens above the field at the foot of a long list, all of it on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const list = await (await page.request.post('/api/lists', { data: { title: `e2e add-row ${Date.now()}`, mediaType: 'game' } })).json()
  const items = Array.from({ length: 30 }, (_, i) => ({
    title: `Game ${i}`,
    timeToConsumeMinutes: 60,
    group: i < 10 ? 'Alpha' : i < 20 ? 'Beta' : 'Gamma',
  }))
  await page.request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: list.title }).click()
    const field = page.locator('.q-add-item').getByLabel('Group')
    await field.scrollIntoViewIfNeeded()
    await field.click()

    const suggestions = page.locator('.q-add-item').getByRole('listbox')
    await expect(suggestions.getByRole('option', { name: 'Gamma' })).toBeVisible()
    const box = (await suggestions.boundingBox())!
    const input = (await field.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(900)
    expect(box.y + box.height).toBeLessThanOrEqual(input.y)
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})

/** WebKit never focuses a clicked button, so the Type list cannot rely on blur to close (owner). */
test('the add row’s Type list closes on a click past it, and that click does nothing else', async ({ page }) => {
  const list = await (await page.request.post('/api/lists', { data: { title: `e2e add-row type ${Date.now()}`, mediaType: 'music' } })).json()
  await page.request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'manual', items: [{ title: 'Oceanic', timeToConsumeMinutes: 52, tags: ['Album'] }] },
  })

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: list.title }).click()
    const row = page.locator('.q-add-item')
    await row.getByRole('button', { name: /^Type:/ }).click()
    await row.getByRole('option', { name: 'Live' }).click()
    await expect(row.getByRole('listbox')).toBeVisible()

    // A click on a row past it only closes the list, like any other picker (owner): the row is not marked done.
    const oceanic = page.locator('[data-row-id]', { hasText: 'Oceanic' })
    await oceanic.click()
    await expect(row.getByRole('listbox')).toBeHidden()
    await expect(oceanic).not.toHaveClass(/is-done/)

    // The next click is an ordinary one.
    await oceanic.click()
    await expect(oceanic).toHaveClass(/is-done/)
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})
