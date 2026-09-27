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
// The bar's own facets, not the hidden copy it measures (U4).
const facets = (page: Page) => facetBar(page).locator(':scope > .q-facet')
const rows = (page: Page) => page.locator('.q-item .title')

// The fixture keeps old tags (PC, NDS): they read as today's codes, WIN and DS (10.24c).
test('Games get a Platform facet; it filters additively and keeps the order', async ({ page }) => {
  const title = `e2e list-filter games ${Date.now()}`
  const id = await makeList(page.request, title, 'game', GAMES)

  try {
    await openList(page, title)
    await expect(facets(page).locator('button')).toHaveText(['All', 'DS', 'PS3', 'PSP', 'WIN', 'X360', 'MULTI', 'Untagged'])
    await expect(facetBar(page).getByText('6 items')).toBeVisible()
    await page.screenshot({ path: 'test-results/filter-bar-games.png' })

    await facetBar(page).getByRole('button', { name: 'DS', exact: true }).click()
    await expect(rows(page)).toHaveText(['Altaïr’s Chronicles'])
    await expect(facetBar(page).getByText('1 of 6 shown')).toBeVisible()

    await facetBar(page).getByRole('button', { name: 'WIN' }).click()
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
    await expect(facets(page)).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the platform chip opens a popover at least 240px wide with each full name on one line, never toggles the row, and Esc closes it', async ({ page }) => {
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
    expect((await page.locator('.q-pop.wfit').boundingBox())!.width).toBeGreaterThanOrEqual(239)
    // Content-wide (owner, 2026-09-27): no platform name wraps.
    for (const name of await card.locator('.name').all()) {
      const box = (await name.boundingBox())!
      const line = parseFloat(await name.evaluate((el) => getComputedStyle(el).lineHeight))
      expect(box.height).toBeLessThan(line * 1.5)
    }
    await page.screenshot({ path: 'test-results/platform-popover.png' })
    // The tail's fill sits exactly inside its outline (the fill is placed inside the
    // tail, whose 9px top border it must climb back over), wherever the tail points.
    const tail = page.locator('.q-pop-tail')
    expect(await tail.evaluate((el) => getComputedStyle(el, '::before').top)).toBe('-9px')
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

test('many platforms: the facet becomes a dropdown so the bar stays one row; a wider bar brings the chips back (U4)', async ({ page }) => {
  const title = `e2e list-filter wrap ${Date.now()}`
  const codes = ['AND', 'CELL', 'DS', 'IOS', 'MAC', 'NSW', 'NSW2', 'PS3', 'PS4', 'PS5', 'PSP', 'VITA', 'VR', 'WIIU', 'WIN', 'WINP', 'X360', 'XONE', 'XSX']
  const id = await makeList(page.request, title, 'game', [
    { title: 'Prologue', timeToConsumeMinutes: 60 },
    ...codes.map((code) => ({ title: `On ${code}`, timeToConsumeMinutes: 60, group: 'Main', tags: [code] })),
    { title: 'Epilogue', timeToConsumeMinutes: 60, group: 'Other' },
  ])

  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openList(page, title)

    // One row: the text field, the dropdown, fold-all and the note share a line.
    const summary = facetBar(page).getByRole('button', { name: 'Platform: All' })
    await expect(summary).toBeVisible()
    await expect(facets(page).locator('.q-facet-seg')).toHaveCount(0)
    const tops = await Promise.all(
      ['.q-filter-input', '.q-facet-summary', '.q-fold', '.q-filter-note'].map(
        async (part) => (await facetBar(page).locator(`:scope > ${part}, :scope > .q-facet > ${part}`).boundingBox())!,
      ),
    )
    const middles = tops.map((box) => box.y + box.height / 2)
    expect(Math.max(...middles) - Math.min(...middles)).toBeLessThan(4)

    // The chips live in the popover; picking keeps it open and the button names the picks.
    await summary.click()
    const pop = page.getByRole('dialog')
    await expect(pop.getByText('Platform · 20')).toBeVisible()
    // Below the button, from its left edge, pointing up at it (owner): the button grows as
    // platforms are picked, and a popover beside it would be pushed along.
    const button = (await summary.boundingBox())!
    const before = (await pop.boundingBox())!
    expect(before.y).toBeGreaterThan(button.y + button.height)
    expect(Math.abs(before.x - button.x)).toBeLessThan(2)
    await expect(pop.locator('.q-pop-tail')).toHaveClass(/\bup\b/)
    await pop.getByRole('button', { name: 'WIN', exact: true }).click()
    await pop.getByRole('button', { name: 'PS4', exact: true }).click()
    await pop.getByRole('button', { name: 'X360', exact: true }).click()
    await expect(facetBar(page).getByRole('button', { name: 'Platform: PS4, WIN, X360' })).toBeVisible()
    const after = (await pop.boundingBox())!
    expect([after.x, after.y]).toEqual([before.x, before.y])
    await pop.getByRole('button', { name: 'X360', exact: true }).click()
    await expect(pop).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('u4-open.png') })
    await page.keyboard.press('Escape')
    await expect(pop).toBeHidden()

    const picked = facetBar(page).getByRole('button', { name: 'Platform: PS4, WIN' })
    await expect(picked).toHaveAttribute('data-on', 'true')
    await expect(picked).toHaveAttribute('title', 'PlayStation 4, Windows')
    await expect(rows(page)).toHaveText(['On PS4', 'On WIN'])
    await page.screenshot({ path: test.info().outputPath('u4-picked.png') })

    // The list card has a maximum width, so twenty chips never fit; a short list shows
    // the switch both ways: a narrow window turns its chips into the dropdown, a wide one
    // brings them back, the picks intact.
    const small = await makeList(page.request, `${title} small`, 'game', GAMES)
    try {
      await openList(page, `${title} small`)
      await expect(facets(page).locator('.q-facet-seg')).toHaveCount(1)
      await facets(page).getByRole('button', { name: 'PS3', exact: true }).click()
      await page.setViewportSize({ width: 800, height: 900 })
      await expect(facetBar(page).getByRole('button', { name: 'Platform: PS3' })).toBeVisible()
      await page.setViewportSize({ width: 1440, height: 900 })
      await expect(facets(page).getByRole('button', { name: 'PS3', exact: true })).toHaveAttribute('aria-pressed', 'true')
    } finally {
      await page.request.delete(`/api/lists/${small}`)
    }
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
