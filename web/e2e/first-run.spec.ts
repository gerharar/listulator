import { expect, test } from '@playwright/test'

/**
 * First run (tasks 10.10, 10.11): a successful fetch returning zero lists
 * starts on the Category picker, with no way back — matching the design
 * prototype's own boot stack, `[{kind:'cats', first:true}]`. Intercepted at the network
 * layer rather than actually emptying the dev database, which every other
 * spec in this suite shares.
 */
test('a fresh install with zero lists boots straight into the Category picker, with no way back', async ({
  page,
}) => {
  await page.route('**/api/lists', (route) => route.fulfill({ json: [] }))

  await page.goto('/')

  const headline = page.getByRole('heading', {
    name: 'Nothing tracked yet — pick a shelf and fill it',
  })
  await expect(headline).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeHidden()

  // The picker is the base layer itself (index 0), not a layer pushed on top
  // of Home — so there is no close button, matching the design prototype's
  // `canClose:false`.
  await expect(page.getByRole('button', { name: 'Close' })).toBeHidden()
})

/**
 * The reset `App.tsx`'s `handleLegacyNavigate` needs after a first-run
 * creation (docs/DECISIONS.md): a plain `replaceTop` would leave the picker
 * (the base layer) under the new list, and Home would never get created at
 * all. Only `GET` is intercepted, so the actual `POST /api/lists` this
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
  await expect(
    page.getByRole('heading', { name: 'Nothing tracked yet — pick a shelf and fill it' }),
  ).toBeVisible({ timeout: 15_000 })

  await page.unroute('**/api/lists')

  // Pick the first shelf; the Create layer takes it from there. Add by hand
  // works with no API key, unlike the Search tab it opens on.
  await page.locator('.q-tile').first().click()
  await expect(page.getByRole('heading', { name: /^New .* list$/ })).toBeVisible()
  await page.getByRole('tab', { name: 'Add by hand' }).click()

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

  // Clean up the real list this test created. (Through the API: the list
  // screen has no Delete until 10.22.)
  const all: { id: string; title: string }[] = await (await page.request.get('/api/lists')).json()
  const id = all.find((entry) => entry.title === title)?.id
  if (id) await page.request.delete(`/api/lists/${id}`)
})
