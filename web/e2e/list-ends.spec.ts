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

test('a short list has no split button', async ({ page }) => {
  const title = `e2e list-ends short ${Date.now()}`
  const id = await makeList(page.request, title, 8)

  try {
    await openList(page, title)
    await expect(page.locator('.q-fold')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Jump to an end of the list' })).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a window that is shortened shows the button on a list that no longer fits in two screens', async ({ page }) => {
  const title = `e2e list-ends resize ${Date.now()}`
  const id = await makeList(page.request, title, 30)

  try {
    await page.setViewportSize({ width: 1300, height: 1100 })
    await openList(page, title)
    await expect(page.getByRole('group', { name: 'Jump to an end of the list' })).toHaveCount(0)

    await page.setViewportSize({ width: 1300, height: 600 })
    await expect(page.getByRole('group', { name: 'Jump to an end of the list' })).toBeVisible()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
