import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * A long list draws only a window of its rows (Phase 25.2, BACKLOG BL-074), in a real browser: the page holds a screenful of rows and a
 * spacer for the rest, the scroll height is the whole list's, the sticky group header stays, and the row heights the window assumes (46 and
 * 47px) are the real ones. Real writes on the dev server, removed in a `finally`.
 */
const ITEM = 46
const GROUP = 47

async function makeList(request: APIRequestContext, title: string, rows: string[]) {
  const yaml = `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n`
  const made = await request.post('/api/lists/from-file', { data: { yaml } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

const loose = (count: number) => Array.from({ length: count }, (_, n) => `  - { title: "Issue ${n}", minutes: 30 }`)

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
}

const scrollTo = (page: Page, top: number) =>
  page.evaluate(async (y) => {
    const body = document.querySelector('.q-list-body') as HTMLElement
    body.scrollTop = y
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  }, top)

test('a list of 5,000 items draws a screenful of rows, is as tall as the whole list, and reaches its last row and the Add row', async ({ page }) => {
  const title = `e2e list-window loose ${Date.now()}`
  const id = await makeList(page.request, title, loose(5000))
  const shortTitle = `e2e list-window short ${Date.now()}`
  const shortId = await makeList(page.request, shortTitle, loose(120))

  try {
    await openList(page, title)
    const drawn = () => page.locator('.q-item').count()

    expect(await drawn()).toBeGreaterThan(10)
    expect(await drawn()).toBeLessThan(120)
    await expect(page.getByText('Issue 4999', { exact: true })).toHaveCount(0)

    await scrollTo(page, 10_000_000)
    await expect(page.getByText('Issue 4999', { exact: true })).toBeVisible()
    await expect(page.locator('.q-add-item')).toBeVisible()
    expect(await drawn()).toBeLessThan(120)
    // The scroll height is the rows' height and what follows them (the Add row, the padding): the same "what follows" as a short list that
    // draws every row. 5,000 rows are 230,000px: the spacers and the drawn rows add up to it.
    const extra = (count: number) => page.evaluate((rows) => (document.querySelector('.q-list-body') as HTMLElement).scrollHeight - rows, count)
    const longExtra = await extra(5000 * ITEM)
    expect(longExtra).toBeGreaterThan(0)
    expect(longExtra).toBeLessThan(400)

    await page.goto('/')
    await page.locator('.q-home-row', { hasText: shortTitle }).click()
    await page.locator('.q-item').first().waitFor()
    expect(await page.locator('.q-item').count()).toBe(120)
    const shortExtra = await extra(120 * ITEM)
    expect(Math.abs(longExtra - shortExtra)).toBeLessThanOrEqual(1)
    await openList(page, title)
    await scrollTo(page, 2000 * ITEM)

    // The middle: the rows at the centre of the scroller are real rows, not a blank spacer.
    await scrollTo(page, 2000 * ITEM)
    const underCentre = await page.evaluate(() => {
      const body = document.querySelector('.q-list-body') as HTMLElement
      const rect = body.getBoundingClientRect()
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('.q-item') !== null
    })
    expect(underCentre).toBe(true)
    await expect(page.getByText('Issue 2000', { exact: true })).toBeVisible()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
    await page.request.delete(`/api/lists/${shortId}`)
  }
})

test('a group header stays stuck at the top while its block is in view, however far into a 3,000-item group', async ({ page }) => {
  const title = `e2e list-window group ${Date.now()}`
  const rows = [...loose(5).map((row) => row), ...Array.from({ length: 3000 }, (_, n) => `  - { title: "Vol ${n}", minutes: 30, group: "Big volume" }`)]
  const id = await makeList(page.request, title, rows)

  try {
    await openList(page, title)
    await scrollTo(page, 5 * ITEM + GROUP + 1500 * ITEM)

    const header = page.locator('.q-group', { hasText: 'Big volume' })
    await expect(header).toBeVisible()
    const { headerTop, bodyTop } = await page.evaluate(() => ({
      headerTop: (document.querySelector('.q-group') as HTMLElement).getBoundingClientRect().top,
      bodyTop: (document.querySelector('.q-list-body') as HTMLElement).getBoundingClientRect().top,
    }))
    expect(Math.abs(headerTop - bodyTop)).toBeLessThanOrEqual(1)
    await expect(page.getByText('Vol 1500', { exact: true })).toBeVisible()
    expect(await page.locator('.q-item').count()).toBeLessThan(120)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the row heights the window assumes are the real ones: 46px for an item, 47px for a group header, open, shut and while filtering', async ({ page }) => {
  const title = `e2e list-window heights ${Date.now()}`
  const rows = [
    '  - { title: "Loose", minutes: 30 }',
    ...Array.from({ length: 3 }, (_, n) => `  - { title: "One ${n}", minutes: 30, group: "First" }`),
    ...Array.from({ length: 3 }, (_, n) => `  - { title: "Two ${n}", minutes: 30, group: "Second" }`),
  ]
  const id = await makeList(page.request, title, rows)

  try {
    await openList(page, title)
    const heights = () =>
      page.evaluate(() => ({
        items: [...document.querySelectorAll('.q-item')].map((node) => (node as HTMLElement).offsetHeight),
        groups: [...document.querySelectorAll('.q-group')].map((node) => (node as HTMLElement).offsetHeight),
      }))

    let seen = await heights()
    expect(new Set(seen.items.map(Math.round))).toEqual(new Set([ITEM]))
    expect(new Set(seen.groups.map(Math.round))).toEqual(new Set([GROUP]))

    // Shut one group: its header is as tall as an open one.
    await page.locator('.q-group', { hasText: 'First' }).click()
    seen = await heights()
    expect(new Set(seen.groups.map(Math.round))).toEqual(new Set([GROUP]))

    // Filtering adds "2 of 3" to the header: it must not change its height.
    await page.getByPlaceholder('Filter items…').fill('Two 1')
    await expect(page.locator('.q-item')).toHaveCount(1)
    seen = await heights()
    expect(new Set(seen.groups.map(Math.round))).toEqual(new Set([GROUP]))
    expect(new Set(seen.items.map(Math.round))).toEqual(new Set([ITEM]))
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('ticking a row of a long list works at the bottom of it as at the top', async ({ page }) => {
  const title = `e2e list-window tick ${Date.now()}`
  const id = await makeList(page.request, title, loose(1000))

  try {
    await openList(page, title)
    await scrollTo(page, 10_000_000)

    await page.locator('.q-item', { hasText: 'Issue 999' }).click()

    await expect(page.locator('.q-item.is-done', { hasText: 'Issue 999' })).toBeVisible()
    const detail = await (await page.request.get(`/api/lists/${id}`)).json()
    expect(detail.items.find((item: { title: string }) => item.title === 'Issue 999').consumedAt).not.toBeNull()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

/**
 * The window's arithmetic is only right while every row is exactly the height the model says (BL-074, 25.4 review): a row that grows by a
 * fraction of a pixel drifts the whole list (0.1px over 50,000 rows is 5,000px). Computed heights, not `offsetHeight` (which rounds), at the
 * display scalings a Windows laptop uses, with the content that could make a row taller: a title and a group name of hundreds of characters,
 * chips, a year, a note, an estimated length, a NEW marker, a done row, and a header being renamed.
 */
for (const scale of [1, 1.25, 1.5]) {
  test.describe(`at ${scale}x display scaling`, () => {
    test.use({ deviceScaleFactor: scale })

    test('every item row is exactly 46px and every group header exactly 47px, whatever they hold', async ({ page }) => {
      const title = `e2e list-window drift ${scale} ${Date.now()}`
      const made = await page.request.post('/api/lists', { data: { title, mediaType: 'game' } })
      const list = await made.json()
      const long = 'A very long title that keeps going '.repeat(9).trim()
      const longGroup = 'A group with a very long name '.repeat(10).trim()

      try {
        await page.request.post(`/api/lists/${list.id}/items/import`, {
          data: {
            source: 'manual',
            items: [
              { title: long, timeToConsumeMinutes: 95, group: 'Plain', tags: ['PC'], year: 2011, notes: 'A curator note' },
              { title: 'Many chips', group: 'Plain', tags: ['PC', 'Switch', 'PlayStation 5', 'Xbox Series X'], year: 1994 },
              { title: 'In a long group', timeToConsumeMinutes: 600, group: longGroup, tags: ['PC'] },
              { title: 'Loose, with a year', timeToConsumeMinutes: 61, year: 2024 },
            ],
          },
        })
        await page.request.post(`/api/lists/${list.id}/items/import`, {
          data: { source: 'import', arrived: true, items: [{ title: 'Arrived with a sync', timeToConsumeMinutes: 30, group: 'Plain' }] },
        })

        await page.goto('/')
        await page.locator('.q-home-row', { hasText: title }).click()
        await page.locator('.q-item').first().waitFor()
        await page.locator('.q-item', { hasText: 'Many chips' }).click()
        await expect(page.locator('.q-item.is-done', { hasText: 'Many chips' })).toBeVisible()
        await page.evaluate(async () => {
          await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
        })

        const exact = () =>
          page.evaluate(() => {
            const height = (node: Element) => parseFloat(getComputedStyle(node).height)
            return {
              items: [...document.querySelectorAll('.q-item')].map(height),
              groups: [...document.querySelectorAll('.q-group')].map(height),
            }
          })

        let seen = await exact()
        expect(seen.items.length).toBeGreaterThanOrEqual(5)
        expect([...new Set(seen.items)]).toEqual([ITEM])
        expect([...new Set(seen.groups)]).toEqual([GROUP])

        // A header being renamed has an input where the name was.
        await page.locator('.q-group', { hasText: 'Plain' }).locator('.q-group-rename').click()
        await expect(page.locator('.q-group-input')).toBeVisible()
        seen = await exact()
        expect([...new Set(seen.groups)]).toEqual([GROUP])
      } finally {
        await page.request.delete(`/api/lists/${list.id}`)
      }
    })
  })
}
