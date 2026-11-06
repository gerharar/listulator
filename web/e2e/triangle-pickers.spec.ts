import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { readInk } from './triangleInk.js'

/**
 * The pickers' arrows in a real browser (canvas H-027, 47.5): the stroked 13/14px chevrons of the facet dropdowns, the add form's platform picker and the
 * "I'm tired of going through" list picker are the 6 x 5 picker triangle, its ink's middle within 0.5px of the label's cap middle. (The tag choice has the
 * same layout as the platform picker and a unit test of its own.) Pixels are read at four times the display scale (`triangleInk.ts`). Real writes, removed in a `finally`.
 */
test.use({ deviceScaleFactor: 4, viewport: { width: 1200, height: 900 } })

async function makeList(request: APIRequestContext, title: string, mediaType: string, items: object[]) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return list.id as string
}

const sizeOf = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((node) => {
    const r = node.getBoundingClientRect()

    return [r.width, r.height]
  })

test('the platform facet and the add form’s platform picker end in the 6 x 5 triangle, on the label’s cap middle', async ({ page }) => {
  const title = `e2e triangle-pickers game ${Date.now()}`
  const id = await makeList(page.request, title, 'game', [
    { title: 'Assassin’s Creed', timeToConsumeMinutes: 900, tags: ['PS3'] },
    { title: 'Unity', timeToConsumeMinutes: 900, tags: ['PS4'] },
  ])

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.locator('.q-filterbar .q-facet-summary').first().waitFor()
    await page.waitForFunction(() => document.getAnimations().length === 0)

    expect(await sizeOf(page, '.q-facet-summary svg')).toEqual([6, 5])
    expect(Math.abs((await readInk(page, { row: '.q-facet-summary', triangle: 'svg', text: '.q-facet-summary-text' })).delta), 'facet').toBeLessThanOrEqual(0.5)

    expect(await sizeOf(page, '.q-add-plat svg')).toEqual([6, 5])
    expect(Math.abs((await readInk(page, { row: '.q-add-plat', triangle: 'svg', text: '.q-add-plat-value' })).delta), 'platform picker').toBeLessThanOrEqual(0.5)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the "I’m tired of going through" picker ends in the 6 x 5 triangle, on the label’s cap middle', async ({ page }) => {
  const stamp = Date.now()
  const ids = [
    await makeList(page.request, `e2e triangle-pickers tv ${stamp}`, 'tv', [{ title: 'One', timeToConsumeMinutes: 30 }]),
    await makeList(page.request, `e2e triangle-pickers tv2 ${stamp}`, 'tv', [{ title: 'Two', timeToConsumeMinutes: 30 }]),
  ]

  try {
    await page.goto('/')
    await page.getByRole('button', { name: "I'm Tired, Boss" }).click()
    await page.locator('.q-sheet .q-tired-target').waitFor()
    await page.waitForFunction(() => document.getAnimations().length === 0)

    expect(await sizeOf(page, '.q-tired-target svg')).toEqual([6, 5])
    expect(Math.abs((await readInk(page, { row: '.q-tired-target', triangle: 'svg', text: ':self', skip: 'svg' })).delta), 'tired').toBeLessThanOrEqual(0.5)
  } finally {
    for (const id of ids) await page.request.delete(`/api/lists/${id}`)
  }
})
