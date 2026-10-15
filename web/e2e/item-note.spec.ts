import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The user's own note in the Edit window (H-003, BL-043; owner, 2026-10-15), in a real browser: Enter is a new line, Ctrl or
 * ⌘ with Enter saves, the counter appears from 1,800 characters, the field stops at 2,048, and an empty note removes it.
 * Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'movie' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'manual', items: [{ title: 'Crime Story', timeToConsumeMinutes: 107, year: 1993 }] },
  })
  return list.id as string
}

const noteOf = async (request: APIRequestContext, listId: string) =>
  (await (await request.get(`/api/lists/${listId}`)).json()).items[0].userNote as string | null

async function openEdit(page: Page, listTitle: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: listTitle }).click()
  await page.getByRole('button', { name: 'Edit Crime Story' }).click()
  return page.locator('.q-pop')
}

test('Enter is a new line and Ctrl+Enter saves: the note is stored with its line break, and removed by saving it empty', async ({ page }) => {
  const title = `e2e item-note keys ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    const edit = await openEdit(page, title)
    const note = edit.locator('textarea.q-edit-note')
    await note.click()
    await page.keyboard.type('The serious one.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Watch the Cantonese cut.')

    // Enter did not save: the window is open and nothing is stored.
    await expect(edit).toBeVisible()
    expect(await noteOf(page.request, id)).toBeNull()

    await page.keyboard.press('Control+Enter')

    await expect(edit).toBeHidden()
    await expect.poll(() => noteOf(page.request, id)).toBe('The serious one.\nWatch the Cantonese cut.')

    // Reopened, the note is there; saved empty, it is removed.
    await page.getByRole('button', { name: 'Edit Crime Story' }).click()
    const again = page.locator('.q-pop textarea.q-edit-note')
    await expect(again).toHaveValue('The serious one.\nWatch the Cantonese cut.')
    await again.fill('')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => noteOf(page.request, id)).toBeNull()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the counter shows from 1,800 characters and the field stops at 2,048, with no error', async ({ page }) => {
  const title = `e2e item-note limit ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    const edit = await openEdit(page, title)
    const note = edit.locator('textarea.q-edit-note')

    await note.fill('a'.repeat(1799))
    await expect(edit.getByText(/ \/ 2,048$/)).toHaveCount(0)

    await note.fill('a'.repeat(1994))
    await expect(edit.getByText('1,994 / 2,048')).toBeVisible()

    await note.fill('b'.repeat(2100))
    expect((await note.inputValue()).length).toBe(2048)
    await expect(edit.getByText('2,048 / 2,048')).toBeVisible()
    await expect(edit.getByRole('alert')).toHaveCount(0)

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(async () => (await noteOf(page.request, id))?.length).toBe(2048)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the note grows from four lines as it is typed, and the window still fits on the screen', async ({ page }) => {
  const title = `e2e item-note grow ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    const edit = await openEdit(page, title)
    const note = edit.locator('textarea.q-edit-note')
    const before = (await note.boundingBox())!

    const heightOf = async () => (await note.boundingBox())!.height
    await note.fill(Array.from({ length: 7 }, (_, index) => `line ${index + 1}`).join('\n'))
    await expect.poll(heightOf).toBeGreaterThan(before.height)
    const grown = await heightOf()
    await note.fill(Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n'))
    // Eight lines at most, then it scrolls: thirty lines are not four times as tall as seven.
    await expect.poll(heightOf).toBeGreaterThanOrEqual(grown)
    expect(await heightOf()).toBeLessThan(grown * 1.6)
    const box = (await edit.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
