import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * An item's tags by hand in the Edit window (U5, docs/chips): the Platform
 * panel for Games, a short dropdown for Music. Real writes, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string, mediaType: string, items: object[]) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })
  return list.id as string
}

const itemTags = async (request: APIRequestContext, listId: string, title: string) => {
  const list = await (await request.get(`/api/lists/${listId}`)).json()
  return list.items.find((item: { title: string }) => item.title === title).tags as string[] | null
}

test('a game’s platforms are picked in the panel beside the Edit window and saved in the table’s order', async ({ page }) => {
  const title = `e2e item-tags games ${Date.now()}`
  const id = await makeList(page.request, title, 'game', [
    { title: 'Assassin’s Creed', timeToConsumeMinutes: 900, tags: ['PS3'] },
    { title: 'Unity', timeToConsumeMinutes: 900 },
  ])

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.getByRole('button', { name: 'Edit Unity' }).click()
    await page.getByRole('button', { name: 'Platform: Not set' }).click()

    const panel = page.getByRole('dialog', { name: 'Choose platforms' })
    // Beside the window, not over it.
    const edit = (await page.locator('.q-pop').boundingBox())!
    const box = (await panel.boundingBox())!
    expect(box.x >= edit.x + edit.width || box.x + box.width <= edit.x).toBe(true)
    await expect(panel.getByRole('group', { name: 'In this list' })).toContainText('PS3')

    // Most common shows six once the list has platforms (WIN first); PS4 is found by search.
    await expect(panel.getByRole('group', { name: 'Most common' })).toContainText('WIN')
    const search = panel.getByPlaceholder('Search 186 platforms')
    // The first pick adds Clear and the picked chips, but nothing below them moves (owner).
    const before = (await search.boundingBox())!.y
    await panel.getByRole('button', { name: /^PS3 / }).click()
    await expect(panel.getByRole('button', { name: 'Clear' })).toBeVisible()
    expect((await search.boundingBox())!.y).toBe(before)
    await panel.getByRole('button', { name: /^PS3 / }).click()
    await search.fill('ps4')
    await panel.getByRole('button', { name: /^PS4 / }).click()
    await search.fill('windows')
    await panel.getByRole('button', { name: /^WIN / }).click()
    // Esc closes the panel only; the window keeps the picks.
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(page.getByRole('button', { name: 'Platform: WIN · PS4' })).toBeVisible()
    await page.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => itemTags(page.request, id, 'Unity')).toEqual(['WIN', 'PS4'])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a music item’s Type is one pick from its short list, Live ticked on top; other tags and a source’s EP stay', async ({ page }) => {
  const title = `e2e item-tags music ${Date.now()}`
  const id = await makeList(page.request, title, 'music', [
    { title: 'Panopticon', timeToConsumeMinutes: 60, tags: ['Album', 'Remaster'] },
    { title: 'The Red Sea', timeToConsumeMinutes: 35, tags: ['EP'] },
    { title: 'Live I', timeToConsumeMinutes: 70, tags: ['Album', 'Live'] },
    { title: 'Temporal', timeToConsumeMinutes: 78, tags: ['Album', 'Compilation', 'Live'] },
  ])

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.getByRole('button', { name: 'Edit Panopticon' }).click()
    await page.getByRole('button', { name: 'Type: Album' }).click()
    await page.getByRole('option', { name: 'Mini' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => itemTags(page.request, id, 'Panopticon')).toEqual(['Remaster', 'Mini'])

    await page.getByRole('button', { name: 'Edit The Red Sea' }).click()
    await page.getByRole('button', { name: 'Type: Mini' }).click()
    await page.getByRole('option', { name: 'Live' }).click()
    await expect(page.getByRole('button', { name: 'Type: Mini · Live' })).toBeVisible()
    // Live leaves the list open; a click past it (here on Save) only closes it (owner).
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('listbox')).toBeHidden()
    expect(await itemTags(page.request, id, 'The Red Sea')).toEqual(['EP'])
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => itemTags(page.request, id, 'The Red Sea')).toEqual(['EP', 'Live'])
    // The chip is 58px (owner): the type, and Live as a mark on it; nothing spills.
    const chip = page.locator('[data-row-id]', { hasText: 'The Red Sea' }).locator('.q-tag.kind')
    await expect(chip).toHaveAttribute('title', 'Mini · Live')
    await expect(chip.locator('.q-tag-mark')).toBeVisible()
    const fits = await page.locator('.q-tag.kind').evaluateAll((chips) =>
      chips.map((el) => el.scrollWidth <= el.clientWidth),
    )
    expect(fits.every(Boolean)).toBe(true)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('once a list has tags, an untagged item shows a centred + that opens its Edit window; the card has Edit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const title = `e2e item-tags plus ${Date.now()}`
  const id = await makeList(page.request, title, 'game', [
    { title: 'Assassin’s Creed', timeToConsumeMinutes: 900, tags: ['PS3', 'X360', 'WIN'] },
    { title: 'Bloodlines', timeToConsumeMinutes: 360, tags: ['PSP'] },
    { title: 'Unity', timeToConsumeMinutes: 900 },
  ])
  const music = await makeList(page.request, `${title} music`, 'music', [
    { title: 'Panopticon', timeToConsumeMinutes: 60, tags: ['Album'] },
    { title: 'Oceanic', timeToConsumeMinutes: 60 },
  ])

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).first().click()
    const plus = page.getByRole('button', { name: 'Set platforms for Unity' })
    await expect(plus.locator('svg')).toBeVisible()
    // The + sits in the middle of its box (owner), not at the left.
    // Both boxes in one read: the list card may still be sliding in, and two reads could straddle a frame.
    const offset = await plus.evaluate((el) => {
      const box = el.getBoundingClientRect()
      const glyph = el.querySelector('svg')!.getBoundingClientRect()
      return glyph.x + glyph.width / 2 - (box.x + box.width / 2)
    })
    expect(Math.abs(offset)).toBeLessThan(1.5)
    await expect(plus).toHaveCSS('border-top-style', 'dashed')
    await page.screenshot({ path: test.info().outputPath('plus-games.png') })

    await plus.click()
    await expect(page.getByRole('dialog', { name: 'Choose platforms' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await page.locator('.q-item', { hasText: 'Assassin’s Creed' }).locator('.q-plat').click()
    await page.screenshot({ path: test.info().outputPath('card-edit.png') })
    await page.getByRole('button', { name: 'Edit platforms for Assassin’s Creed' }).click()
    await expect(page.getByRole('dialog', { name: 'Choose platforms' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await page.goto('/')
    await page.locator('.q-home-row', { hasText: `${title} music` }).click()
    const typePlus = page.getByRole('button', { name: 'Set type for Oceanic' })
    await expect(typePlus.locator('svg')).toBeVisible()
    // Dashed here too, though it borrows the kind tag's solid-bordered box.
    await expect(typePlus).toHaveCSS('border-top-style', 'dashed')
    await page.screenshot({ path: test.info().outputPath('plus-music.png') })
  } finally {
    await page.request.delete(`/api/lists/${id}`)
    await page.request.delete(`/api/lists/${music}`)
  }
})

test('the add row picks the next item’s platforms, keeps them for the next, and remembers them for the list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const title = `e2e item-tags add ${Date.now()}`
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'game' } })).json()

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    // An empty Games list: no tag column yet, but the add row can already pick.
    const picker = page.getByRole('button', { name: /^Platform for the next item:/ })
    await expect(picker).toContainText('None')
    await picker.click()
    const panel = page.getByRole('dialog', { name: 'Choose platforms' })
    await expect(panel.getByText('Next item you add')).toBeVisible()
    await panel.getByPlaceholder('Search 186 platforms').fill('ps2')
    await panel.getByRole('button', { name: /^PS2 / }).click()
    await page.screenshot({ path: test.info().outputPath('add-picker.png') })
    await page.keyboard.press('Escape')
    await expect(picker).toContainText('PS2')

    const addTitle = page.locator('.q-add-item').getByLabel('Title')
    await addTitle.fill('Dark Cloud')
    await addTitle.press('Enter')
    await expect(page.locator('.q-item', { hasText: 'Dark Cloud' }).locator('.q-plat')).toHaveText('PS2')
    await addTitle.fill('Okami')
    await addTitle.press('Enter')
    await expect(page.locator('.q-item', { hasText: 'Okami' }).locator('.q-plat')).toHaveText('PS2')
    await page.screenshot({ path: test.info().outputPath('add-row.png') })

    // Reopened, the add row still starts on PS2.
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.getByRole('button', { name: /^Platform for the next item:/ })).toContainText('PS2')
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})
