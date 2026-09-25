import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Finalizer (task 10.27) in a real browser: a complete list at 80% is offered before
 * an ongoing one at 94%, the sheet opens straight away, and one helper sheet replaces
 * another. Real writes, removed in a `finally`. The two engines share a database, so the
 * test walks its own lists with Not That rather than assuming what is on top.
 */
async function makeList(request: APIRequestContext, title: string, status: 'complete' | 'ongoing', total: number, done: number) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv', status } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'manual', items: Array.from({ length: total }, (_, i) => ({ title: `${title} #${i + 1}`, timeToConsumeMinutes: 30 })) },
  })
  const items = (await (await request.get(`/api/lists/${list.id}`)).json()).items as { id: string }[]
  for (const item of items.slice(0, done)) {
    await request.put(`/api/lists/${list.id}/items/${item.id}/consumed`, { data: { consumed: true } })
  }

  return list.id as string
}

const stamp = Date.now()
const COMPLETE = `e2e fin complete ${stamp}`
const ONGOING = `e2e fin ongoing ${stamp}`

const button = (page: Page, name: string) => page.getByRole('button', { name })
const sheet = (page: Page) => page.locator('.q-sheet')

test('offers the complete list before the ongoing one, however far along the ongoing one is', async ({ page }) => {
  const ids = [await makeList(page.request, COMPLETE, 'complete', 5, 4), await makeList(page.request, ONGOING, 'ongoing', 16, 15)]

  try {
    await page.goto('/')
    await button(page, 'Finalizer').click()
    await expect(sheet(page)).toContainText('Finish Him!')
    await expect(button(page, 'Finalizer')).toHaveAttribute('aria-pressed', 'true')
    await expect(sheet(page).locator('.q-pick')).toBeVisible()
    await expect(sheet(page).locator('.q-tired-target')).toHaveCount(0)

    // Walk the picks (each turned down in turn) and note when this run's two lists come up.
    const order: string[] = []
    for (let i = 0; i < 60 && order.length < 2; i += 1) {
      const top = (await sheet(page).locator('.q-pick-list').textContent()) ?? ''
      for (const title of [COMPLETE, ONGOING]) if (top.includes(title) && !order.includes(title)) order.push(title)
      if (top.includes(ONGOING)) {
        await expect(sheet(page).locator('.q-pick-why')).toContainText('Marked ongoing')
      }
      if (top.includes(COMPLETE)) {
        await expect(sheet(page).locator('.q-pick-why')).toContainText('The list is complete')
      }
      if (order.length < 2) await button(page, 'Not That').click()
    }
    expect(order).toEqual([COMPLETE, ONGOING])
  } finally {
    for (const id of ids) await page.request.delete(`/api/lists/${id}`)
  }
})

test('one helper sheet replaces another, the lit button follows, and Open The List opens the list', async ({ page }) => {
  const ids = [await makeList(page.request, COMPLETE, 'complete', 5, 4)]

  try {
    await page.goto('/')
    await button(page, 'Finalizer').click()
    await expect(sheet(page)).toContainText('Finish Him!')

    await button(page, "I'm Tired, Boss").click()
    await expect(sheet(page)).toContainText('And Now For Something Completely Different')
    await expect(sheet(page)).toHaveCount(1)
    await expect(button(page, "I'm Tired, Boss")).toHaveAttribute('aria-pressed', 'true')
    await expect(button(page, 'Finalizer')).toHaveAttribute('aria-pressed', 'false')

    await button(page, 'Finalizer').click()
    await expect(sheet(page)).toContainText('Finish Him!')
    await expect(sheet(page).locator('.q-pick')).toBeVisible()
    await page.screenshot({ path: 'test-results/finalizer.png' })

    // Open The List opens whichever list is on top; the layer that appears is a list, not an error.
    await sheet(page).getByRole('button', { name: 'Open The List' }).click()
    await expect(sheet(page)).toHaveCount(0)
    await expect(page.locator('.q-list-title, .q-list-progress, .q-list-body').first()).toBeVisible()
  } finally {
    for (const id of ids) await page.request.delete(`/api/lists/${id}`)
  }
})
