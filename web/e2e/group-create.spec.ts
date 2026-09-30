import { expect, test } from '@playwright/test'

/**
 * Task 11.17 in a real browser against the dev server: a group name with no title, in the Add Item band,
 * makes an empty group at the end of the list; a name the list already has is refused in the API's words.
 * Real writes, removed in a `finally`.
 */
test('the add band makes an empty group from a name alone, and refuses one the list already has', async ({ page }) => {
  const title = `e2e group-create ${Date.now()}`
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  await page.request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'manual', items: [{ title: 'Pilot', timeToConsumeMinutes: 40, group: 'Season 1' }] },
  })
  const groups = async () =>
    ((await (await page.request.get(`/api/lists/${list.id}`)).json()).groups as { name: string; orderIndex: number }[])
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((group) => group.name)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.locator('.q-item', { hasText: 'Pilot' })).toBeVisible()

    const band = page.locator('.q-add-item')
    await band.getByLabel('Group').fill('Extras')
    // A press past the open suggestions only closes them (the owner's rule for every picker); the next press adds.
    await band.getByRole('button', { name: 'Add Group' }).click()
    await expect(band.getByRole('listbox')).toHaveCount(0)
    await band.getByRole('button', { name: 'Add Group' }).click()

    await expect(page.locator('.q-group', { hasText: 'Extras' })).toBeVisible()
    await expect.poll(groups).toEqual(['Season 1', 'Extras'])
    // The name stays in the field, ready for the first item.
    await expect(band.getByLabel('Group')).toHaveValue('Extras')

    // A name the list already has: refused, nothing added, the API's words shown.
    await band.getByLabel('Group').fill('season 1')
    await band.getByRole('button', { name: 'Add Group' }).click()
    await expect(band.getByRole('listbox')).toHaveCount(0)
    await band.getByRole('button', { name: 'Add Group' }).click()
    await expect(band.getByRole('alert')).toContainText('group with such name')
    expect(await groups()).toEqual(['Season 1', 'Extras'])
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})
