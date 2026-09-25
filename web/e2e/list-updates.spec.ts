import { expect, test } from '@playwright/test'

/**
 * The update flow end to end (tasks 10.25, 10.22c): nothing checks by itself;
 * Home's ⟳ looks at every list with a source and raises a band per finding;
 * the finding survives a reload; Update List applies it from Home; the list
 * shows NEW rows and Mark all seen; and the list's own check icon raises the
 * found band, which Dismiss puts away. The source's answers are stubbed in the
 * browser (no network to a real source); the import and Mark all seen are real
 * writes against the dev server, removed in a `finally`.
 */
test('check from Home, apply from Home, review in the list', async ({ page }) => {
  const title = `e2e list-updates ${Date.now()}`
  const created = await page.request.post('/api/lists', {
    data: { title, mediaType: 'tv', source: 'api', externalRef: 'e2e:fake' },
  })
  expect(created.ok()).toBe(true)
  const list = await created.json()
  await page.request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'import', items: [{ title: 'Alpha', timeToConsumeMinutes: 30 }] },
  })

  try {
    let answer = [
      { title: 'Beta', timeToConsumeMinutes: 30 },
      { title: 'Gamma', timeToConsumeMinutes: 30 },
    ]
    await page.route(`**/api/lists/${list.id}/refresh`, (route) =>
      route.fulfill({
        json: { newItems: answer, upstreamCount: 3, existingCount: 1, dismissedCount: 0 },
      }),
    )
    // Other lists in the dev database with a source are not this test's business.
    await page.route(/\/api\/lists\/(?!.*e2e)[^/]+\/refresh$/, (route, request) =>
      request.url().includes(list.id)
        ? route.fallback()
        : route.fulfill({ json: { newItems: [], upstreamCount: 0, existingCount: 0, dismissedCount: 0 } }),
    )

    await page.goto('/')
    const row = page.locator('.q-home-row', { hasText: title })
    await expect(row).toBeVisible()
    // Nothing checks on open.
    await expect(page.locator('.q-banner', { hasText: title })).toBeHidden()

    await page.locator('.q-home-actions').getByRole('button', { name: 'Check for updates' }).click()
    const band = page.locator('.q-banner', { hasText: title })
    await expect(band).toContainText('has 2 new items.')

    // What it found is still there after a reload.
    await page.reload()
    await expect(band).toContainText('has 2 new items.')

    // Apply from Home, without opening the list.
    await band.getByRole('button', { name: 'Update List' }).click()
    await expect(band).toBeHidden()
    await expect(row).toContainText('2 NEW')
    const saved = await (await page.request.get(`/api/lists/${list.id}`)).json()
    expect(saved.stats.newItems).toBe(2)

    // In the list: NEW rows and the usual band with Mark all seen.
    await row.click()
    const actions = page.locator('.q-list-actions')
    await expect(page.locator('.q-item').filter({ hasText: 'Beta' }).getByText('NEW')).toBeVisible()
    await expect(page.locator('.q-item').filter({ hasText: 'Alpha' }).getByText('NEW')).toBeHidden()
    await expect(page.getByText('2 new items were added')).toBeVisible()
    await page.getByRole('button', { name: 'Mark all seen' }).click()
    await expect(page.getByText('NEW', { exact: true })).toHaveCount(0)

    // The list's own check raises the found band; nothing is added; Dismiss puts it away.
    answer = [{ title: 'Delta', timeToConsumeMinutes: 30 }]
    await actions.getByRole('button', { name: 'Check for updates' }).click()
    await expect(page.getByText('1 new item found.')).toBeVisible()
    expect((await (await page.request.get(`/api/lists/${list.id}`)).json()).items).toHaveLength(3)
    await page.locator('.q-list .q-banner', { hasText: '1 new item found.' }).getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByText('1 new item found.')).toBeHidden()

    // ✕ closes the layer.
    await actions.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible()
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})
