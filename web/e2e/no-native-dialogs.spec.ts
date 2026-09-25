import { expect, test } from '@playwright/test'

/**
 * Task 6.7 replaced `window.confirm()` with an in-app `Modal` specifically
 * because Tauri's WKWebView doesn't implement the native dialog delegate —
 * `confirm()` there just returns `false` with nothing shown
 * (`ListDetail.tsx`'s own comment on `confirmRemove`). 10.7's own acceptance
 * item ("no native dialog anywhere") was previously only grep-verified;
 * this exercises the actual delete flow live and fails if a real dialog
 * ever fires, which a real engine can detect and grep can't (a dynamically
 * constructed call, a dependency calling it, dead code that still runs).
 */
test('deleting a list never triggers a native dialog, only the in-app popover — and Undo brings it back', async ({
  page,
}) => {
  const title = `e2e no-native-dialogs ${Date.now()}`
  const created = await page.request.post('/api/lists', { data: { title, mediaType: 'tv' } })
  expect(created.ok()).toBe(true)
  const id = (await created.json()).id
  await page.request.post(`/api/lists/${id}/items/import`, {
    data: { source: 'manual', items: [{ title: 'Alpha', timeToConsumeMinutes: 30 }] },
  })

  try {
    const dialogs: string[] = []
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message())
      void dialog.dismiss()
    })

    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.getByRole('heading', { name: new RegExp(title) })).toBeVisible()

    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Delete list' }).click()
    await expect(page.getByText(`Delete “${title}”?`)).toBeVisible()
    await expect(page.getByText('1 item and 0 marked done go with it. Undo is offered for 8 seconds.')).toBeVisible()
    await page.locator('.q-pop').getByRole('button', { name: 'Delete list' }).click()

    await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible()
    await expect(page.locator('.q-home-row', { hasText: title })).toBeHidden()
    expect((await page.request.get(`/api/lists/${id}`)).status()).toBe(404)

    // Undo works from Home, where the screen it was raised on is gone.
    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.q-home-row', { hasText: title })).toBeVisible()
    const back = await (await page.request.get(`/api/lists/${id}`)).json()
    expect(back.items.map((i: { title: string }) => i.title)).toEqual(['Alpha'])

    expect(dialogs).toEqual([])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
