import { expect, test } from '@playwright/test'
import { FIXTURE_LIST_ID, FIXTURE_LIST_TITLE, useHomeFixture } from './fixtures.js'

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
  // Registered before the full abort below: `page.unroute('**/api/**')`
  // only removes that pattern's own handler, leaving this one (a different
  // pattern, `**/api/lists`) in place for Retry to actually recover into.
  await useHomeFixture(page)
  await page.route('**/api/**', (route) => route.abort())

  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'New list' })).toBeHidden()
  await expect(
    page.getByRole('heading', { name: 'Nothing tracked yet — pick a shelf and fill it' }),
  ).toBeHidden()
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible()

  await page.unroute('**/api/**')
  await page.getByRole('button', { name: 'Retry' }).click()

  await expect(page.getByText(FIXTURE_LIST_TITLE)).toBeVisible()
})

test('the fixture list renders its curated star and status mark, and a remembered update band, in a real browser', async ({
  page,
}) => {
  // The dev database's own row is a plain manual list with no status — a
  // canonical, complete-status list (this fixture) had never rendered its
  // star or status mark in an actual browser before this spec started using
  // it. The update band comes from what an earlier explicit check left in the
  // preferences store (10.22c): nothing here checks by itself, and what was
  // found must still be there after a fresh load.
  await page.addInitScript(
    ([id]) => {
      localStorage.setItem(
        'updates:pending',
        JSON.stringify({ [id!]: { count: 2, checkedAt: '2026-01-01T00:00:00.000Z' } }),
      )
    },
    [FIXTURE_LIST_ID],
  )
  await useHomeFixture(page)
  await page.goto('/')

  await expect(page.locator('.q-home-row', { hasText: FIXTURE_LIST_TITLE })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.locator('.q-star')).toBeVisible()
  await expect(page.locator('.q-status-mark')).toBeVisible()
  await expect(page.locator('.q-banner', { hasText: FIXTURE_LIST_TITLE })).toContainText('has 2 new items.')
})
