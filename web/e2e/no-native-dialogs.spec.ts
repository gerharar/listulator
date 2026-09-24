import { expect, test } from '@playwright/test'
import { useHomeFixture } from './fixtures.js'

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
// The Delete list button lived on the old list screen. The new list screen
// (task 10.20) has no delete until 10.22's ⋯ menu, so this is parked, not
// dropped: restore it there (docs/DECISIONS.md, "10.20").
test.fixme('deleting a list never triggers a native dialog, only the in-app Modal', async ({ page }) => {
  await useHomeFixture(page)
  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible({ timeout: 15_000 })

  const title = `e2e no-native-dialogs ${Date.now()}`
  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile').first().click()
  await page.getByRole('tab', { name: 'Add by hand' }).click()
  await page.getByLabel('List title').fill(title)
  await page.getByRole('button', { name: 'Create list' }).click()

  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  await page.getByRole('button', { name: 'Delete list' }).click()
  await expect(page.getByText(`Delete "${title}" and all its items?`)).toBeVisible()
  await page.getByRole('button', { name: 'Yes, delete' }).click()

  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible()
  await expect(page.getByRole('heading', { name: title })).toBeHidden()

  expect(dialogs).toEqual([])
})
