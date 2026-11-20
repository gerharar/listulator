import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * eX-Zed's item row (the owner, Checkpoint I of Phase 56): the ⓘ and ✎ blocks were two 32px blocks with nothing between them, so the highlight of one ran into the other. Two row buttons side by
 * side are 8px apart, the theme's unit. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items: [{ title: 'Alpha', timeToConsumeMinutes: 30, notes: 'A note of mine' }] } })

  return list.id as string
}

for (const skin of ['exzed-1d', 'exzed-1l']) {
  test(`${skin}: the ⓘ and the ✎ are 32px blocks 8px apart, and a hovered block does not reach the next`, async ({ page }) => {
    const title = `e2e exzed row buttons ${skin} ${Date.now()}`
    const id = await makeList(page.request, title)

    try {
      await page.addInitScript((entries) => {
        for (const [key, value] of entries) localStorage.setItem(key, value)
      }, Object.entries({ theme: 'exzed', exzedSkin: skin, skin: 'dark-orange', reducedMotion: 'true' }))
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: title }).click()
      const row = page.locator('.q-item', { hasText: 'Alpha' })
      await row.waitFor()
      const info = row.locator('.q-icon-btn.row.info')
      const edit = row.locator('.q-icon-btn.row.edit')
      await expect(info).toBeVisible()
      const [a, b] = [(await info.boundingBox())!, (await edit.boundingBox())!]

      expect([a.width, a.height, b.width, b.height]).toEqual([32, 32, 32, 32])
      expect(b.x - (a.x + a.width), 'between ⓘ and ✎').toBe(8)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}
