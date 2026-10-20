import { expect, test } from '@playwright/test'

/**
 * Most specs start at Home (`page.goto('/')`) against the real dev server, and Home only shows when the server's database holds at
 * least one list: with none, a fresh install boots into the Category picker (first-run.spec.ts). On the owner's Mac the database
 * has lists from earlier runs, which is why these specs passed there; on a fresh checkout (CI, a new clone) it is empty and they
 * all timed out waiting for Home. This runs first, as a project the browser projects depend on, and adds one list only when there
 * is none, so a database that already has lists is left exactly as it is (Phase 31, task 31.1).
 */
test('the server has a list, so Home shows', async ({ request }) => {
  const lists = (await (await request.get('/api/lists')).json()) as unknown[]
  if (lists.length > 0) return

  const created = await request.post('/api/lists', { data: { title: 'e2e home list', mediaType: 'movie' } })

  expect(created.ok()).toBe(true)
})
