import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The filter bar (task 10.24) in a real browser against the dev server: a text
 * field, and the facets the category's convention derives from the items' tags
 * (Games: Platform). Real writes, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string, mediaType: string, items: object[]) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return list.id as string
}

const GAMES = [
  { title: 'Prologue', timeToConsumeMinutes: 60 },
  { title: 'Assassin’s Creed', timeToConsumeMinutes: 900, group: 'Main', tags: ['PS3', 'X360', 'PC'] },
  { title: 'Assassin’s Creed II', timeToConsumeMinutes: 1200, group: 'Main', tags: ['PS3', 'X360', 'PC'] },
  { title: 'Revelations', timeToConsumeMinutes: 900, group: 'Main', tags: ['multi'] },
  { title: 'Altaïr’s Chronicles', timeToConsumeMinutes: 360, group: 'Handhelds', tags: ['NDS'] },
  { title: 'Bloodlines', timeToConsumeMinutes: 360, group: 'Handhelds', tags: ['PSP'] },
]

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await expect(page.locator('.q-item', { hasText: 'Prologue' })).toBeVisible()
}

const facetBar = (page: Page) => page.locator('.q-filterbar')
const rows = (page: Page) => page.locator('.q-item .title')

test('Games get a Platform facet; it filters additively and keeps the order', async ({ page }) => {
  const title = `e2e list-filter games ${Date.now()}`
  const id = await makeList(page.request, title, 'game', GAMES)

  try {
    await openList(page, title)
    await expect(facetBar(page).locator('.q-facet button')).toHaveText(['All', 'PS3', 'PSP', 'X360', 'NDS', 'PC', 'MULTI', 'Untagged'])
    await expect(facetBar(page).getByText('6 items')).toBeVisible()
    await page.screenshot({ path: 'test-results/filter-bar-games.png' })

    await facetBar(page).getByRole('button', { name: 'NDS' }).click()
    await expect(rows(page)).toHaveText(['Altaïr’s Chronicles'])
    await expect(facetBar(page).getByText('1 of 6 shown')).toBeVisible()

    await facetBar(page).getByRole('button', { name: 'PC' }).click()
    await expect(rows(page)).toHaveText(['Assassin’s Creed', 'Assassin’s Creed II', 'Altaïr’s Chronicles'])

    await facetBar(page).getByRole('button', { name: 'All', exact: true }).click()
    await expect(rows(page)).toHaveCount(6)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the text filter narrows a group’s rows and shows its own count', async ({ page }) => {
  const title = `e2e list-filter text ${Date.now()}`
  const id = await makeList(page.request, title, 'game', GAMES)

  try {
    await openList(page, title)
    await page.getByPlaceholder('Filter items…').fill('assassin')

    await expect(rows(page)).toHaveText(['Assassin’s Creed', 'Assassin’s Creed II'])
    await expect(page.locator('.q-group', { hasText: 'Main' })).toContainText('2 of 3')
    await expect(page.locator('.q-group', { hasText: 'Handhelds' })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/filter-bar-text.png' })

    await page.getByPlaceholder('Filter items…').fill('zzz')
    await expect(page.getByText('Nothing matches “zzz”.')).toBeVisible()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a category with no convention gets the text field and no facets', async ({ page }) => {
  const title = `e2e list-filter tv ${Date.now()}`
  const id = await makeList(page.request, title, 'tv', GAMES)

  try {
    await openList(page, title)
    await expect(facetBar(page).getByPlaceholder('Filter items…')).toBeVisible()
    await expect(facetBar(page).locator('.q-facet')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
