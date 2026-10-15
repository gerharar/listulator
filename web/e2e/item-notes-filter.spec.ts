import { expect, test, type APIRequestContext } from '@playwright/test'
import { q } from './fixtures.js'

const text = q.list.itemActions

/**
 * The filter also searches the notes (H-003; owner, 2026-10-15), in a real browser: a row shown only for its note has its ⓘ
 * lit in the accent and says whose note matched; a title match looks as before. Real writes on the dev server, removed in a
 * `finally`.
 */
async function makeList(request: APIRequestContext, title: string) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'movie' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: {
      source: 'manual',
      items: [
        { title: 'Crime Story', timeToConsumeMinutes: 107 },
        { title: 'Heat', timeToConsumeMinutes: 170 },
        { title: 'Ronin', timeToConsumeMinutes: 121 },
      ],
    },
  })
  const { items } = await (await request.get(`/api/lists/${list.id}`)).json()
  const id = (name: string) => items.find((item: { title: string }) => item.title === name).id
  await request.patch(`/api/lists/${list.id}/items/${id('Crime Story')}`, { data: { userNote: 'Watch the Cantonese cut.' } })
  await request.patch(`/api/lists/${list.id}/items/${id('Ronin')}`, { data: { userNote: 'Ronin is the title and the Cantonese is not' } })
  return list.id as string
}

test('a note-only match lights the ⓘ in the accent and says whose note it is; a title match does not', async ({ page }) => {
  const title = `e2e item-notes-filter ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    const crime = page.locator('.q-item', { hasText: 'Crime Story' })
    const heat = page.locator('.q-item', { hasText: 'Heat' })
    const ronin = page.locator('.q-item', { hasText: 'Ronin' })
    // The accent as the browser resolves it, read from a probe that takes its colour from the token.
    const accent = () =>
      page.evaluate(() => {
        const probe = document.body.appendChild(document.createElement('span'))
        probe.style.color = 'var(--accent)'
        const color = getComputedStyle(probe).color
        probe.remove()
        return color
      })

    const normal = await crime.locator('button.info').evaluate((button) => getComputedStyle(button).color)
    await page.getByPlaceholder('Filter items…').fill('cantonese')

    // Crime Story and Ronin carry the text in their notes; Heat has neither the text nor a note and drops out.
    await expect(heat).toHaveCount(0)
    await expect(crime.getByRole('button', { name: text.noteForMatch(text.yourNote, 'Crime Story') })).toBeVisible()
    const lit = await crime.locator('button.info').evaluate((button) => getComputedStyle(button).color)
    expect(lit).not.toBe(normal)
    expect(lit).toBe(await accent())
    await crime.locator('button.info').hover()
    await expect(page.getByText(text.yourNoteMatches)).toBeVisible()

    // A title that has the text is shown as before, not lit: its note has it too, but it is not why it is shown.
    await page.getByPlaceholder('Filter items…').fill('ronin')
    await expect(ronin.getByRole('button', { name: text.noteFor(text.yourNote, 'Ronin') })).toBeVisible()
    expect(await ronin.locator('button.info').evaluate((button) => getComputedStyle(button).color)).toBe(normal)

    await page.getByPlaceholder('Filter items…').fill('')
    await expect(crime.getByRole('button', { name: text.noteFor(text.yourNote, 'Crime Story') })).toBeVisible()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
