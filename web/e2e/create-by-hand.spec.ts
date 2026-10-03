import { expect, test } from '@playwright/test'
import { q } from './fixtures.js'

/**
 * Add by hand (task 10.13), against the real dev server: what is typed is what
 * the created list carries. A real write, cleaned up at the end, like the other
 * specs that create.
 */
test('a hand-made list carries its description, status, groups and estimated runtimes', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: q.home.newList }).click()
  await page.locator('.q-tile').first().click()
  await page.getByRole('tab', { name: q.createList.handTab }).click()

  const title = `e2e by-hand ${Date.now()}`
  await page.getByLabel(q.addByHand.titleLabel, { exact: true }).fill(title)
  await page.getByLabel(q.addByHand.descriptionLabel, { exact: true }).fill('Typed in by hand')
  await page.getByLabel(q.addByHand.itemsLabel, { exact: true }).fill('Early:\nOne\nTwo\n\n# Late\nThree')
  await page.getByRole('button', { name: 'Ongoing', exact: true }).click()

  await expect(page.getByText(/^3 items in 2 groups/)).toBeVisible()
  await page.getByRole('button', { name: q.addByHand.create }).click()

  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  // The layer stack does not move the URL, so find the list by its title.
  const all: { id: string; title: string }[] = await (await page.request.get('/api/lists')).json()
  const id = all.find((entry) => entry.title === title)?.id
  expect(id).toBeTruthy()

  try {
    const list = await (await page.request.get(`/api/lists/${id}`)).json()
    expect(list.description).toBe('Typed in by hand')
    expect(list.status).toBe('ongoing')
    expect(
      list.items.map((item: { title: string; group?: string }) => [item.title, item.group]),
    ).toEqual([
      ['One', 'Early'],
      ['Two', 'Early'],
      ['Three', 'Late'],
    ])
    expect(
      list.items.every(
        (item: { timeToConsumeIsEstimated: boolean }) => item.timeToConsumeIsEstimated,
      ),
    ).toBe(true)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
