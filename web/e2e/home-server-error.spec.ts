import { expect, test } from '@playwright/test'

/**
 * Q13 (tasks/plan.md): a server that's unreachable or erroring renders
 * Home's own ErrorBlock, never the zero-lists first-run screen. Proven here
 * against a real failed request, not the mocked `api` module Home.test.tsx
 * uses — that suite can't tell the difference between "the acceptance
 * criterion holds" and "the mock was configured to make it look like it
 * does".
 */
test('a fully unreachable server shows Home’s ErrorBlock, not the create flow — and Retry recovers', async ({
  page,
}) => {
  await page.route('**/api/**', (route) => route.abort())

  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'New list' })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible()

  await page.unroute('**/api/**')
  await page.getByRole('button', { name: 'Retry' }).click()

  await expect(page.getByText('Test Layer Stack List')).toBeVisible()
})
