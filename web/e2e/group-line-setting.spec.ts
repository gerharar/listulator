import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { q } from './fixtures.js'
import { expectSixPixels, marks, settled } from './groupLineMarks.js'

/**
 * The group triangle's line as a setting (canvas H-022, owner 2026-10-28, 38.8), in a real browser: Settings → Screen has the box "Mark open and
 * closed groups"; ticking it draws the line on every group head of the lists and the Preview that are already open, at once, with no reload,
 * 6px from the ink as `group-line.spec.ts` measures it; unticking returns today's glyph; the choice survives a restart (a reload here; the desktop
 * keeps it in `preferences.json`). Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string, groups = 2, perGroup = 3) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  const items = Array.from({ length: groups * perGroup }, (_, n) => ({
    title: `Entry ${n}`,
    timeToConsumeMinutes: 30,
    group: `Group ${Math.floor(n / perGroup) + 1}`,
  }))
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return list.id as string
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-group').first().waitFor()
  await settled(page)
}

const box = (page: Page) => page.getByRole('checkbox', { name: q.settings.markOpenGroups })

async function openSettings(page: Page) {
  await page.getByRole('button', { name: q.settings.title, exact: true }).click()
  await expect(page.getByRole('heading', { name: q.settings.title })).toBeVisible()
}

async function closeSettings(page: Page) {
  await page.locator('.q-settings').getByRole('button', { name: q.settings.closeLabel, exact: true }).click()
  await expect(page.getByRole('heading', { name: q.settings.title })).toHaveCount(0)
  await settled(page)
}

const glyphs = (page: Page, head: string) => page.locator(`${head} .q-chev`)
const lines = (page: Page, head: string) => page.locator(`${head} .q-chev-line`)

test('ticking the box in Settings draws the line on the open list at once, and unticking returns the glyph', async ({ page }) => {
  const title = `e2e group-line-setting list ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await openList(page, title)
    await expect(glyphs(page, '.q-group')).toHaveCount(2)
    await expect(lines(page, '.q-group')).toHaveCount(0)

    await openSettings(page)
    await box(page).check()
    // Still in Settings: the list under it has already changed, no reload, no reopening.
    await expect(lines(page, '.q-group')).toHaveCount(2)
    await closeSettings(page)
    expectSixPixels(await marks(page, '.q-group'), [true, true])

    await page.locator('.q-group', { hasText: 'Group 1' }).click()
    await settled(page)
    expectSixPixels(await marks(page, '.q-group'), [false, true])

    await openSettings(page)
    await box(page).uncheck()
    await expect(glyphs(page, '.q-group')).toHaveCount(2)
    await expect(lines(page, '.q-group')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the Preview’s group heads follow the box too', async ({ page }) => {
  const items = Array.from({ length: 8 }, (_, n) => ({ title: `Episode ${n}`, externalRef: `setting:${n}`, timeToConsumeMinutes: 30, group: `Volume ${Math.floor(n / 4)}` }))
  await page.route('**/api/media-types/music/search**', (route) =>
    route.fulfill({ json: { sources: [{ externalRef: 'setting-1', title: 'Setting source', detail: 'Group · XX', itemCount: 8 }] } }),
  )
  await page.route('**/api/media-types/music/expansion**', (route) =>
    route.fulfill({ json: route.request().url().includes('items=true') ? { itemCount: 8, status: 'complete', items } : { itemCount: 8 } }),
  )

  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: 'Music' }).click()
  await page.getByLabel('Search MusicBrainz or List Vault', { exact: true }).fill('setting')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('.q-result').first().waitFor()
  await settled(page)
  await page.locator('.q-result').first().click()
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
  await page.locator('.q-preview-group').first().waitFor()
  await settled(page)
  await expect(glyphs(page, '.q-preview-group')).toHaveCount(2)

  await openSettings(page)
  await box(page).check()
  await expect(lines(page, '.q-preview-group')).toHaveCount(2)
  await closeSettings(page)
  expectSixPixels(await marks(page, '.q-preview-group'), [true, true])

  await page.locator('.q-preview-group', { hasText: 'Volume 0' }).click()
  await settled(page)
  expectSixPixels(await marks(page, '.q-preview-group'), [false, true])
})

test('the choice survives a restart, and Collapse All lays every line under its triangle', async ({ page }) => {
  const title = `e2e group-line-setting restart ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await openSettings(page)
    await expect(box(page)).not.toBeChecked()
    await box(page).check()
    await closeSettings(page)

    await openList(page, title)
    await expect(lines(page, '.q-group')).toHaveCount(2)
    await page.locator('.q-fold').click()
    await settled(page)
    expectSixPixels(await marks(page, '.q-group'), [false, false])

    // A restart: the page loads again and the box is still ticked, the heads still draw the line.
    await page.reload()
    await openSettings(page)
    await expect(box(page)).toBeChecked()
    await closeSettings(page)
    await openList(page, title)
    await expect(lines(page, '.q-group')).toHaveCount(2)

    await openSettings(page)
    await box(page).uncheck()
    await closeSettings(page)
    await page.reload()
    await openList(page, title)
    await expect(glyphs(page, '.q-group')).toHaveCount(2)
    await expect(lines(page, '.q-group')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('on a long list the heads in view follow the box, and so do the ones scrolled to afterwards', async ({ page }) => {
  const title = `e2e group-line-setting long ${Date.now()}`
  const id = await makeList(page.request, title, 150, 2)

  try {
    await page.setViewportSize({ width: 1440, height: 800 })
    await openList(page, title)
    await expect(lines(page, '.q-group')).toHaveCount(0)

    await openSettings(page)
    await box(page).check()
    await closeSettings(page)
    const inView = await marks(page, '.q-group')
    expect(inView.length).toBeGreaterThan(5)
    expectSixPixels(inView, inView.map((mark) => mark.open))

    // Rows drawn only now, far down the list, come out the same way: the state is the provider's, not the row's.
    await page.getByRole('button', { name: q.list.ends.toBottom }).click()
    await expect(page.locator('.q-group', { hasText: 'Group 150' })).toBeVisible()
    await settled(page)
    const atEnd = await marks(page, '.q-group')
    expect(atEnd.length).toBeGreaterThan(0)
    expect(await glyphs(page, '.q-group').count()).toBe(0)
    expectSixPixels(atEnd, atEnd.map((mark) => mark.open))
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
