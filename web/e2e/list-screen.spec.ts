import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * The list layer (task 10.20) against the real dev server: what a Mega list
 * and an ordinary list look like on arrival, and that ticking an item moves
 * the header sentence at once and is saved. Real writes, removed in a
 * `finally`.
 */
async function makeList(
  request: APIRequestContext,
  mediaType: string,
  title: string,
): Promise<string> {
  const list = await (
    await request.post('/api/lists', { data: { title, mediaType, status: 'ongoing' } })
  ).json()

  await request.post(`/api/lists/${list.id}/items/import`, {
    data: {
      source: 'manual',
      items: [
        { title: 'Episode 1', timeToConsumeMinutes: 60, group: 'Season 1' },
        { title: 'Episode 2', timeToConsumeMinutes: 60, group: 'Season 1' },
        { title: 'Episode 3', timeToConsumeMinutes: 60, group: 'Season 2' },
      ],
    },
  })

  return list.id
}

for (const [mediaType, arrives] of [
  ['mega', 'collapsed'],
  ['tv', 'expanded'],
] as const) {
  test(`a ${mediaType} list's season groups arrive ${arrives}, and ticking an item is saved`, async ({
    page,
  }) => {
    const title = `e2e list-screen ${mediaType} ${Date.now()}`
    const id = await makeList(page.request, mediaType, title)

    try {
      await page.goto('/')
      await page.getByRole('button', { name: new RegExp(title) }).click()
      await expect(page.getByRole('heading', { name: new RegExp(`^${title}`) })).toBeVisible()

      const groups = page.locator('.q-group')
      await expect(groups).toHaveCount(2)
      await expect(groups.first()).toHaveAttribute(
        'aria-expanded',
        arrives === 'collapsed' ? 'false' : 'true',
      )
      await expect(page.getByText('Episode 1')).toHaveCount(arrives === 'collapsed' ? 0 : 1)

      // Open Season 1 (a no-op on the list that arrived open, so click only if closed).
      if (arrives === 'collapsed') await groups.first().click()
      await expect(page.getByText('0/3 (0%)').first()).toBeVisible()

      await page.getByText('Episode 1').click()

      // The header sentence moved without waiting for a reload.
      await expect(page.getByText('1/3 (33%)').first()).toBeVisible()
      await expect(page.getByText('2h left').first()).toBeVisible()

      const saved = await (await page.request.get(`/api/lists/${id}`)).json()
      expect(saved.items.filter((item: { consumedAt: string | null }) => item.consumedAt)).toHaveLength(1)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}
