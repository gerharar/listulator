import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Item actions on the list layer (task 10.21) against the real dev server:
 * add into a group typed on the spot, remove with Undo (same index back), and
 * edit through the popover. Real writes, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string): Promise<string> {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: {
      source: 'manual',
      items: [
        { title: 'Alpha', timeToConsumeMinutes: 30, group: 'Season 1' },
        { title: 'Beta', timeToConsumeMinutes: 30, group: 'Season 1' },
        { title: 'Gamma', timeToConsumeMinutes: 30, group: 'Season 2' },
      ],
    },
  })

  return list.id
}

const detail = async (request: APIRequestContext, id: string) =>
  (await request.get(`/api/lists/${id}`)).json()

test('add, remove with Undo, and edit — each saved, each undoable', async ({ page }) => {
  const title = `e2e list-actions ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await page.getByRole('button', { name: new RegExp(title) }).click()
    await expect(page.getByText('Alpha')).toBeVisible()

    // Add: a new group typed in the field, created with the item.
    await page.getByLabel('Title', { exact: true }).fill('Bonus')
    await page.getByLabel('Group', { exact: true }).fill('Specials')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('Bonus', { exact: true })).toBeVisible()

    let saved = await detail(page.request, id)
    expect(saved.groups.map((g: { name: string }) => g.name)).toEqual(['Season 1', 'Season 2', 'Specials'])
    expect(saved.items.at(-1)).toMatchObject({ title: 'Bonus', group: 'Specials' })

    // Remove Beta, then Undo: it comes back at its own index.
    const betaBefore = saved.items.find((i: { title: string }) => i.title === 'Beta')
    await page.getByRole('button', { name: 'Remove Beta' }).click()
    await expect(page.getByText('Beta', { exact: true })).toBeHidden()
    saved = await detail(page.request, id)
    expect(saved.items.some((i: { title: string }) => i.title === 'Beta')).toBe(false)

    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Beta', { exact: true })).toBeVisible()
    saved = await detail(page.request, id)
    const betaAfter = saved.items.find((i: { title: string }) => i.title === 'Beta')
    expect(betaAfter).toMatchObject({ id: betaBefore.id, orderIndex: betaBefore.orderIndex })

    // Edit Gamma through the popover: Save.
    await page.getByRole('button', { name: 'Edit Gamma' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill('Gamma Prime')
    await dialog.getByLabel('Minutes').fill('45')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Gamma Prime')).toBeVisible()
    saved = await detail(page.request, id)
    expect(saved.items.find((i: { title: string }) => i.title === 'Gamma Prime')).toMatchObject({
      timeToConsumeMinutes: 45,
      timeToConsumeIsEstimated: false,
    })

    // Details show the item's notes only when it has some.
    await page.getByRole('button', { name: 'Details for Alpha' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.locator('.q-info-notes')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
