import { expect, test } from '@playwright/test'

/**
 * First run (task 10.10): a successful fetch returning zero lists starts on
 * the create flow, with no way back — matching the design prototype's own
 * boot stack, `[{kind:'cats', first:true}]`. Intercepted at the network
 * layer rather than actually emptying the dev database, which every other
 * spec in this suite shares.
 */
test('a fresh install with zero lists boots straight into New list, with no way back', async ({
  page,
}) => {
  await page.route('**/api/lists', (route) => route.fulfill({ json: [] }))

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'New list' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeHidden()

  // New list is the base layer itself here (index 0), not a layer pushed on
  // top of Home — its own "All lists" link still renders (it doesn't know
  // it's the base), but `popToIndex(0)` is a no-op at the base by
  // `layerStack.ts`'s own construction, so clicking it goes nowhere. No
  // separate "hide the link" logic was added for this — the existing
  // no-op is what actually makes this "no way back", matching the design
  // prototype's `canClose:false`.
  await page.getByRole('link', { name: 'All lists' }).click()
  await expect(page.getByRole('heading', { name: 'New list' })).toBeVisible()
})

/**
 * The reset `App.tsx`'s `handleLegacyNavigate` needs after a first-run
 * creation (docs/DECISIONS.md): a plain `replaceTop` would swap `new-list`
 * for `list` *in place* at the base layer, and Home would never get created
 * at all. Only `GET` is intercepted, so the actual `POST /api/lists` this
 * test triggers is a real write against the dev database — cleaned up at
 * the end, the same discipline `no-native-dialogs.spec.ts` uses.
 */
test('after the first-run creation, Home exists again with the new list pushed on top of it', async ({
  page,
}) => {
  await page.route('**/api/lists', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] })
    return route.continue()
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'New list' })).toBeVisible({ timeout: 15_000 })

  await page.unroute('**/api/lists')

  const title = `e2e first-run ${Date.now()}`
  await page.getByLabel('List title').fill(title)
  await page.getByRole('button', { name: 'Create list' }).click()

  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  // Home's LayerTab, covered but present — it would not exist at all if the
  // stack were still just `[list]`.
  await expect(page.getByRole('button', { name: 'My Lists' })).toBeVisible()

  await page.getByRole('button', { name: 'My Lists' }).click()
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible()
  await expect(page.getByText(title)).toBeVisible()

  // Clean up the real list this test created.
  await page.getByText(title).click()
  await page.getByRole('button', { name: 'Delete list' }).click()
  await page.getByRole('button', { name: 'Yes, delete' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeHidden()
})
