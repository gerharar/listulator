import { expect, test } from '@playwright/test'

/**
 * H-013 in a real browser, in both engines: a click away from a group's name field only ends the rename (it saves, or keeps the field open when the
 * name is taken) and never also presses what it landed on. Real writes on the dev server, removed in a `finally`.
 */
test('a click away from a group rename only ends the rename', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 })
  const title = `e2e rename-guard ${Date.now()}`
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  await page.request.post(`/api/lists/${list.id}/items/import`, {
    data: {
      source: 'manual',
      items: [
        { title: 'Pilot', timeToConsumeMinutes: 40, group: 'Season 1' },
        { title: 'Finale', timeToConsumeMinutes: 40, group: 'Season 2' },
        ...Array.from({ length: 40 }, (_, n) => ({ title: `Filler ${n}`, timeToConsumeMinutes: 20, group: 'Season 3' })),
      ],
    },
  })
  const groupNames = async () => (((await (await page.request.get(`/api/lists/${list.id}`)).json()).groups as { name: string }[]).map((group) => group.name)).sort()
  const hideDone = page.getByRole('button', { name: 'Hide Completed' })
  const editor = page.getByLabel('Group name', { exact: true })
  const pencil = (name: string) => page.getByRole('button', { name: `Rename group ${name}`, exact: true })

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.locator('.q-item', { hasText: 'Pilot' })).toBeVisible()

    // Hide Completed is not toggled by the click that ends the rename; the rename is saved; the next click works.
    await pencil('Season 1').click()
    await editor.fill('Series One')
    await hideDone.click()
    await expect(editor).toHaveCount(0)
    await expect(page.locator('.q-group b', { hasText: 'Series One' })).toBeVisible()
    await expect(hideDone).toHaveAttribute('aria-pressed', 'false')
    await hideDone.click()
    await expect(hideDone).toHaveAttribute('aria-pressed', 'true')
    await hideDone.click()
    await expect(hideDone).toHaveAttribute('aria-pressed', 'false')

    // A row's checkbox-side of the row, and another group's chevron, are not pressed either.
    await pencil('Series One').click()
    await editor.fill('Series Uno')
    await page.locator('.q-item', { hasText: 'Finale' }).click()
    await expect(editor).toHaveCount(0)
    await expect(page.locator('.q-item.is-done')).toHaveCount(0)
    await pencil('Series Uno').click()
    await page.locator('.q-group', { hasText: 'Season 2' }).locator('.q-chev').click()
    await expect(editor).toHaveCount(0)
    await expect(page.locator('.q-group', { hasText: 'Season 2' })).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.q-item', { hasText: 'Finale' })).toBeVisible()

    // A taken name: the field stays open with its message and the cursor, and the press is swallowed (Hide Completed stays off).
    await pencil('Series Uno').click()
    await editor.fill('Season 2')
    await hideDone.click()
    await expect(page.locator('.q-group').getByRole('alert')).toBeVisible()
    await expect(editor).toBeFocused()
    await expect(hideDone).toHaveAttribute('aria-pressed', 'false')
    expect(await groupNames()).toEqual(['Season 2', 'Season 3', 'Series Uno'])

    // The wheel still scrolls the list while the field is open.
    const before = await page.locator('.q-list-body').evaluate((node) => node.scrollTop)
    await page.locator('.q-item', { hasText: 'Finale' }).hover()
    await page.mouse.wheel(0, 300)
    await expect.poll(() => page.locator('.q-list-body').evaluate((node) => node.scrollTop)).toBeGreaterThan(before)

    // Another group's pencil: this rename ends (an unchanged name here), the other does not start.
    await editor.fill('Series Uno')
    await pencil('Season 2').click({ force: true })
    await expect(editor).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})
