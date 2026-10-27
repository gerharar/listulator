import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The split Up / Down button in the list's toolbar (H-019, task 32.4), in a real browser: it is as tall as Collapse and sits right after it,
 * only a list taller than two screens has it, each half takes the reader to an end with focus on the first or last row, and a half is
 * disabled at its end. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string, count: number) {
  const rows = Array.from({ length: count }, (_, n) => `  - { title: "Issue ${n}", minutes: 30, group: "Part ${n < count / 2 ? 1 : 2}" }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
  // The layer drums in over 380ms, scaled: measure after that, never during it.
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

/** The row that has focus: an item, or a group's header (the first row of this list). */
const focusedTitle = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-row-id]')?.textContent ?? null)

test('is as tall as Collapse, right after it, and its halves go to the two ends', async ({ page }) => {
  const title = `e2e list-ends ${Date.now()}`
  const id = await makeList(page.request, title, 600)

  try {
    await openList(page, title)
    const ends = page.getByRole('group', { name: 'Jump to an end of the list' })
    const up = page.getByRole('button', { name: 'Scroll to the top of the list' })
    const down = page.getByRole('button', { name: 'Scroll to the bottom of the list' })

    const sizes = await page.evaluate(() => {
      const r = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
      const group = r('.q-ends')
      const fold = r('.q-fold')

      return { width: group.width, height: group.height, foldHeight: fold.height, foldRight: fold.right, groupLeft: group.left, foldTop: fold.top, groupTop: group.top }
    })
    expect(sizes.width).toBeCloseTo(34, 0)
    expect(sizes.height).toBeCloseTo(sizes.foldHeight, 0)
    expect(sizes.groupTop).toBeCloseTo(sizes.foldTop, 0)
    expect(sizes.groupLeft - sizes.foldRight).toBeGreaterThan(0)
    expect(sizes.groupLeft - sizes.foldRight).toBeLessThan(16)

    await expect(up).toBeDisabled()
    await expect(down).toBeEnabled()

    await down.click()
    await expect.poll(() => focusedTitle(page)).toContain('Issue 599')
    await expect(down).toBeDisabled()
    await expect(up).toBeEnabled()
    await expect(page.locator('.q-live')).toHaveText('Bottom of the list')

    await up.click()
    await expect.poll(() => focusedTitle(page)).toContain('Part 1')
    await expect(up).toBeDisabled()
    await expect(down).toBeEnabled()
    await expect(page.locator('.q-live')).toHaveText('Top of the list')
    await expect(ends).toBeVisible()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a short list has the button too, both halves disabled, and says the whole list is in view', async ({ page }) => {
  const title = `e2e list-ends short ${Date.now()}`
  const id = await makeList(page.request, title, 8)

  try {
    await page.setViewportSize({ width: 1300, height: 1100 })
    await openList(page, title)
    const ends = page.getByRole('group', { name: 'Jump to an end of the list' })
    await expect(ends).toBeVisible()
    await expect(page.getByRole('button', { name: 'Scroll to the top of the list' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Scroll to the bottom of the list' })).toBeDisabled()

    await ends.hover()
    await expect(page.getByRole('tooltip')).toHaveText('The whole list is in view')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a window that is shortened brings the button alive on a list that no longer fits the view', async ({ page }) => {
  const title = `e2e list-ends resize ${Date.now()}`
  const id = await makeList(page.request, title, 8)

  try {
    await page.setViewportSize({ width: 1300, height: 1100 })
    await openList(page, title)
    const down = page.getByRole('button', { name: 'Scroll to the bottom of the list' })
    await expect(down).toBeDisabled()

    await page.setViewportSize({ width: 1300, height: 500 })
    await expect(down).toBeEnabled()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('nothing in the toolbar moves when Hide Completed or a filter changes the list, and the count has a fixed slot', async ({ page }) => {
  const title = `e2e list-ends steady ${Date.now()}`
  const id = await makeList(page.request, title, 30)

  try {
    const detail = await (await page.request.get(`/api/lists/${id}`)).json()
    for (const item of detail.items.slice(0, 20)) {
      await page.request.put(`/api/lists/${id}/items/${item.id}/consumed`, { data: { consumed: true } })
    }
    await openList(page, title)

    const parts = () =>
      page.evaluate(() =>
        ['.q-filter-field', '.q-filter-note', '.q-hide-done', '.q-fold', '.q-ends'].map((selector) => {
          const box = document.querySelector(selector)!.getBoundingClientRect()

          return [selector, Math.round(box.left * 10) / 10, Math.round(box.width * 10) / 10]
        }),
      )
    const before = await parts()

    await page.getByRole('button', { name: 'Hide Completed' }).click()
    await expect(page.locator('.q-filter-note')).toContainText('shown')
    expect(await parts()).toEqual(before)

    await page.getByRole('textbox', { name: 'Filter items' }).fill('Issue 2')
    await expect(page.locator('.q-filter-note')).not.toHaveText('30 items')
    expect(await parts()).toEqual(before)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
