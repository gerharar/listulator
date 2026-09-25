import { expect, test } from '@playwright/test'

/**
 * The Order menu (task 10.22) against the real dev server: Sort chronologically
 * and Reset to the source, each with its Undo. A file-sourced list, so the
 * reset needs no network. Real writes, removed in a `finally`.
 */
test('sort, reset to the source, and undo both', async ({ page }) => {
  const title = `e2e list-order ${Date.now()}`
  const yaml = `title: ${title}\ncategory: movie\nitems:\n  - { title: Newer, year: 2010 }\n  - { title: Older, year: 1990 }\n`
  const created = await page.request.post('/api/lists/from-file', { data: { yaml } })
  expect(created.ok()).toBe(true)
  const id = (await created.json()).id
  const detail = async () => (await page.request.get(`/api/lists/${id}`)).json()
  const titles = async () => (await detail()).items.map((i: { title: string }) => i.title)

  try {
    await page.request.post(`/api/lists/${id}/items`, { data: { title: 'Mine', timeToConsumeMinutes: 5 } })
    const before = await detail()
    await page.request.put(`/api/lists/${id}/items/${before.items[0].id}/consumed`, { data: { consumed: true } })

    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.getByText('Newer', { exact: true })).toBeVisible()

    // Sort chronologically: at once, with Undo.
    await page.getByRole('button', { name: 'Order', exact: true }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Sort chronologically' }).click()
    await expect(page.locator('.q-toast')).toContainText('Sorted chronologically')
    expect(await titles()).toEqual(['Older', 'Newer', 'Mine'])
    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(titles).toEqual(['Newer', 'Older', 'Mine'])

    // Reset to the source: the cost first, in words.
    await page.getByRole('button', { name: 'Order', exact: true }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Reset to the source' }).click()
    await expect(page.getByText('1 item you added will be removed and 1 done mark will be cleared.')).toBeVisible()
    await page.locator('.q-pop').getByRole('button', { name: 'Reset everything' }).click()
    await expect(page.getByText('Mine', { exact: true })).toBeHidden()
    expect(await titles()).toEqual(['Newer', 'Older'])
    expect((await detail()).items.every((i: { consumedAt: string | null }) => i.consumedAt === null)).toBe(true)

    // Undo of the reset: the hand-added item and the tick come back.
    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Mine', { exact: true })).toBeVisible()
    const after = await detail()
    expect(after.items.map((i: { title: string }) => i.title)).toEqual(['Newer', 'Older', 'Mine'])
    expect(after.items[0].consumedAt).not.toBeNull()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
