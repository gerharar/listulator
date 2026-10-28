import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * BL-150, in a real browser with the real `localStorage` (the desktop keeps the same keys in `preferences.json`): what the app remembers
 * per list (`list:<id>:…`) is removed for lists that are gone, once per start, after Home's first good read of the lists. Other keys and
 * the live lists' keys stay; a list deleted during the run keeps its state until the next start, so an Undo can find it. Real writes on
 * the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  const items = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name, n) => ({ title: name, timeToConsumeMinutes: 30, group: n < 2 ? 'Season 1' : 'Season 2' }))
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return list.id as string
}

/** Every key the app keeps for a list, and every other key, as they are in the page right now. */
const stored = (page: Page) =>
  page.evaluate(() => {
    const keys = Object.keys(localStorage)

    return { listKeys: keys.filter((key) => key.startsWith('list:')).sort(), otherKeys: keys.filter((key) => !key.startsWith('list:')).sort() }
  })

const row = (page: Page, title: string) => page.locator('.q-home-row', { hasText: title })

test('at start, the keys of lists that are gone are removed; a live list’s and every other key stay', async ({ page }) => {
  const title = `e2e forget-lists start ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.addInitScript((liveId) => {
      localStorage.setItem('list:ghost:collapsed', '["Season 1"]')
      localStorage.setItem('list:ghost:focus', 'row-1')
      localStorage.setItem('list:ghost-two:railWidth', '240')
      localStorage.setItem(`list:${liveId}:hideDone`, 'off')
      localStorage.setItem('zz-unrelated', 'kept')
      localStorage.setItem('listFoo', 'kept')
    }, id)

    await page.goto('/')
    await expect(row(page, title)).toBeVisible()

    await expect.poll(async () => (await stored(page)).listKeys).toEqual([`list:${id}:hideDone`])
    expect((await stored(page)).otherKeys).toEqual(expect.arrayContaining(['listFoo', 'zz-unrelated']))
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a list deleted during the run keeps its remembered state until the next start, then loses it', async ({ page }) => {
  const stamp = Date.now()
  const [titleA, titleB] = [`e2e forget-lists A ${stamp}`, `e2e forget-lists B ${stamp}`]
  const [idA, idB] = [await makeList(page.request, titleA), await makeList(page.request, titleB)]
  const open = async (title: string) => {
    await row(page, title).click()
    await page.locator('.q-group').first().waitFor()
  }
  const close = () => page.getByRole('button', { name: 'Close', exact: true }).click()

  try {
    await page.goto('/')
    await open(titleA)
    // Opening a list writes its own state straight back.
    await expect.poll(async () => (await stored(page)).listKeys).toContain(`list:${idA}:collapsed`)
    await close()

    // Deleted while the app runs (the Undo of a delete would put it back under this id), then Home reads the lists again.
    await page.request.delete(`/api/lists/${idA}`)
    await open(titleB)
    await close()
    await expect(row(page, titleA)).toHaveCount(0)
    expect((await stored(page)).listKeys).toContain(`list:${idA}:collapsed`)

    // The next start.
    await page.reload()
    await expect(row(page, titleB)).toBeVisible()
    await expect.poll(async () => (await stored(page)).listKeys).not.toContain(`list:${idA}:collapsed`)
    expect((await stored(page)).listKeys).toContain(`list:${idB}:collapsed`)
  } finally {
    await page.request.delete(`/api/lists/${idA}`)
    await page.request.delete(`/api/lists/${idB}`)
  }
})
