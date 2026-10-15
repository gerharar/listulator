import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { q } from './fixtures.js'

const text = q.list.itemActions

/**
 * The Edit window's one rule for a wrong field (H-004, H-006, H-007; owner, 2026-10-15), in a real browser: what jsdom
 * cannot show, a real mouse press, real layout, real focus. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string, items: object[]) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'movie' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })
  return list.id as string
}

const item = async (request: APIRequestContext, listId: string, title: string) => {
  const list = await (await request.get(`/api/lists/${listId}`)).json()
  return list.items.find((entry: { title: string }) => entry.title === title)
}

async function openEdit(page: Page, listTitle: string, itemTitle: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: listTitle }).click()
  await page.getByRole('button', { name: `Edit ${itemTitle}` }).click()
  await expect(field(page, 'Title')).toBeVisible()
}

const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true })
/** A field of the Edit window; the Add row at the foot of the list has a Title and a Year of its own. */
const field = (page: Page, label: string) => page.locator('.q-pop').getByLabel(label, { exact: true })

test('one press on Save with a wrong year is not lost: the sentence shows, the cursor is in Year with its text selected, nothing is saved', async ({ page }) => {
  const title = `e2e item-edit-validation year ${Date.now()}`
  const id = await makeList(page.request, title, [{ title: 'Heat', timeToConsumeMinutes: 170, year: 1995 }])

  try {
    await openEdit(page, title, 'Heat')
    const year = field(page, 'Year')
    await year.fill('199')
    // The cursor is still in the field: the press below is what leaves it, as a person's would be.
    await expect(year).toBeFocused()

    await save(page).click()

    await expect(page.locator('.q-pop').getByRole('alert')).toHaveText(text.yearForm)
    await expect(year).toHaveAttribute('aria-invalid', 'true')
    // The press reached the button (a lost click would leave the cursor on the button, not on Year).
    await expect(year).toBeFocused()
    expect(await year.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 3])
    // The window stays open and nothing was written.
    await expect(page.locator('.q-pop')).toBeVisible()
    expect((await item(page.request, id, 'Heat')).year).toBe(1995)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a wrong field keeps its size: the thick border takes one pixel from the padding, not from the field', async ({ page }) => {
  const title = `e2e item-edit-validation size ${Date.now()}`
  const id = await makeList(page.request, title, [{ title: 'Heat', timeToConsumeMinutes: 170, year: 1995 }])

  try {
    await openEdit(page, title, 'Heat')
    const year = field(page, 'Year')
    const before = (await year.boundingBox())!

    await year.fill('199')
    await save(page).click()
    await expect(year).toHaveAttribute('aria-invalid', 'true')
    const after = (await year.boundingBox())!

    expect([after.width, after.height]).toEqual([before.width, before.height])
    expect(await year.evaluate((input: HTMLInputElement) => getComputedStyle(input).borderTopWidth)).toBe('2px')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('an empty title keeps the window open and says an item needs a title', async ({ page }) => {
  const title = `e2e item-edit-validation title ${Date.now()}`
  const id = await makeList(page.request, title, [{ title: 'Heat', timeToConsumeMinutes: 170 }])

  try {
    await openEdit(page, title, 'Heat')
    await field(page, 'Title').fill('')

    await save(page).click()

    await expect(page.locator('.q-pop').getByRole('alert')).toHaveText(text.titleRequired)
    await expect(field(page, 'Title')).toBeFocused()
    await expect(page.locator('.q-pop')).toBeVisible()
    expect((await item(page.request, id, 'Heat')).title).toBe('Heat')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('an emptied Duration becomes the category’s default, marked ≈ on the row; a typed one drops the mark', async ({ page }) => {
  const title = `e2e item-edit-validation duration ${Date.now()}`
  const id = await makeList(page.request, title, [{ title: 'Heat', timeToConsumeMinutes: 170 }])

  try {
    await openEdit(page, title, 'Heat')
    await field(page, text.editMinutes).fill('')
    await save(page).click()

    const row = page.locator('.q-item', { hasText: 'Heat' })
    await expect(row.locator('.q-mins')).toHaveText(/^≈\d/)
    expect((await item(page.request, id, 'Heat')).timeToConsumeIsEstimated).toBe(true)

    // An estimate opens as an empty field: empty is the category's default.
    await page.getByRole('button', { name: 'Edit Heat' }).click()
    await expect(field(page, text.editMinutes)).toHaveValue('')
    await expect(field(page, text.editMinutes)).toHaveAttribute('placeholder', /\(default\)$/)
    await field(page, text.editMinutes).fill('1h 35m')
    await save(page).click()

    await expect(row.locator('.q-mins')).toHaveText('1h 35m')
    const saved = await item(page.request, id, 'Heat')
    expect([saved.timeToConsumeMinutes, saved.timeToConsumeIsEstimated]).toEqual([95, false])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
