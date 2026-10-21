import { expect, test } from '@playwright/test'
import { chooseGerman, closeAbout, createFirstList, openAbout, t } from '../e2e-desktop/steps.js'

/**
 * A rehearsal of the Windows update test's steps (Phase 31, task 31.7) in the ordinary browser suite: first list, German, About. The real
 * test drives the installed desktop app (`e2e-desktop/update.spec.ts`); here a changed label fails in the normal run instead. A browser has no
 * updater, so About says so; what is rehearsed is that the steps find their controls.
 */
test('the steps of the update test find their controls: first list, German, About', async ({ page }) => {
  await page.route('**/api/lists', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.continue()))
  await page.goto('/')

  const title = `e2e update steps ${Date.now()}`
  await createFirstList(page, title, ['One', 'Two', 'Three'])
  await page.unroute('**/api/lists')

  try {
    await chooseGerman(page)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await openAbout(page)
    await expect(page.locator('.q-about-update-text')).toContainText(t.about.version)
    await closeAbout(page)
  } finally {
    const all: { id: string; title: string }[] = await (await page.request.get('/api/lists')).json()
    const id = all.find((entry) => entry.title === title)?.id
    if (id !== undefined) await page.request.delete(`/api/lists/${id}`)
  }
})
