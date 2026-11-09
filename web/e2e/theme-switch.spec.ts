import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Switching the theme under an open app (Phase 49.7), in both engines and both directions. Home, a list over it and Settings over that are all
 * redrawn at once: the class and the skin attribute, the rows (46 / 47 and 32 / 32), the rail's placement at the same window width and the covered
 * tabs' cascade (37 / 74 and 40 / 80). What the open layers hold stays: the filter, a half-typed Add row, and the scroll position
 * (the same row at the top), also in a long list drawn as a window (400 rows, no blank rows). The switch is the window event the shell listens to
 * through Settings' THEME chips (49.8), as a person does it: the layer the switch is made in is Settings, so a list underneath is covered while it happens (the focus is in Settings, not in a row, so no focused row is asserted). Real writes on the dev server, removed in a `finally`.
 */
type ThemeName = 'quantum' | 'exzed'

const LOOK = {
  quantum: { exzedClass: false, skin: 'dark-orange', item: 46, group: 47, rise: [37, 74], rail: 'outside' },
  exzed: { exzedClass: true, skin: 'exzed-1d', item: 32, group: 32, rise: [40, 80], rail: 'inside' },
} as const

async function makeList(request: APIRequestContext, title: string, rows: number, groups: number) {
  const per = Math.ceil(rows / groups)
  const items = Array.from({ length: rows }, (_, n) => `  - { title: "Item ${String(n).padStart(3, '0')}", minutes: 30, group: "Group ${Math.floor(n / per) + 1}" }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${items.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

/** Opens the app in a theme at 1920 x 900, recording every `data-theme` the page has had, and the list in it. */
async function open(page: Page, theme: ThemeName, title: string) {
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
    const seen: (string | null)[] = []
    ;(window as unknown as { __themes: (string | null)[] }).__themes = seen
    new MutationObserver(() => seen.push(document.documentElement.getAttribute('data-theme'))).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] })
  }, Object.entries({ theme, skin: 'dark-orange', exzedSkin: 'exzed-1d', reducedMotion: 'true' }))
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
}

/**
 * Switches the theme the way a person does: in Settings, on the THEME chip. Opens Settings when it is not open and, with `close`, closes it again so the
 * layer under it is the one on top (the rail and the list's own state are read there); the 3-layer test keeps Settings open.
 */
async function switchTo(page: Page, theme: ThemeName, close = true) {
  const settings = page.locator('.q-settings')
  const wasOpen = (await settings.count()) > 0
  if (!wasOpen) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await settings.waitFor()
  }
  await settings.getByRole('button', { name: theme === 'exzed' ? 'eX-Zed' : 'Quantum', exact: true }).click()
  if (!wasOpen && close) {
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(settings).toHaveCount(0)
  }
}

const frames = (page: Page, count = 3) =>
  page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)))
        step(n)
      }),
    count,
  )

/** What is drawn now: the page's class and skin, the rows (layout heights: a covered layer is drawn smaller in Quantum) and the layers' cascade. */
const look = (page: Page) =>
  page.evaluate(() => {
    const height = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.offsetHeight ?? null
    const tops = Array.from(document.querySelectorAll('.q-layer')).map((layer) => layer.getBoundingClientRect().top)
    const [deepest, middle, front] = tops as [number, number, number]

    return {
      exzedClass: document.documentElement.classList.contains('theme-exzed'),
      skin: document.documentElement.getAttribute('data-theme'),
      item: height('.q-item'),
      group: height('.q-group'),
      layers: tops.length,
      rise: [front - middle, front - deepest],
    }
  })

/**
 * The first item in view below the group header that sticks to the top of the list's scroller, by its number (`Item 042` is 42), and the scroller's
 * position. A header is sticky, so the point at the top of the scroller always lands on it: the reader's row is the one under it.
 */
const topRow = (page: Page) =>
  page.evaluate(() => {
    const body = document.querySelector('.q-list-body') as HTMLElement
    const box = body.getBoundingClientRect()
    const stuck = Array.from(document.querySelectorAll<HTMLElement>('.q-group')).find((group) => Math.abs(group.getBoundingClientRect().top - box.top) <= 1)
    const below = box.top + (stuck?.offsetHeight ?? 0) - 0.5
    const first = Array.from(document.querySelectorAll<HTMLElement>('.q-item')).find((item) => item.getBoundingClientRect().top >= below)

    return { item: Number(/Item (\d{3})/.exec(first?.textContent ?? '')?.[1] ?? NaN), scrollTop: body.scrollTop }
  })

for (const [from, to] of [
  ['quantum', 'exzed'],
  ['exzed', 'quantum'],
] as const) {
  test.describe(`${from} to ${to}`, () => {
    let id = ''

    test.afterEach(async ({ page }) => {
      if (id) await page.request.delete(`/api/lists/${id}`)
      id = ''
    })

    test('Home, a list and Settings are all redrawn at once: class, skin, rows and cascade; the choice is stored', async ({ page }) => {
      const title = `e2e switch ${from} ${test.info().project.name} ${Date.now()}`
      id = await makeList(page.request, title, 60, 3)
      await open(page, from, title)
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.locator('.q-layer:not(.covered)').first().waitFor()

      const before = await look(page)
      expect(before).toEqual({ exzedClass: LOOK[from].exzedClass, skin: LOOK[from].skin, item: LOOK[from].item, group: LOOK[from].group, layers: 3, rise: LOOK[from].rise })

      await switchTo(page, to, false)
      await frames(page)

      expect(await look(page)).toEqual({ exzedClass: LOOK[to].exzedClass, skin: LOOK[to].skin, item: LOOK[to].item, group: LOOK[to].group, layers: 3, rise: LOOK[to].rise })
      expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(to)

      // The page never carried the other theme's skin key: the keys it had, in order, are the first theme's and then the second's.
      const history = await page.evaluate(() => (window as unknown as { __themes: (string | null)[] }).__themes)
      expect(history.filter((key, at) => key !== history[at - 1])).toEqual([LOOK[from].skin, LOOK[to].skin].filter((key, at, all) => key !== all[at - 1]))
    })

    test('the rail goes where the new theme’s card and gap leave room for it, at the same window width', async ({ page }) => {
      const title = `e2e switch rail ${from} ${test.info().project.name} ${Date.now()}`
      id = await makeList(page.request, title, 60, 3)
      await open(page, from, title)
      await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', LOOK[from].rail)

      await switchTo(page, to)

      await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', LOOK[to].rail)
    })

    test('the filter, a half-typed Add row and the place in the list survive the switch', async ({ page }) => {
      const title = `e2e switch state ${from} ${test.info().project.name} ${Date.now()}`
      id = await makeList(page.request, title, 60, 3)
      await open(page, from, title)

      await page.getByPlaceholder('Filter items…').fill('Item')
      await page.locator('.q-add-item').getByLabel('Title').fill('Half typed')
      const row = page.locator('.q-item', { hasText: 'Item 030' })
      await row.scrollIntoViewIfNeeded()
      await frames(page)
      const topBefore = await topRow(page)

      await switchTo(page, to)
      await frames(page)

      await expect(page.getByPlaceholder('Filter items…')).toHaveValue('Item')
      await expect(page.locator('.q-add-item').getByLabel('Title')).toHaveValue('Half typed')
      expect(Math.abs((await topRow(page)).item - topBefore.item), 'the same row is at the top of the list, give or take the row the sticky header covers').toBeLessThanOrEqual(1)
    })

    test('a long list drawn as a window (400 rows) holds across the switch: the same row at the top, no blank rows', async ({ page }) => {
      const title = `e2e switch window ${from} ${test.info().project.name} ${Date.now()}`
      id = await makeList(page.request, title, 400, 4)
      await open(page, from, title)
      const rowHeight = LOOK[from].item
      await page.evaluate((y) => ((document.querySelector('.q-list-body') as HTMLElement).scrollTop = y), rowHeight * 150)
      await frames(page)
      const topBefore = await topRow(page)
      expect(topBefore.scrollTop, 'the list is scrolled well down').toBeGreaterThan(rowHeight * 100)

      await switchTo(page, to)
      await frames(page, 6)

      expect(Math.abs((await topRow(page)).item - topBefore.item), 'the same row is at the top of the list, give or take the row the sticky header covers').toBeLessThanOrEqual(1)
      // Eight points down the scroller each land on a row or a group header: no spacer, no gap where rows should be.
      const blank = await page.evaluate(() => {
        const box = (document.querySelector('.q-list-body') as HTMLElement).getBoundingClientRect()

        return Array.from({ length: 8 }, (_, step) => {
          const y = box.top + 6 + ((box.height - 12) * step) / 7
          return document.elementFromPoint(box.x + box.width / 2, y)?.closest('.q-item, .q-group') ? null : Math.round(y)
        }).filter((y) => y !== null)
      })
      expect(blank, 'points with no row under them').toEqual([])
    })
  })
}
