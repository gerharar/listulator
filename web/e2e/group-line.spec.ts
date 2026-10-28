import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The group triangle's line (canvas H-022), in a real browser, with the preference `markOpenGroups` switched on the way a web user does it:
 * the key in `localStorage`, set before the page loads (the desktop reads the same key from `preferences.json`). On, every group head in a
 * list and in the Preview shows a drawn triangle and a 1px line exactly 6px from its ink: left of ▼ when open (1 x 14), under ▶ when shut
 * (14 x 1). Off, the default, the head is today's glyph. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  const items = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].map((name, n) => ({
    title: name,
    timeToConsumeMinutes: 30,
    group: n < 3 ? 'Season 1' : 'Season 2',
  }))
  await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return list.id as string
}

const markOn = (page: Page) => page.addInitScript(() => localStorage.setItem('markOpenGroups', 'true'))

async function settled(page: Page) {
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-group').first().waitFor()
  await settled(page)
}

interface Mark {
  open: boolean
  tri: { left: number; right: number; top: number; bottom: number }
  rule: { left: number; right: number; top: number; bottom: number; width: number; height: number }
}

/** Every head's drawing and line, read in one evaluation so they belong to the same frame. */
const marks = (page: Page, head: string): Promise<Mark[]> =>
  page.evaluate((selector) => {
    const box = (node: Element) => {
      const r = node.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }

    return [...document.querySelectorAll(selector)].map((node) => ({
      open: node.getAttribute('aria-expanded') === 'true',
      tri: box(node.querySelector('.q-chev-tri')!),
      rule: box(node.querySelector('.q-chev-rule')!),
    }))
  }, head)

/** Open: the line stands left of the triangle's ink, 1 x 14. Shut: it lies under it, 14 x 1. Both 6px off the ink, centred on it. */
function expectSixPixels(found: Mark[], opens: boolean[]) {
  expect(found.map((mark) => mark.open)).toEqual(opens)
  for (const { open, tri, rule } of found) {
    if (open) {
      expect(tri.left - rule.right, 'open: line to ink').toBeCloseTo(6, 1)
      expect([rule.width, rule.height]).toEqual([1, 14])
      expect((rule.top + rule.bottom) / 2).toBeCloseTo((tri.top + tri.bottom) / 2, 1)
    } else {
      expect(rule.top - tri.bottom, 'shut: line to ink').toBeCloseTo(6, 1)
      expect([rule.width, rule.height]).toEqual([14, 1])
      expect((rule.left + rule.right) / 2).toBeCloseTo((tri.left + tri.right) / 2, 1)
    }
  }
}

test('off by default: a group head is the glyph, no drawing, no line', async ({ page }) => {
  const title = `e2e group-line off ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await openList(page, title)
    await expect(page.locator('.q-group .q-chev')).toHaveText(['▼', '▼'])
    await expect(page.locator('.q-chev-line, .q-chev-tri, .q-chev-rule')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('on: the line is 6px from the ink, left of ▼ open and under ▶ shut, after a click and after Collapse All', async ({ page }) => {
  const title = `e2e group-line on ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await markOn(page)
    await openList(page, title)
    await expect(page.locator('.q-group .q-chev')).toHaveCount(0)
    expectSixPixels(await marks(page, '.q-group'), [true, true])

    await page.locator('.q-group', { hasText: 'Season 1' }).click()
    await settled(page)
    expectSixPixels(await marks(page, '.q-group'), [false, true])

    await page.locator('.q-group', { hasText: 'Season 1' }).click()
    await settled(page)
    await page.locator('.q-fold').click()
    await settled(page)
    expectSixPixels(await marks(page, '.q-group'), [false, false])

    await page.locator('.q-fold').click()
    await settled(page)
    expectSixPixels(await marks(page, '.q-group'), [true, true])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the line follows the turn in 140ms, and jumps when the system asks for less motion', async ({ page }) => {
  const title = `e2e group-line motion ${Date.now()}`
  const id = await makeList(page.request, title)
  // The line moves four properties (left, top, width, height), so the computed value is a list: the set of its durations is what counts.
  const durations = (part: string) =>
    page.locator(`.q-group ${part}`).first().evaluate((node) => [...new Set(getComputedStyle(node).transitionDuration.split(', '))])

  try {
    await markOn(page)
    await openList(page, title)
    expect(await durations('.q-chev-rule')).toEqual(['0.14s'])
    expect(await durations('.q-chev-tri')).toEqual(['0.14s'])

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openList(page, title)
    await expect(page.locator('html')).toHaveAttribute('data-reduced', '')
    expect(await durations('.q-chev-rule')).toEqual(['0s'])
    expect(await durations('.q-chev-tri')).toEqual(['0s'])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the Preview’s group heads have the same line, open and shut', async ({ page }) => {
  const items = Array.from({ length: 8 }, (_, n) => ({ title: `Episode ${n}`, externalRef: `line:${n}`, timeToConsumeMinutes: 30, group: `Volume ${Math.floor(n / 4)}` }))
  await page.route('**/api/media-types/music/search**', (route) =>
    route.fulfill({ json: { sources: [{ externalRef: 'line-1', title: 'Line source', detail: 'Group · XX', itemCount: 8 }] } }),
  )
  await page.route('**/api/media-types/music/expansion**', (route) =>
    route.fulfill({ json: route.request().url().includes('items=true') ? { itemCount: 8, status: 'complete', items } : { itemCount: 8 } }),
  )

  await markOn(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: 'Music' }).click()
  await page.getByLabel('Search MusicBrainz or List Vault', { exact: true }).fill('line')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('.q-result').first().waitFor()
  await settled(page)
  await page.locator('.q-result').first().click()
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
  await page.locator('.q-preview-group').first().waitFor()
  await settled(page)

  await expect(page.locator('.q-preview-group .q-chev')).toHaveCount(0)
  expectSixPixels(await marks(page, '.q-preview-group'), [true, true])

  await page.locator('.q-preview-group', { hasText: 'Volume 0' }).click()
  await settled(page)
  expectSixPixels(await marks(page, '.q-preview-group'), [false, true])
})
