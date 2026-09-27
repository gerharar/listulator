import { expect, test, type Page } from '@playwright/test'

/**
 * Import a file (task 10.14), against the real parser on the dev server. Only
 * the valid-file test writes, and it cleans up in a `finally`.
 */
async function openImport(page: Page, category = 'Movies') {
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: new RegExp(`^${category}`) }).click()
  await page.getByRole('tab', { name: 'Import a file' }).click()
}

const box = (page: Page) => page.getByLabel('YAML')

const REFUSALS: [string, string, string][] = [
  [
    'a syntax error',
    'title: X\ncategory: movie\nitems: [unclosed',
    'Syntax error on line 3, list cannot be imported.',
  ],
  [
    'no items',
    'title: X\ncategory: movie\nitems: []\n',
    'No items found, list cannot be imported.',
  ],
  [
    'an unknown category',
    'title: X\ncategory: board games\nitems:\n  - { title: A }\n',
    'Unknown category ‘board games’, list cannot be imported.',
  ],
]

for (const [name, yaml, sentence] of REFUSALS) {
  test(`${name} is refused in one sentence, and the sentence clears on the next edit`, async ({
    page,
  }) => {
    await openImport(page)

    await box(page).fill(yaml)
    await page.getByRole('button', { name: 'Import', exact: true }).click()

    await expect(page.getByText(sentence)).toBeVisible()
    await box(page).press('x')
    await expect(page.getByText(sentence)).toBeHidden()
  })
}

test('a valid file becomes a list with no done marks and its notes intact', async ({ page }) => {
  await openImport(page)

  const title = `e2e import ${Date.now()}`
  await box(page).fill(
    `title: ${title}\ncategory: movie\ndescription: From a file\nitems:\n` +
      '  - { title: Alpha, year: 1999, notes: "Not the 2001 one" }\n  - { title: Beta }\n',
  )
  await page.getByRole('button', { name: 'Import', exact: true }).click()

  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  const all: { id: string; title: string }[] = await (await page.request.get('/api/lists')).json()
  const id = all.find((entry) => entry.title === title)?.id
  expect(id).toBeTruthy()

  try {
    const list = await (await page.request.get(`/api/lists/${id}`)).json()
    expect(list.description).toBe('From a file')
    expect(list.items.map((item: { title: string }) => item.title)).toEqual(['Alpha', 'Beta'])
    expect(list.items[0].notes).toBe('Not the 2001 one')
    expect(list.items.map((item: { consumedAt: string | null }) => item.consumedAt)).toEqual([
      null,
      null,
    ])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a file of another category asks first; Back keeps the text, Import puts it in its own category (U3)', async ({
  page,
}) => {
  await openImport(page, 'Games')

  const title = `e2e import other ${Date.now()}`
  await box(page).fill(`title: ${title}\ncategory: movie\nitems:\n  - { title: Alpha }\n`)
  await page.getByRole('button', { name: 'Import', exact: true }).click()

  const question = page.getByRole('dialog')
  await expect(question.getByText('Import to Movies?')).toBeVisible()
  await expect(
    question.getByText("Current category is Games, the list you're importing is from Movies."),
  ).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('u3-question.png') })

  await question.getByRole('button', { name: 'Back' }).click()
  await expect(question).toBeHidden()
  await expect(box(page)).toHaveValue(new RegExp(title))

  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  const all: { id: string; title: string; mediaType: string }[] = await (
    await page.request.get('/api/lists')
  ).json()
  const made = all.find((entry) => entry.title === title)
  expect(made).toBeTruthy()
  try {
    expect(made?.mediaType).toBe('movie')
  } finally {
    await page.request.delete(`/api/lists/${made?.id}`)
  }
})
