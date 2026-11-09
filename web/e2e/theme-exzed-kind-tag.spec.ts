import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The kind tag in a list row under eX-Zed (found at Checkpoint D: a row’s ENGLISH tag drew its text outside its box). Quantum gives the tag a fixed 58px; the
 * Spectrum font is as wide as it is tall, so a label is far wider than that. Design’s Tag card: every tag in a list is as wide as the longest tag present. In
 * both engines: no tag’s text leaves its box, every tag in the list is one width, that width is the longest label’s, and in Quantum the tag is still 58px.
 * Real writes on the dev server, removed in a `finally`.
 */
const LABELS = ['English', 'Deutsch', 'Compilation', 'EP']

async function makeList(request: APIRequestContext, title: string) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'movie' } })).json()
  const items = LABELS.map((tag, at) => ({ title: `Record ${at + 1}`, timeToConsumeMinutes: 40, tags: [tag] }))
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })
  return list.id as string
}

async function open(page: Page, theme: string, title: string) {
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ theme, skin: 'dark-orange', exzedSkin: 'exzed-1l', reducedMotion: 'true' }))
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
}

const tags = (page: Page) =>
  page.locator('.q-item .q-tag.kind').evaluateAll((elements) =>
    elements.map((el) => {
      const box = el.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(el)
      const text = range.getBoundingClientRect()

      return { label: el.textContent?.trim(), width: box.width, left: text.left - box.left, right: box.right - text.right }
    }),
  )

test.describe('the kind tag in a list row', () => {
  let id = ''

  test.afterEach(async ({ page }) => {
    if (id) await page.request.delete(`/api/lists/${id}`)
    id = ''
  })

  test('under eX-Zed no tag’s text leaves its box, and every tag is as wide as the longest label in the list', async ({ page }) => {
    const title = `e2e kind tag ${test.info().project.name} ${Date.now()}`
    id = await makeList(page.request, title)
    await open(page, 'exzed', title)

    const found = await tags(page)
    expect(found.map((tag) => tag.label)).toEqual(LABELS)
    for (const tag of found) {
      expect(tag.left, `${tag.label}: room left of the text`).toBeGreaterThanOrEqual(0)
      expect(tag.right, `${tag.label}: room right of the text`).toBeGreaterThanOrEqual(0)
    }
    expect(new Set(found.map((tag) => tag.width)).size, 'one width for every tag').toBe(1)
    // The longest label, Compilation, has the least room: 8px of padding and a 1px border each side, a little over the tracking.
    const longest = found.find((tag) => tag.label === 'Compilation')!
    expect(longest.left).toBeGreaterThanOrEqual(8)
    expect(longest.left).toBeLessThan(12)
  })

  test('under Quantum the tag is still a fixed 58px', async ({ page }) => {
    const title = `e2e kind tag quantum ${test.info().project.name} ${Date.now()}`
    id = await makeList(page.request, title)
    await open(page, 'quantum', title)

    expect((await tags(page)).map((tag) => tag.width)).toEqual([58, 58, 58, 58])
  })
})
