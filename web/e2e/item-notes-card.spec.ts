import { expect, test, type APIRequestContext } from '@playwright/test'
import { q } from './fixtures.js'

const text = q.list.itemActions

/**
 * The ⓘ and its card (H-003; owner, 2026-10-15), in a real browser: no note, no ⓘ and the ✎ where the ⓘ's glyph would have
 * been; a note, an ⓘ named for it, its card with the line breaks kept, and the ✎ on "Your note" opening the Edit window with
 * the cursor in Note. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'movie' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: {
      source: 'manual',
      items: [
        { title: 'Crime Story', timeToConsumeMinutes: 107, year: 1993 },
        { title: 'Heat', timeToConsumeMinutes: 170, year: 1995 },
      ],
    },
  })
  const { items } = await (await request.get(`/api/lists/${list.id}`)).json()
  const crime = items.find((item: { title: string }) => item.title === 'Crime Story')
  await request.patch(`/api/lists/${list.id}/items/${crime.id}`, { data: { userNote: 'The serious one.\nWatch the Cantonese cut.' } })
  return list.id as string
}

const noteOf = async (request: APIRequestContext, listId: string) => {
  const { items } = await (await request.get(`/api/lists/${listId}`)).json()
  return items.find((item: { title: string }) => item.title === 'Crime Story').userNote as string | null
}

test('an item with no note has no ⓘ, and its ✎ sits where the ⓘ’s glyph does on a row that has one', async ({ page }) => {
  const title = `e2e item-notes-card row ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    const heat = page.locator('.q-item', { hasText: 'Heat' })
    const crime = page.locator('.q-item', { hasText: 'Crime Story' })

    await expect(heat.locator('button.info')).toHaveCount(0)
    await expect(heat.getByRole('button', { name: text.edit('Heat') })).toBeVisible()
    await expect(crime.getByRole('button', { name: text.noteFor(text.yourNote, 'Crime Story') })).toBeVisible()

    // The first icon after the title is at the same distance from the title on both rows (its glyph, not its button).
    const glyphGap = async (row: typeof heat, button: string) => {
      const title = (await row.locator('.tt').boundingBox())!
      const box = (await row.locator(button).boundingBox())!
      return box.x + (box.width - 15) / 2 - (title.x + title.width)
    }
    // Polled: the first measure can land before the row's fonts and the tooltip layer have settled.
    await expect
      .poll(async () => Math.abs((await glyphGap(crime, 'button.info')) - (await glyphGap(heat, 'button.edit'))))
      .toBeLessThanOrEqual(1)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the card shows Your note with its line break, no cover or year, and ✎ opens the Edit window on the note', async ({ page }) => {
  const title = `e2e item-notes-card card ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.getByRole('button', { name: text.noteFor(text.yourNote, 'Crime Story') }).click()

    const card = page.locator('.q-pop .q-info')
    await expect(card.locator('.q-kicker')).toHaveText(text.yourNote)
    await expect(card.locator('.q-info-title')).toHaveText('Crime Story')
    expect(await card.locator('.q-info-text').innerText()).toBe('The serious one.\nWatch the Cantonese cut.')
    await expect(card.locator('.q-info-cover, .q-info-facts')).toHaveCount(0)

    await card.getByRole('button', { name: text.editYourNote }).click()

    await expect(page.locator('.q-pop .q-info')).toHaveCount(0)
    const note = page.locator('.q-pop textarea.q-edit-note')
    await expect(note).toBeFocused()
    await expect(note).toHaveValue('The serious one.\nWatch the Cantonese cut.')

    await page.keyboard.type(' Twice.')
    await page.keyboard.press('Control+Enter')

    await expect.poll(() => noteOf(page.request, id)).toBe('The serious one.\nWatch the Cantonese cut. Twice.')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('clearing the note in the Edit window takes the ⓘ off the row', async ({ page }) => {
  const title = `e2e item-notes-card cleared ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.getByRole('button', { name: text.edit('Crime Story') }).click()
    await page.locator('.q-pop textarea.q-edit-note').fill('')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await expect.poll(() => noteOf(page.request, id)).toBeNull()
    await expect(page.locator('.q-item', { hasText: 'Crime Story' }).locator('button.info')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
