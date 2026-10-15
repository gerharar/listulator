import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { q } from './fixtures.js'

const sentences = q.list.itemActions
const add = q.list.addItem

/**
 * The Add row's one rule for a wrong field (H-004, H-006, H-007; owner, 2026-10-15), in a real browser. Real writes on the
 * dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'movie' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'manual', items: [{ title: 'Heat', timeToConsumeMinutes: 170, group: 'Crime' }] },
  })
  return list.id as string
}

const items = async (request: APIRequestContext, listId: string) =>
  (await (await request.get(`/api/lists/${listId}`)).json()).items as { title: string; timeToConsumeMinutes: number; timeToConsumeIsEstimated: boolean }[]

const groups = async (request: APIRequestContext, listId: string) =>
  ((await (await request.get(`/api/lists/${listId}`)).json()).groups as { name: string }[]).map((group) => group.name)

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  const row = page.locator('.q-add-item')
  await row.scrollIntoViewIfNeeded()
  return row
}

test('one real press on Add with nothing typed adds nothing, says to type a title or a group name and puts the cursor in Title', async ({ page }) => {
  const title = `e2e add-row-validation empty ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    const row = await openList(page, title)

    await row.getByRole('button', { name: 'Add', exact: true }).click()

    await expect(row.getByRole('alert')).toHaveText(add.titleOrGroupRequired)
    await expect(row.getByLabel('Title')).toBeFocused()
    expect((await items(page.request, id)).map((item) => item.title)).toEqual(['Heat'])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a wrong year and a wrong length are said under the row, the year first, and nothing is added; fixed, the item goes in', async ({ page }) => {
  const title = `e2e add-row-validation fields ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    const row = await openList(page, title)
    await row.getByLabel('Title').fill('Ronin')
    await row.getByLabel('Year').fill('3500')
    await row.getByLabel('Minutes').fill('abc')

    await row.getByRole('button', { name: 'Add', exact: true }).click()

    await expect(row.getByRole('alert')).toHaveText([sentences.yearTooLate('3500'), sentences.minutesForm])
    await expect(row.getByLabel('Year')).toBeFocused()
    // The sentences sit under the row, so the button the press landed on has not moved.
    const sentenceBox = (await row.getByRole('alert').first().boundingBox())!
    const buttonBox = (await row.getByRole('button', { name: 'Add', exact: true }).boundingBox())!
    expect(sentenceBox.y).toBeGreaterThan(buttonBox.y + buttonBox.height - 1)
    expect((await items(page.request, id)).map((item) => item.title)).toEqual(['Heat'])

    await row.getByLabel('Year').fill('1998')
    await row.getByLabel('Minutes').fill('1h 35m')
    await row.getByRole('button', { name: 'Add', exact: true }).click()

    await expect.poll(async () => (await items(page.request, id)).map((item) => item.title)).toEqual(['Heat', 'Ronin'])
    const ronin = (await items(page.request, id)).find((item) => item.title === 'Ronin')!
    expect([ronin.timeToConsumeMinutes, ronin.timeToConsumeIsEstimated]).toEqual([95, false])
    await expect(row.getByRole('alert')).toHaveCount(0)
    await expect(row.getByLabel('Title')).toHaveValue('')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('an empty Minutes adds the category’s default as an estimate, marked ≈ on the row', async ({ page }) => {
  const title = `e2e add-row-validation default ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    const row = await openList(page, title)
    await row.getByLabel('Title').fill('Collateral')

    await row.getByRole('button', { name: 'Add', exact: true }).click()

    await expect(page.locator('.q-item', { hasText: 'Collateral' }).locator('.q-mins')).toHaveText(/^≈\d/)
    const added = (await items(page.request, id)).find((item) => item.title === 'Collateral')!
    expect(added.timeToConsumeIsEstimated).toBe(true)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a new group name alone adds an empty group, but a wrong length blocks it', async ({ page }) => {
  const title = `e2e add-row-validation group ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    const row = await openList(page, title)
    await row.getByLabel('Group').fill('Extras')
    await row.getByLabel('Minutes').fill('0')

    await row.getByRole('button', { name: 'Add Group' }).click()

    await expect(row.getByRole('alert')).toHaveText(sentences.minutesZero(120))
    expect(await groups(page.request, id)).toEqual(['Crime'])

    await row.getByLabel('Minutes').fill('')
    await row.getByRole('button', { name: 'Add Group' }).click()

    await expect.poll(() => groups(page.request, id)).toEqual(['Crime', 'Extras'])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
