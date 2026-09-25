import { expect, test } from '@playwright/test'

/**
 * The list's own actions on the list layer (task 10.22) against the real dev
 * server: Edit list saves title, description and status; Export copies the
 * YAML the importer reads back. Real writes, removed in a `finally`.
 */
test('edit the list, then export it', async ({ page, context, browserName }) => {
  const title = `e2e list-settings ${Date.now()}`
  const created = await page.request.post('/api/lists', { data: { title, mediaType: 'tv' } })
  const id = (await created.json()).id
  await page.request.post(`/api/lists/${id}/items/import`, {
    data: { source: 'manual', items: [{ title: 'Alpha', timeToConsumeMinutes: 30, group: 'Season 1' }] },
  })

  try {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Edit List' }).click()
    const pop = page.locator('.q-pop')
    await pop.getByLabel('Title').fill(`${title} renamed`)
    await pop.getByLabel(/Description/).fill('A description')
    await pop.getByRole('button', { name: 'Ongoing' }).click()
    await pop.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByRole('heading', { name: new RegExp(`${title} renamed`) })).toBeVisible()
    await expect(page.getByText('A description')).toBeVisible()
    const saved = await (await page.request.get(`/api/lists/${id}`)).json()
    expect(saved).toMatchObject({ title: `${title} renamed`, description: 'A description', status: 'ongoing' })

    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Export List' }).click()
    const download = page.waitForEvent('download')
    await page.locator('.q-pop').getByRole('button', { name: 'Download File' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe(`${title} renamed.yaml`)
    const fs = await import('node:fs/promises')
    const text = await fs.readFile(await file.path(), 'utf8')
    expect(text).toContain(`title: ${title} renamed`)
    expect(text).toContain('category: tv')
    expect(text).toContain('Alpha')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
