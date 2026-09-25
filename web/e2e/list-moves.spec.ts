import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Moving rows (task 10.23) in a real browser against the dev server: Shift+↑↓
 * and dragging by the handle save the same order, Undo puts it back, focus
 * stays on the row that moved, and a long list scrolls itself while a row is
 * carried to the far end. Real writes, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string, items: object[]) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return list.id as string
}

const order = async (request: APIRequestContext, id: string) =>
  ((await (await request.get(`/api/lists/${id}`)).json()).items as { title: string; orderIndex: number }[])
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((i) => i.title)

const SMALL = [
  { title: 'Alpha', timeToConsumeMinutes: 30 },
  { title: 'S1 one', timeToConsumeMinutes: 30, group: 'Season 1' },
  { title: 'S1 two', timeToConsumeMinutes: 30, group: 'Season 1' },
  { title: 'S1 three', timeToConsumeMinutes: 30, group: 'Season 1' },
  { title: 'Bravo', timeToConsumeMinutes: 30 },
]

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await expect(page.locator('.q-item', { hasText: 'Alpha' })).toBeVisible()
  // The layer drums in first: measure rows only once it has stopped moving, or a drag aims at where they were.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  )
}

const rowOf = (page: Page, text: string) => page.locator('.q-item', { hasText: text }).first()

test('Shift+↓ moves a row, focus stays on it, and one toast covers the run', async ({ page }) => {
  const title = `e2e list-moves kb ${Date.now()}`
  const id = await makeList(page.request, title, SMALL)

  try {
    await openList(page, title)
    await rowOf(page, 'Alpha').focus()

    await page.keyboard.press('Shift+ArrowDown')
    await expect.poll(() => order(page.request, id)).toEqual(['S1 one', 'S1 two', 'S1 three', 'Alpha', 'Bravo'])
    await expect(rowOf(page, 'Alpha')).toBeFocused()

    await page.keyboard.press('Shift+ArrowDown')
    await expect.poll(() => order(page.request, id)).toEqual(['S1 one', 'S1 two', 'S1 three', 'Bravo', 'Alpha'])
    await expect(rowOf(page, 'Alpha')).toBeFocused()

    // A pause ends the run: one toast, and its Undo puts Alpha back where it started.
    await expect(page.locator('.q-toast')).toContainText('Moved 2 rows.', { timeout: 5000 })
    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => order(page.request, id)).toEqual(['Alpha', 'S1 one', 'S1 two', 'S1 three', 'Bravo'])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('dragging by the handle saves what the keyboard saves, and Undo puts it back', async ({ page }) => {
  const title = `e2e list-moves drag ${Date.now()}`
  const id = await makeList(page.request, title, SMALL)

  try {
    await openList(page, title)
    const handle = rowOf(page, 'S1 one').locator('.q-handle')
    const target = rowOf(page, 'S1 two')
    const from = (await handle.boundingBox())!
    const to = (await target.boundingBox())!

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 10, from.y + 30, { steps: 4 })
    // The drop line shows where it would land.
    await page.mouse.move(to.x + 100, to.y + to.height - 6, { steps: 6 })
    await expect(target.locator('.q-dropline.after')).toBeVisible()
    await page.mouse.up()

    await expect.poll(() => order(page.request, id)).toEqual(['Alpha', 'S1 two', 'S1 one', 'S1 three', 'Bravo'])
    await expect(page.locator('.q-toast')).toContainText('Moved inside Season 1.')

    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => order(page.request, id)).toEqual(['Alpha', 'S1 one', 'S1 two', 'S1 three', 'Bravo'])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a group is dragged as a block, and every group shuts while it is carried', async ({ page }) => {
  const title = `e2e list-moves group ${Date.now()}`
  const id = await makeList(page.request, title, SMALL)

  try {
    await openList(page, title)
    const handle = page.locator('.q-group', { hasText: 'Season 1' }).locator('.q-handle')
    const bravo = rowOf(page, 'Bravo')
    const from = (await handle.boundingBox())!

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 10, from.y + 40, { steps: 4 })
    await expect(page.locator('.q-item', { hasText: 'S1 two' })).toBeHidden()
    const to = (await bravo.boundingBox())!
    await page.mouse.move(to.x + 100, to.y + to.height - 6, { steps: 6 })
    await page.mouse.up()

    await expect.poll(() => order(page.request, id)).toEqual(['Alpha', 'Bravo', 'S1 one', 'S1 two', 'S1 three'])
    // The group opens again where it landed.
    await expect(page.locator('.q-item', { hasText: 'S1 two' })).toBeVisible()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a long list scrolls itself while a row is carried toward its far end', async ({ page }) => {
  const title = `e2e list-moves long ${Date.now()}`
  const items = Array.from({ length: 60 }, (_, i) => ({ title: `Row ${String(i + 1).padStart(2, '0')}`, timeToConsumeMinutes: 10 }))
  const id = await makeList(page.request, title, items)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(rowOf(page, 'Row 01')).toBeVisible()
    const handle = rowOf(page, 'Row 01').locator('.q-handle')
    const from = (await handle.boundingBox())!
    const viewport = page.viewportSize()!

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 10, from.y + 30, { steps: 4 })
    // Hold near the bottom edge of the window: the list must scroll under the pointer.
    await page.mouse.move(from.x + 100, viewport.height - 6, { steps: 8 })
    await page.waitForTimeout(2500)
    const last = rowOf(page, 'Row 60')
    await expect(last).toBeInViewport()
    const to = (await last.boundingBox())!
    await page.mouse.move(to.x + 100, to.y + to.height - 4, { steps: 6 })
    await page.mouse.up()

    await expect.poll(async () => (await order(page.request, id)).at(-1)).toBe('Row 01')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
