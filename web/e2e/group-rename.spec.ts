import { expect, test } from '@playwright/test'

/**
 * Task 11.18 in a real browser against the dev server: a group is renamed from its pencil (its items follow),
 * a name the list already has is refused in the API's words with the editor left open, Undo names it back,
 * and a very long name stays inside its row. Real writes, removed in a `finally`.
 */
test('renames a group from its pencil, refuses a taken name, undoes, and keeps a long name in its row', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 })
  const title = `e2e group-rename ${Date.now()}`
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  await page.request.post(`/api/lists/${list.id}/items/import`, {
    data: {
      source: 'manual',
      items: [
        { title: 'Pilot', timeToConsumeMinutes: 40, group: 'Season 1' },
        { title: 'Finale', timeToConsumeMinutes: 40, group: 'Season 2' },
      ],
    },
  })
  const detail = async () => (await page.request.get(`/api/lists/${list.id}`)).json()
  const groupNames = async () => ((await detail()).groups as { name: string }[]).map((group) => group.name).sort()
  const itemGroups = async () => ((await detail()).items as { title: string; group: string }[]).map((item) => `${item.title}:${item.group}`).sort()

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.locator('.q-item', { hasText: 'Pilot' })).toBeVisible()

    // A taken name (any case) is refused and the editor stays.
    await page.getByRole('button', { name: 'Rename group Season 1', exact: true }).click()
    const editor = page.getByLabel('Group name')
    await editor.fill('season 2')
    await editor.press('Enter')
    // Said under the group's own header, not in the error strip or a toast (H-006); the editor keeps the cursor.
    await expect(page.locator('.q-group').getByRole('alert')).toContainText(/group with such name/)
    await expect(page.locator('.q-error-strip')).toHaveCount(0)
    await expect(editor).toBeVisible()
    await expect(editor).toBeFocused()
    await expect(editor).toHaveAttribute('aria-invalid', 'true')
    expect(await groupNames()).toEqual(['Season 1', 'Season 2'])
    // Typing takes the sentence away; Esc reverts and the next editor opens clean.
    await editor.fill('season 2b')
    await expect(page.locator('.q-group').getByRole('alert')).toHaveCount(0)
    await editor.fill('season 2')
    await editor.press('Enter')
    await expect(page.locator('.q-group').getByRole('alert')).toBeVisible()
    await editor.press('Escape')
    await expect(editor).toHaveCount(0)
    await expect(page.locator('.q-group').getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: 'Rename group Season 1', exact: true }).click()

    // A free name: the group and its items follow.
    await editor.fill('The Long Season')
    await editor.press('Enter')
    await expect(page.locator('.q-group b', { hasText: 'The Long Season' })).toBeVisible()
    await expect.poll(itemGroups).toEqual(['Finale:Season 2', 'Pilot:The Long Season'])
    await expect(page.locator('.q-toast')).toContainText('Renamed group Season 1 to The Long Season')

    // Undo names it back.
    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(groupNames).toEqual(['Season 1', 'Season 2'])

    // A very long name ends in an ellipsis inside its row, with the whole name on hover.
    const long = 'Better Call Saul Employee Training: Los Pollos Hermanos Employee Training and a Great Deal More Besides'
    await page.getByRole('button', { name: 'Rename group Season 1', exact: true }).click()
    await page.getByLabel('Group name').fill(long)
    await page.getByLabel('Group name').press('Enter')
    const name = page.locator('.q-group b', { hasText: 'Better Call Saul' })
    await expect(name).toBeVisible()
    // The whole name is in the app's tooltip on hover (11.20), not a native title. The pointer is parked where the pencil was, which the longer
    // name now covers (H-011: the pencil follows the name): it has to come in from outside for the tooltip to open.
    await page.mouse.move(5, 5)
    await name.hover()
    await expect(page.getByRole('tooltip')).toHaveText(long)
    const [row, text] = await Promise.all([page.locator('.q-group', { hasText: 'Better Call Saul' }).boundingBox(), name.boundingBox()])
    expect(text!.x + text!.width).toBeLessThanOrEqual(row!.x + row!.width)
    expect(row!.x + row!.width).toBeLessThanOrEqual(1000)
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})
