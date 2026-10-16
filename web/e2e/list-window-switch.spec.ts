import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The switch that turns the window off (Phase 25.7, BACKLOG BL-074), in a real browser: the app's own preference `listVirtualization`,
 * written by hand into `localStorage` (the web build's preference store; the desktop's `preferences.json` is the same key). With `off` a
 * long list draws every row, as before Phase 25; anything but an off word leaves the window on. The server's `LIST_VIRTUALIZATION` variable
 * is covered by the server's own tests (it needs a restart). Real writes on the dev server, removed in a `finally`.
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

test('by default a 1,000-row list draws a window; with `off` in localStorage it draws every row, and scrolls to the last', async ({ page }) => {
  test.setTimeout(120_000)
  const title = `e2e list-switch ${Date.now()}`
  const id = await makeList(page.request, title, 1000)

  try {
    await openList(page, title)
    expect(await page.locator('.q-item').count()).toBeLessThan(120)
    await expect(page.locator('.q-list-spacer').first()).toBeAttached()

    await page.evaluate(() => localStorage.setItem('listVirtualization', 'off'))
    await openList(page, title)
    await expect(page.locator('.q-item')).toHaveCount(1000)
    await expect(page.locator('.q-list-spacer')).toHaveCount(0)
    await expect(page.locator('.q-place')).toHaveCount(0)
    await expect(page.getByText('Issue 999', { exact: true })).toBeAttached()
    await page.evaluate(() => ((document.querySelector('.q-list-body') as HTMLElement).scrollTop = 10_000_000))
    await expect(page.getByText('Issue 999', { exact: true })).toBeVisible()

    // Taken out again (or written as something nobody understands), the window is back.
    await page.evaluate(() => localStorage.setItem('listVirtualization', 'maybe'))
    await openList(page, title)
    expect(await page.locator('.q-item').count()).toBeLessThan(120)
    await page.evaluate(() => localStorage.removeItem('listVirtualization'))
  } finally {
    await page.evaluate(() => localStorage.removeItem('listVirtualization'))
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the other ways of writing off work in the browser too (false, 0, no, in any case)', async ({ page }) => {
  test.setTimeout(120_000)
  const title = `e2e list-switch words ${Date.now()}`
  const id = await makeList(page.request, title, 400)

  try {
    for (const word of ['FALSE', ' 0 ', 'No']) {
      await page.goto('/')
      await page.evaluate((value) => localStorage.setItem('listVirtualization', value), word)
      await openList(page, title)
      await expect(page.locator('.q-item'), `with "${word}"`).toHaveCount(400)
    }
  } finally {
    await page.evaluate(() => localStorage.removeItem('listVirtualization'))
    await page.request.delete(`/api/lists/${id}`)
  }
})
