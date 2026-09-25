import { expect, test } from '@playwright/test'

/**
 * The update flow end to end (task 10.25): Home banner → the list layer (the
 * cue rides on the layer's own path) → Update list → Add → NEW marks and the
 * banner → Mark all seen. The two upstream questions are answered in the
 * browser (no network to GitHub); the import and Mark all seen are real writes
 * against the dev server, removed in a `finally`.
 */
test('the Home banner opens the list, Add brings NEW items, Mark all seen clears them', async ({ page }) => {
  const title = `e2e list-updates ${Date.now()}`
  // Any list with a source ref will do: the upstream answers are stubbed below.
  const created = await page.request.post('/api/lists', {
    data: { title, mediaType: 'tv', source: 'api', externalRef: 'e2e:fake' },
  })
  expect(created.ok()).toBe(true)
  const list = await created.json()
  await page.request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'import', items: [{ title: 'Alpha', timeToConsumeMinutes: 30 }] },
  })

  try {
    await page.route('**/api/lists/updates', (route) =>
      route.fulfill({ json: { updates: [{ listId: list.id, title }] } }),
    )
    await page.route(`**/api/lists/${list.id}/refresh`, (route) =>
      route.fulfill({
        json: {
          newItems: [
            { title: 'Beta', timeToConsumeMinutes: 30 },
            { title: 'Gamma', timeToConsumeMinutes: 30 },
          ],
          upstreamCount: 3,
          existingCount: 1,
          dismissedCount: 0,
        },
      }),
    )

    await page.goto('/')
    await page.locator('.q-banner').getByRole('button', { name: title }).click()

    // Nothing was checked on arrival; the button only says an update is known.
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Check for updates/ }).click()
    await page.getByRole('button', { name: 'Add 2 to this list' }).click()

    await expect(page.getByText('Beta', { exact: true })).toBeVisible()
    await expect(page.locator('.q-item').filter({ hasText: 'Beta' }).getByText('NEW')).toBeVisible()
    await expect(page.locator('.q-item').filter({ hasText: 'Alpha' }).getByText('NEW')).toBeHidden()
    await expect(page.getByText('2 new items were added')).toBeVisible()

    let saved = await (await page.request.get(`/api/lists/${list.id}`)).json()
    expect(saved.stats.newItems).toBe(2)

    await page.getByRole('button', { name: 'Mark all seen' }).click()
    await expect(page.getByText('NEW', { exact: true })).toHaveCount(0)
    await expect(page.getByText('2 new items were added')).toBeHidden()

    saved = await (await page.request.get(`/api/lists/${list.id}`)).json()
    expect(saved.stats.newItems).toBe(0)
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})
