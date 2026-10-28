import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * BL-152 / SR-119, in a real browser: a tag in a list file is text anyone can write, and one named like an inherited object member
 * (`constructor`, `__proto__`) used to bring the whole app down when its list was opened (a Games list: a TypeError in the platform
 * table) or break the facet dropdown (a Books list). The import has always accepted such a tag. Now the list opens and the tag is one
 * more option. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string, mediaType: string, tagged: string[][]) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType } })).json()
  const items = tagged.map((tags, n) => ({ title: `Item ${n}`, timeToConsumeMinutes: 30, tags }))
  const imported = await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })
  expect(imported.status(), 'the import accepts such a tag').toBe(201)

  return list.id as string
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await expect(page.locator('.q-item').first()).toBeVisible()
}

const crashed = (page: Page) => page.getByText('Whoops...')

test('a Games list with platform tags named constructor and __proto__ opens, and they are two more platforms', async ({ page }) => {
  const title = `e2e hostile-tags game ${Date.now()}`
  const id = await makeList(page.request, title, 'game', [['constructor'], ['__proto__'], ['PS5']])

  try {
    await openList(page, title)
    await expect(crashed(page)).toHaveCount(0)
    await expect(page.locator('.q-item')).toHaveCount(3)

    await page.getByRole('button', { name: /^Platform: / }).click()
    const popover = page.getByRole('dialog')
    for (const code of ['CONSTRUCTOR', '__PROTO__', 'PS5']) await expect(popover.getByRole('button', { name: code, exact: true })).toBeVisible()

    await popover.getByRole('button', { name: 'CONSTRUCTOR', exact: true }).click()
    await expect(page.locator('.q-item .title')).toHaveText(['Item 0'])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a Books list with language tags named constructor and __proto__ has them in its Language dropdown as written', async ({ page }) => {
  const title = `e2e hostile-tags book ${Date.now()}`
  const id = await makeList(page.request, title, 'book', [['constructor'], ['__proto__'], ['English']])

  try {
    await openList(page, title)
    await expect(crashed(page)).toHaveCount(0)

    await page.getByRole('button', { name: /^Language: / }).click()
    const popover = page.getByRole('dialog')
    for (const label of ['constructor', '__proto__', 'English']) await expect(popover.getByRole('button', { name: label, exact: true })).toBeVisible()

    await popover.getByRole('button', { name: '__proto__', exact: true }).click()
    await expect(page.locator('.q-item .title')).toHaveText(['Item 1'])
    await expect(page.getByRole('button', { name: 'Language: __proto__' })).toBeVisible()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
