import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Just One Fix (task 10.28) in a real browser: the shortest unconsumed item anywhere,
 * each list offered once by its own shortest, consumed items ignored. Real writes,
 * removed in a `finally`. The two engines share a database, so the test walks its own
 * lists with Not That and compares order rather than assuming what is on top.
 */
async function makeList(request: APIRequestContext, title: string, minutes: number[], done = 0) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'manual', items: minutes.map((m, i) => ({ title: `${title} #${i + 1}`, timeToConsumeMinutes: m })) },
  })
  const items = (await (await request.get(`/api/lists/${list.id}`)).json()).items as { id: string; orderIndex: number }[]
  for (const item of items.filter((entry) => entry.orderIndex < done)) {
    await request.put(`/api/lists/${list.id}/items/${item.id}/consumed`, { data: { consumed: true } })
  }

  return list.id as string
}

const stamp = Date.now()
const A = `e2e fix a ${stamp}`
const B = `e2e fix b ${stamp}`
const C = `e2e fix c ${stamp}`

test('offers shortest first, each list by its own shortest item, and ignores what is done', async ({ page }) => {
  const ids = [
    // A's 2-minute first item is consumed, so A's shortest left is its 45.
    await makeList(page.request, A, [2, 90, 45], 1),
    await makeList(page.request, B, [7, 60]),
    await makeList(page.request, C, [20, 25]),
  ]

  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Just One Fix' }).click()
    const sheet = page.locator('.q-sheet')
    await expect(sheet).toContainText('A quick dopamine hit from the shortest unfinished thing you track')
    await expect(page.getByRole('button', { name: 'Just One Fix' })).toHaveAttribute('aria-pressed', 'true')
    await expect(sheet.locator('.q-pick')).toBeVisible()

    const order: string[] = []
    const items: Record<string, string> = {}
    for (let i = 0; i < 60 && order.length < 3; i += 1) {
      const list = (await sheet.locator('.q-pick-list').textContent()) ?? ''
      const item = (await sheet.locator('.q-pick-item').textContent()) ?? ''
      for (const title of [A, B, C]) {
        if (list.includes(title) && !order.includes(title)) {
          order.push(title)
          items[title] = item
        }
      }
      if (order.length < 3) await sheet.getByRole('button', { name: 'Not That' }).click()
    }

    expect(order).toEqual([B, C, A])
    expect(items[B]).toBe(`${B} #1`)
    expect(items[C]).toBe(`${C} #1`)
    expect(items[A]).toBe(`${A} #3`)
  } finally {
    for (const id of ids) await page.request.delete(`/api/lists/${id}`)
  }
})

test('the pick says how long it takes, and Open The List opens its list', async ({ page }) => {
  const ids = [await makeList(page.request, B, [7, 60])]

  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Just One Fix' }).click()
    const sheet = page.locator('.q-sheet')
    await expect(sheet.locator('.q-pick')).toBeVisible()

    for (let i = 0; i < 60; i += 1) {
      if (((await sheet.locator('.q-pick-list').textContent()) ?? '').includes(B)) break
      await sheet.getByRole('button', { name: 'Not That' }).click()
    }
    await expect(sheet.locator('.q-pick-list')).toContainText(`${B} · 7m`)
    await expect(sheet.locator('.q-pick-why')).toHaveText('Shortest unfinished item you have — 7m and it is done.')
    await page.screenshot({ path: 'test-results/just-one-fix.png' })

    await sheet.getByRole('button', { name: 'Open The List' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.locator('.q-list-title')).toContainText(B)
  } finally {
    for (const id of ids) await page.request.delete(`/api/lists/${id}`)
  }
})
