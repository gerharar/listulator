import { expect, test, type APIRequestContext } from '@playwright/test'
import { q } from './fixtures.js'

const filter = q.list.filter

/**
 * The ✕ that clears the list filter's text (H-008; owner, 2026-10-15), in a real browser: only while there is text, a real
 * press leaves the cursor in the field, the field and the bar do not move when it appears, and Hide Completed keeps its
 * state. Real writes on the dev server, removed in a `finally`.
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
  const heat = items.find((item: { title: string }) => item.title === 'Heat')
  await request.put(`/api/lists/${list.id}/items/${heat.id}/consumed`, { data: { consumed: true } })
  return list.id as string
}

test('a real press on the ✕ clears the text, keeps the cursor in the field and leaves Hide Completed alone', async ({ page }) => {
  const title = `e2e filter-clear press ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    const field = page.getByPlaceholder(filter.placeholder)
    const clear = page.getByRole('button', { name: filter.clearText })

    await expect(clear).toHaveCount(0)
    await page.getByRole('button', { name: filter.hideDone }).click()
    await expect(page.locator('.q-item', { hasText: 'Heat' })).toHaveCount(0)
    await field.fill('ron')
    await expect(page.locator('.q-item')).toHaveCount(1)

    await clear.click()

    await expect(field).toHaveValue('')
    await expect(field).toBeFocused()
    await expect(clear).toHaveCount(0)
    // The two not-done films are back; Heat stays hidden, Hide Completed is still on.
    await expect(page.locator('.q-item')).toHaveCount(2)
    await expect(page.getByRole('button', { name: filter.hideDone })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.q-live')).toHaveText(filter.cleared)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the field and the bar do not move when the ✕ appears: the room for it is always reserved', async ({ page }) => {
  const title = `e2e filter-clear layout ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    const field = page.getByPlaceholder(filter.placeholder)
    const wrapper = page.locator('.q-filter-field')
    const note = page.locator('.q-filter-note')
    const measure = async () => ({
      wrapper: await wrapper.boundingBox(),
      input: await field.boundingBox(),
      noteX: (await note.boundingBox())!.x,
      padding: await field.evaluate((input) => getComputedStyle(input).paddingRight),
    })

    // The list layer slides in: measure once it has stopped moving, or the layer's own motion looks like the ✕'s.
    let last = JSON.stringify(await wrapper.boundingBox())
    await expect
      .poll(async () => {
        const now = JSON.stringify(await wrapper.boundingBox())
        const still = now === last
        last = now
        return still
      })
      .toBe(true)
    const without = await measure()
    await field.fill('ron')
    await expect(page.getByRole('button', { name: filter.clearText })).toBeVisible()
    const withText = await measure()

    expect(without.padding).toBe('34px')
    expect(withText.padding).toBe('34px')
    expect(withText.wrapper).toEqual(without.wrapper)
    expect(withText.input).toEqual(without.input)
    // The ✕ is inside the field, at its right edge.
    const button = (await page.getByRole('button', { name: filter.clearText }).boundingBox())!
    const box = without.input!
    expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width)
    expect(button.x).toBeGreaterThan(box.x + box.width - 40)
    // The note (which says "1 of 3 shown") sits where it did: nothing in the bar was pushed.
    expect(Math.abs(withText.noteX - without.noteX)).toBeLessThan(40)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
