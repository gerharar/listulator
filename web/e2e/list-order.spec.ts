import { expect, test } from '@playwright/test'
import { q } from './fixtures.js'

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
    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Reorder List' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Sort by release date' }).click()
    await expect(page.locator('.q-toast')).toContainText('Sorted by date')
    expect(await titles()).toEqual(['Older', 'Newer', 'Mine'])
    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(titles).toEqual(['Newer', 'Older', 'Mine'])

    // Restore source order (in Reorder List): sort, then put the source's own order back, with its Undo.
    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Reorder List' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Sort by release date' }).click()
    await expect.poll(titles).toEqual(['Older', 'Newer', 'Mine'])
    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Reorder List' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Restore source order' }).click()
    await expect(page.locator('.q-toast')).toContainText('Source order restored')
    await expect.poll(titles).toEqual(['Newer', 'Older', 'Mine'])
    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(titles).toEqual(['Older', 'Newer', 'Mine'])
    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Reorder List' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Restore source order' }).click()
    await expect.poll(titles).toEqual(['Newer', 'Older', 'Mine'])

    // Reset to the source: the cost first, in words. Reset List offers only Reset (the order buttons moved).
    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Reset List' }).click()
    await expect(page.getByText(q.list.orderMenu.joinCost([q.list.orderMenu.removed(1), q.list.orderMenu.cleared(1)]))).toBeVisible()
    await expect(page.locator('.q-pop').getByRole('button', { name: /order/i })).toHaveCount(0)
    await page.locator('.q-pop').getByRole('button', { name: 'Reset', exact: true }).click()
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
