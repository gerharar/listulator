import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { settled } from './groupLineMarks.js'

/**
 * The box on a group head that marks the shown items done or not done (canvas H-026), in a real browser: where it sits against the item
 * boxes below it, how the dash is drawn, what it hit-tests as, and that a click marks the group without folding it. Real writes on the dev
 * server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  const items = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].map((name, n) => ({
    title: name,
    timeToConsumeMinutes: 30,
    group: n < 3 ? 'Season 1' : 'Season 2',
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

const groupBox = (page: Page, name: string) => page.locator('.q-group', { hasText: name }).getByRole('checkbox')
const itemBox = (page: Page, title: string) => page.locator('.q-item', { hasText: title }).getByRole('checkbox')

/** The drawn 19px square of a box (the button around it is the larger hit area). */
const square = async (box: ReturnType<typeof groupBox>) => (await box.locator('> span').boundingBox())!

for (const skin of ['dark-orange', 'light-bone']) {
  test(`${skin}: the group box is the item box's size, on its left edge, and its dash is a 9 x 3px bar at 4px and 7px`, async ({ page }) => {
    const title = `e2e group-done geometry ${skin} ${Date.now()}`
    const id = await makeList(page.request, title)

    try {
      await openList(page, title)
      await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), skin)
      await settled(page)

      const group = await square(groupBox(page, 'Season 1'))
      const item = await square(itemBox(page, 'Alpha'))
      expect(group.width).toBe(19)
      expect(group.height).toBe(19)
      expect(Math.abs(group.x - item.x)).toBeLessThanOrEqual(0.5)

      // The hit area is 28 x 26, the box centred in it.
      const hit = (await groupBox(page, 'Season 1').boundingBox())!
      expect([hit.width, hit.height]).toEqual([28, 26])
      expect(Math.abs(hit.x + (hit.width - 19) / 2 - group.x)).toBeLessThanOrEqual(0.5)

      // A dash: tick one episode of Season 1.
      await itemBox(page, 'Alpha').click()
      await expect(groupBox(page, 'Season 1')).toHaveAttribute('aria-checked', 'mixed')
      const dash = await groupBox(page, 'Season 1')
        .locator('> span')
        .evaluate((node) => {
          const style = getComputedStyle(node, '::after')
          return [style.left, style.top, style.width, style.height, style.position]
        })
      expect(dash).toEqual(['4px', '7px', '9px', '3px', 'absolute'])
      expect(await groupBox(page, 'Season 1').textContent()).toBe('')
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}

test('a click on the box marks the whole group done, and again not done, without folding it; Season 2 is untouched', async ({ page }) => {
  const title = `e2e group-done click ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await openList(page, title)

    await groupBox(page, 'Season 1').click()

    await expect(groupBox(page, 'Season 1')).toHaveAttribute('aria-checked', 'true')
    for (const name of ['Alpha', 'Beta', 'Gamma']) await expect(itemBox(page, name)).toHaveAttribute('aria-checked', 'true')
    await expect(groupBox(page, 'Season 2')).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('.q-group', { hasText: 'Season 1' })).toHaveAttribute('aria-expanded', 'true')

    // It reached the server: a reload agrees.
    await page.reload()
    await openList(page, title)
    await expect(groupBox(page, 'Season 1')).toHaveAttribute('aria-checked', 'true')

    await groupBox(page, 'Season 1').click()
    await expect(groupBox(page, 'Season 1')).toHaveAttribute('aria-checked', 'false')
    for (const name of ['Alpha', 'Beta', 'Gamma']) await expect(itemBox(page, name)).toHaveAttribute('aria-checked', 'false')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('Space on the focused box marks the group and does not fold it; a click on the folded group\'s box marks it and keeps it folded', async ({ page }) => {
  const title = `e2e group-done keys ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await openList(page, title)

    await groupBox(page, 'Season 2').focus()
    await page.keyboard.press('Space')
    await expect(groupBox(page, 'Season 2')).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.q-group', { hasText: 'Season 2' })).toHaveAttribute('aria-expanded', 'true')

    await page.locator('.q-group', { hasText: 'Season 1' }).getByText('Season 1').click()
    await expect(page.locator('.q-group', { hasText: 'Season 1' })).toHaveAttribute('aria-expanded', 'false')
    await groupBox(page, 'Season 1').click()
    await expect(groupBox(page, 'Season 1')).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.q-group', { hasText: 'Season 1' })).toHaveAttribute('aria-expanded', 'false')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
