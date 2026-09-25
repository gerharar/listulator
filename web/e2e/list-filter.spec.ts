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

test('the platform chip opens a 240px popover with full names, never toggles the row, and Esc closes it', async ({ page }) => {
  const title = `e2e list-filter chip ${Date.now()}`
  const id = await makeList(page.request, title, 'game', GAMES)

  try {
    await openList(page, title)
    const row = page.locator('.q-item', { hasText: 'Assassin’s Creed II' })
    await expect(row.locator('.q-plat')).toHaveText('MULTI')

    await row.locator('.q-plat').click()
    const card = page.locator('.q-platcard')
    await expect(card).toContainText('Platforms · 3')
    await expect(card).toContainText('Xbox 360')
    expect((await page.locator('.q-pop.w240').boundingBox())!.width).toBeCloseTo(240, -1)
    await page.screenshot({ path: 'test-results/platform-popover.png' })
    await expect(row).not.toHaveClass(/is-done/)

    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
    // Esc closed the popover only: the list layer is still open.
    await expect(row).toBeVisible()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the jump rail brings a far group to the top, and stays folded across a reload', async ({ page }) => {
  const title = `e2e list-filter rail ${Date.now()}`
  const many = (group: string) =>
    Array.from({ length: 14 }, (_, i) => ({ title: `${group} ep ${i + 1}`, timeToConsumeMinutes: 30, group }))
  const id = await makeList(page.request, title, 'tv', [...many('Season 1'), ...many('Season 2'), ...many('Season 3')])

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    const rail = page.locator('.q-rail')
    await expect(rail.getByRole('button', { name: /Season 3/ })).toBeVisible()
    await page.screenshot({ path: 'test-results/jump-rail.png' })

    await rail.getByRole('button', { name: /Season 3/ }).click()
    const body = page.locator('.q-list-body')
    await expect
      .poll(async () => {
        const group = (await page.locator('.q-group', { hasText: 'Season 3' }).boundingBox())!
        const top = (await body.boundingBox())!
        return Math.abs(group.y - top.y)
      })
      .toBeLessThan(3)

    await rail.getByRole('button', { name: 'Collapse the jump rail' }).click()
    await expect(rail).toHaveCount(0)
    await page.reload()
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.locator('.q-rail-stub')).toBeVisible()
    await expect(page.locator('.q-rail')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a game on two dozen platforms keeps its facet row inside the bar (the buttons wrap)', async ({ page }) => {
  const title = `e2e list-filter wrap ${Date.now()}`
  const tags = Array.from({ length: 25 }, (_, i) => `PLAT${i + 1}`)
  const id = await makeList(page.request, title, 'game', [
    { title: 'Everywhere', timeToConsumeMinutes: 60, tags },
    { title: 'Prologue', timeToConsumeMinutes: 60 },
  ])

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.locator('.q-item', { hasText: 'Everywhere' })).toBeVisible()

    await expect(facetBar(page).locator('.q-facet button')).toHaveCount(1 + 25 + 1)
    const bar = (await facetBar(page).boundingBox())!
    const run = (await facetBar(page).locator('.q-facet-seg').boundingBox())!
    expect(run.x + run.width).toBeLessThanOrEqual(bar.x + bar.width + 4)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
