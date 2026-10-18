import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * A list drawn as a window says where each row is, for a screen reader (Phase 25.6, option A), and keeps a row with an open window drawn
 * (BACKLOG BL-074), in a real browser. The place is hidden text inside the row, so it is in the accessibility tree without a role or a
 * name being invented for a plain div. Real writes on the dev server, removed in a `finally`.
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

const setScroll = (page: Page, top: number) =>
  page.evaluate(async (y) => {
    ;(document.querySelector('.q-list-body') as HTMLElement).scrollTop = y
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  }, top)

test('each drawn row has its place in the accessibility tree, and the list says how it is drawn before the rows', async ({ page }) => {
  const title = `e2e list-a11y place ${Date.now()}`
  const id = await makeList(page.request, title, 5000)
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()))

  try {
    await openList(page, title)
    const first = page.locator('.q-item').first()
    await expect(first.locator('.q-place')).toHaveText('1 of 5000')
    await expect(page.locator('.q-list-body > .q-place')).toContainText('5000 items. Only the rows near the screen are drawn')
    expect(await page.locator('.q-list-body').evaluate((node) => node.firstElementChild?.className)).toBe('q-place')
    // In the accessibility tree, as text of the row: no role, no label put on a plain div.
    expect(await first.ariaSnapshot()).toContain('1 of 5000')
    expect(await first.getAttribute('role')).toBeNull()
    expect(await first.getAttribute('aria-label')).toBeNull()

    await setScroll(page, 2000 * 46)
    const row = page.locator('.q-item', { has: page.getByText('Issue 2000', { exact: true }) })
    await expect(row.locator('.q-place')).toHaveText('2001 of 5000')
    expect(await row.ariaSnapshot()).toContain('2001 of 5000')
    // The hidden text takes no room: the rows are as tall as ever.
    expect(await row.evaluate((node) => parseFloat(getComputedStyle(node).height))).toBe(46)
    expect(problems).toEqual([])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a short list is untouched: no place on any row', async ({ page }) => {
  const title = `e2e list-a11y short ${Date.now()}`
  const id = await makeList(page.request, title, 120)

  try {
    await openList(page, title)
    await expect(page.locator('.q-place')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a row with an open Edit window stays in the page when the list is scrolled far away, and the window stays open without errors', async ({ page }) => {
  const title = `e2e list-a11y popover ${Date.now()}`
  const id = await makeList(page.request, title, 5000)
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()))

  try {
    await openList(page, title)
    await page.getByRole('button', { name: 'Edit Issue 3' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await setScroll(page, 3000 * 46)
    await expect(page.getByText('Issue 3000', { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    expect(await page.locator('[data-row-id]', { has: page.getByText('Issue 3', { exact: true }) }).count()).toBe(1)
    // Back at the top the window is still anchored to its row.
    await setScroll(page, 0)
    const dialog = (await page.getByRole('dialog').boundingBox())!
    const row = (await page.locator('.q-item', { has: page.getByText('Issue 3', { exact: true }) }).boundingBox())!
    expect(Math.abs(dialog.y - row.y)).toBeLessThan(400)
    expect(problems).toEqual([])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
