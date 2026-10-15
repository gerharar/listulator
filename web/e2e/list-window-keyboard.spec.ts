import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Keyboard and focus on a list that draws only a window of its rows (Phase 25.3, BACKLOG BL-074), in a real browser: ↓ walks from the top to
 * row 3,000 without losing focus, a keyboard move at the edge of the window keeps the row in view and Undo restores it, and a list that
 * is opened again lands on the row it remembers. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string, count: number) {
  const rows = Array.from({ length: count }, (_, n) => `  - { title: "Issue ${n}", minutes: 30 }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
}

const focusedTitle = (page: Page) => page.evaluate(() => document.activeElement?.closest('.q-item')?.textContent ?? null)

const inView = (page: Page, title: string) =>
  page.evaluate((text) => {
    const body = document.querySelector('.q-list-body') as HTMLElement
    const row = [...document.querySelectorAll('.q-item')].find((node) => node.textContent?.includes(text)) as HTMLElement | undefined
    if (!row) return false
    const box = row.getBoundingClientRect()
    const area = body.getBoundingClientRect()
    return box.top >= area.top - 1 && box.bottom <= area.bottom + 1
  }, title)

test('↓ walks from the top to row 3,000 of a 5,000-item list and focus is never lost', async ({ page }) => {
  test.setTimeout(180_000)
  const title = `e2e list-keys walk ${Date.now()}`
  const id = await makeList(page.request, title, 5000)

  try {
    await openList(page, title)
    await page.locator('.q-item').first().focus()

    for (let step = 1; step <= 3000; step += 1) {
      await page.keyboard.press('ArrowDown')
      if (step % 250 === 0) {
        expect(await focusedTitle(page), `after ${step} steps`).toContain(`Issue ${step}`)
      }
    }

    expect(await focusedTitle(page)).toContain('Issue 3000')
    expect(await inView(page, 'Issue 3000')).toBe(true)
    expect(await page.locator('.q-item').count()).toBeLessThan(120)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('Shift+↓ at the edge of the window keeps the row in view, and Undo puts it back', async ({ page }) => {
  const title = `e2e list-keys move ${Date.now()}`
  const id = await makeList(page.request, title, 2000)

  try {
    await openList(page, title)
    await page.locator('.q-item').first().focus()
    for (let step = 1; step <= 40; step += 1) await page.keyboard.press('ArrowDown')
    expect(await focusedTitle(page)).toContain('Issue 40')

    // The focused row sits at the bottom of what is drawn after a walk; pushing it down must not leave it behind.
    for (let step = 0; step < 6; step += 1) await page.keyboard.press('Shift+ArrowDown')
    expect(await focusedTitle(page)).toContain('Issue 40')
    expect(await inView(page, 'Issue 40')).toBe(true)

    await expect(page.locator('.q-toast')).toContainText('Item moved', { timeout: 5000 })
    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect(async () => {
      const detail = await (await page.request.get(`/api/lists/${id}`)).json()
      const order = detail.items.sort((a: { orderIndex: number }, b: { orderIndex: number }) => a.orderIndex - b.orderIndex).map((item: { title: string }) => item.title)
      expect(order.slice(38, 43)).toEqual(['Issue 38', 'Issue 39', 'Issue 40', 'Issue 41', 'Issue 42'])
    }).toPass()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a long list that is opened again scrolls to the row it remembers, and that row is its tab stop', async ({ page }) => {
  const title = `e2e list-keys reopen ${Date.now()}`
  const id = await makeList(page.request, title, 3000)

  try {
    await openList(page, title)
    await page.locator('.q-item', { hasText: 'Issue 0' }).first().focus()
    for (let step = 1; step <= 1500; step += 1) await page.keyboard.press('ArrowDown')
    expect(await focusedTitle(page)).toContain('Issue 1500')

    await openList(page, title)

    await expect(page.getByText('Issue 1500', { exact: true })).toBeVisible()
    expect(await inView(page, 'Issue 1500')).toBe(true)
    await expect(page.locator('.q-item[tabindex="0"]')).toHaveCount(1)
    await expect(page.locator('.q-item[tabindex="0"]')).toContainText('Issue 1500')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
