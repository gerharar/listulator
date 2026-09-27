import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * An item's tags by hand in the Edit window (U5, docs/chips): the Platform
 * panel for Games, a short dropdown for Music. Real writes, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string, mediaType: string, items: object[]) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })
  return list.id as string
}

const itemTags = async (request: APIRequestContext, listId: string, title: string) => {
  const list = await (await request.get(`/api/lists/${listId}`)).json()
  return list.items.find((item: { title: string }) => item.title === title).tags as string[] | null
}

test('a game’s platforms are picked in the panel beside the Edit window and saved in the table’s order', async ({ page }) => {
  const title = `e2e item-tags games ${Date.now()}`
  const id = await makeList(page.request, title, 'game', [
    { title: 'Assassin’s Creed', timeToConsumeMinutes: 900, tags: ['PS3'] },
    { title: 'Unity', timeToConsumeMinutes: 900 },
  ])

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.getByRole('button', { name: 'Edit Unity' }).click()
    await page.getByRole('button', { name: 'Platform: Not set' }).click()

    const panel = page.getByRole('dialog', { name: 'Choose platforms' })
    // Beside the window, not over it.
    const edit = (await page.locator('.q-pop').boundingBox())!
    const box = (await panel.boundingBox())!
    expect(box.x >= edit.x + edit.width || box.x + box.width <= edit.x).toBe(true)
    await expect(panel.getByRole('group', { name: 'In this list' })).toContainText('PS3')

    // Most common shows six once the list has platforms (WIN first); PS4 is found by search.
    await expect(panel.getByRole('group', { name: 'Most common' })).toContainText('WIN')
    const search = panel.getByPlaceholder('Search 186 platforms')
    await search.fill('ps4')
    await panel.getByRole('button', { name: /^PS4 / }).click()
    await search.fill('windows')
    await panel.getByRole('button', { name: /^WIN / }).click()
    // Esc closes the panel only; the window keeps the picks.
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(page.getByRole('button', { name: 'Platform: WIN · PS4' })).toBeVisible()
    await page.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => itemTags(page.request, id, 'Unity')).toEqual(['WIN', 'PS4'])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a music item’s Type is one pick from its short list; other tags stay', async ({ page }) => {
  const title = `e2e item-tags music ${Date.now()}`
  const id = await makeList(page.request, title, 'music', [
    { title: 'Panopticon', timeToConsumeMinutes: 60, tags: ['Album', 'Remaster'] },
  ])

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.getByRole('button', { name: 'Edit Panopticon' }).click()
    await page.getByRole('button', { name: 'Type: Album' }).click()
    await page.getByRole('option', { name: 'EP' }).click()
    await page.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => itemTags(page.request, id, 'Panopticon')).toEqual(['Remaster', 'EP'])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
