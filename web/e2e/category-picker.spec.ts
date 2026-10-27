import { expect, test } from '@playwright/test'
import { en } from '../src/locale/en.js'
import { FIXTURE_LIST_ID, useHomeFixture } from './fixtures.js'

const picker = en.quantum.categoryPicker
const createList = en.quantum.createList

/**
 * The Category picker against the real `/api/media-types` registry (task
 * 10.11) — the RTL suite feeds it a hand-built registry, so it can't catch
 * the live registry disagreeing with the design handoff's own table.
 */
test('New List opens the picker, driven by the live registry rather than the handoff’s table', async ({
  page,
}) => {
  await useHomeFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()

  await expect(page.getByRole('heading', { name: picker.title })).toBeVisible()

  // Display labels come from the locale; the registry still says "TV Shows".
  const tvTile = page.locator('.q-tile', { hasText: 'TV Series' })
  const wrestlingTile = page.locator('.q-tile', { hasText: 'Pro Wrestling' })
  await expect(tvTile).toBeVisible()
  await expect(page.locator('.q-tile', { hasText: 'TV Shows' })).toHaveCount(0)

  // The handoff's table says Wrestling and MMA are "by hand"; the registry
  // has both on Wikipedia, and the registry wins.
  await expect(wrestlingTile.locator('.q-tile-src')).toHaveText('Wikipedia')
  await expect(page.locator('.q-tile', { hasText: 'MMA' }).locator('.q-tile-src')).toHaveText(
    'Wikipedia',
  )

  // The fixture list is a movie, so Movies alone shows a count chip.
  await expect(page.locator('.q-count-chip')).toHaveCount(1)
  await expect(page.locator('.q-tile.used .q-count-chip')).toHaveText('1')
})

/**
 * First run and New List are one screen (H-018, revised 2026-10-26): with lists, New List keeps the heading, the close button and the counts, and
 * also carries the List Vault shelf of three, but not Try A Sample List. The library is a fake answer (a real one needs the network); the lists come
 * from the home fixture.
 */
test('New List carries the List Vault shelf of three, no Try A Sample List, and a card opens a Preview and adds nothing (H-018)', async ({ page }) => {
  const categories = ['movie', 'tv', 'game', 'book', 'music', 'comic']
  const entries = categories.map((category) => ({ externalRef: `canonical:lists/${category}/nl.yaml`, title: `NL ${category}`, category, itemCount: 4 }))
  const items = Array.from({ length: 4 }, (_, index) => ({ title: `Entry ${index + 1}`, timeToConsumeMinutes: 30, year: 2000 }))
  const writes: string[] = []

  await useHomeFixture(page)
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries, reachable: true } }))
  await page.route('**/api/media-types/*/expansion**', (route) => route.fulfill({ json: { itemCount: 4, status: 'complete', items } }))
  await page.route('**/api/lists/from-source', (route) => {
    writes.push('from-source')

    return route.abort()
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()

  await expect(page.getByRole('heading', { name: picker.title })).toBeVisible()
  await expect(page.getByRole('button', { name: picker.closeLabel })).toBeVisible()
  await expect(page.getByText(en.quantum.vaultShelf.label)).toBeVisible()
  const cards = page.locator('.q-vault-card')
  await expect(cards).toHaveCount(3)
  const kinds = await cards.locator('.q-vault-meta').allTextContents()
  expect(new Set(kinds.map((meta) => meta.split(' · ')[0])).size).toBe(3)
  await expect(page.getByRole('button', { name: en.quantum.vaultShelf.trySample })).toHaveCount(0)

  await cards.first().click()
  await expect(page.locator('.q-preview-row')).toHaveCount(4)
  expect(writes).toEqual([])
})

/**
 * Browse List Vault (H-020, 36.3): the button on the shelf opens the browser, which opens with nothing selected, lets a category be picked and
 * closes with Esc back to the picker. The library is a fake answer (a real one needs the network).
 */
test('Browse List Vault opens the browser: a category column and an empty state, a pick is marked, Esc returns to New List (H-020)', async ({ page }) => {
  const entry = (category: string, n: number) => ({ externalRef: `canonical:lists/${category}/${n}.yaml`, title: `${category} ${n}`, category, itemCount: 4, tracked: false })
  const library = [entry('movie', 1), entry('movie', 2), entry('book', 1)]

  await useHomeFixture(page)
  // The shelf (and so the button) is drawn when the library has something to offer.
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [library[0]], reachable: true } }))
  await page.route('**/api/library', (route) => route.fulfill({ json: { entries: library, reachable: true } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await expect(page.getByRole('heading', { name: picker.title })).toBeVisible()

  await page.getByRole('button', { name: en.quantum.vaultShelf.browse }).click()

  const vault = en.quantum.vaultBrowser
  await expect(page.getByRole('heading', { level: 1, name: vault.title })).toBeVisible()
  await expect(page.getByText(vault.chooseTitle)).toBeVisible()
  await expect(page.getByText(vault.chooseLine(3, 2))).toBeVisible()
  // The centred line keeps a short measure (design, H-021); the subline above has no cap.
  await expect(page.locator('.q-vb-empty-line')).toHaveCSS('max-width', '440px')
  await expect(page.locator('.q-vb-sub')).toHaveCSS('max-width', 'none')
  const column = page.getByRole('navigation', { name: vault.categoriesLabel })
  await expect(column.getByRole('button').first()).toBeVisible()
  // Every category the registry has, the ones with no lists disabled.
  expect(await column.getByRole('button').count()).toBeGreaterThan(8)
  await expect(column.locator('[aria-disabled="true"]').first()).toBeVisible()

  await column.getByRole('button', { name: /^Movies/ }).click()
  await expect(column.getByRole('button', { name: /^Movies/ })).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.q-vb-caption')).toHaveText(vault.caption('Movies', 2))

  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { level: 1, name: vault.title })).toBeHidden()
  await expect(page.getByRole('heading', { name: picker.title })).toBeVisible()
})

/**
 * The table of a category (H-020, 36.4), measured after the layer has stopped moving: a number column's header ends on its numbers' right edge,
 * the 56px Items cell holds 50,000 and the 64px Time cell the longest list, and the name ellipsises before the In My Lists chip.
 */
test('the browser table keeps its columns: headers end on the numbers, 50,000 items and a 2,271 h list fit, the name gives way before the chip (H-020)', async ({ page }) => {
  const long = 'A very long list name that cannot possibly fit in the name column of the table at this width, '.repeat(3)
  const big = { externalRef: 'canonical:lists/movie/big.yaml', title: long, category: 'movie', itemCount: 50_000, totalMinutes: 5_999_940, minutesEstimated: true, status: 'ongoing', tracked: true }
  const ufc = { externalRef: 'canonical:lists/movie/ufc.yaml', title: 'All UFC Events', category: 'movie', itemCount: 757, totalMinutes: 136_260, minutesEstimated: true, tracked: false }

  await useHomeFixture(page)
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [ufc], reachable: true } }))
  await page.route('**/api/library', (route) => route.fulfill({ json: { entries: [big, ufc], reachable: true } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.getByRole('button', { name: en.quantum.vaultShelf.browse }).click()
  await page.getByRole('navigation', { name: en.quantum.vaultBrowser.categoriesLabel }).getByRole('button', { name: /^Movies/ }).click()
  await page.waitForFunction(() => document.getAnimations().length === 0)

  const rows = page.locator('.q-vb-row')
  await expect(rows).toHaveCount(2)
  // The heading keeps its size beside the rows' own styles (a shared class name once shrank it to the rows' 14.5px).
  await expect(page.getByRole('heading', { level: 1, name: en.quantum.vaultBrowser.title })).toHaveCSS('font-size', '24px')

  // Each number header ends where its numbers end, sorted or not.
  const edges = async () =>
    page.evaluate(() => {
      const right = (el: Element | null) => Math.round(el!.getBoundingClientRect().right)
      const rowEl = document.querySelector('.q-vb-row')!
      return {
        itemsHeader: right(document.querySelector('.q-vb-colhead:nth-child(3) .q-vb-collabel')),
        itemsCell: right(rowEl.querySelector('.q-vb-items')),
        timeHeader: right(document.querySelector('.q-vb-colhead:nth-child(4) .q-vb-collabel')),
        timeCell: right(rowEl.querySelector('.q-vb-time')),
      }
    })
  const unsorted = await edges()
  expect(Math.abs(unsorted.itemsHeader - unsorted.itemsCell)).toBeLessThanOrEqual(1)
  expect(Math.abs(unsorted.timeHeader - unsorted.timeCell)).toBeLessThanOrEqual(1)
  await page.getByRole('columnheader', { name: en.quantum.vaultBrowser.columns.items }).getByRole('button').click()
  const sorted = await edges()
  expect(Math.abs(sorted.itemsHeader - sorted.itemsCell)).toBeLessThanOrEqual(1)

  // The cells hold the biggest numbers the library can have.
  const fits = await page.evaluate(() =>
    [...document.querySelectorAll('.q-vb-items, .q-vb-time')].map((cell) => ({ text: cell.textContent, over: cell.scrollWidth > cell.clientWidth })),
  )
  expect(fits.map((cell) => cell.text)).toContain('50000')
  expect(fits.map((cell) => cell.text)).toContain('≈99999h')
  for (const cell of fits) expect(cell.over, cell.text ?? '').toBe(false)

  // The long name is cut with an ellipsis; the chip is whole and stays inside the row.
  const cut = await page.evaluate(() => {
    const title = [...document.querySelectorAll('.q-vb-rowname')].find((el) => el.scrollWidth > el.clientWidth)
    const chip = document.querySelector('.q-vb-mine')!.getBoundingClientRect()
    const nameCell = document.querySelector('.q-vb-nm')!.getBoundingClientRect()
    return { clipped: Boolean(title), chipInside: chip.right <= nameCell.right + 0.5 && chip.width > 40 }
  })
  expect(cut).toEqual({ clipped: true, chipInside: true })
})

/**
 * A row opens the standard List Preview (H-020, 36.5): Esc comes back with the category and the sort as they were, nothing is added before Add This List,
 * and a list the person already has opens as Open My List instead.
 */
test('a row opens the List Preview, Esc returns to the same category and sort, and nothing is added before Add This List (H-020)', async ({ page }) => {
  const entry = (n: number, extra: object = {}) => ({ externalRef: `canonical:lists/movie/${n}.yaml`, title: `Movie list ${n}`, category: 'movie', itemCount: 4 * n, tracked: false, ...extra })
  const items = Array.from({ length: 4 }, (_, index) => ({ title: `Entry ${index + 1}`, timeToConsumeMinutes: 30, year: 2000 }))
  const writes: string[] = []

  await useHomeFixture(page)
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [entry(1)], reachable: true } }))
  await page.route('**/api/library', (route) => route.fulfill({ json: { entries: [entry(1), entry(2), entry(3)], reachable: true } }))
  await page.route('**/api/media-types/*/expansion**', (route) => route.fulfill({ json: { itemCount: 4, status: 'complete', items } }))
  await page.route('**/api/lists/from-source', (route) => {
    writes.push('from-source')

    return route.abort()
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.getByRole('button', { name: en.quantum.vaultShelf.browse }).click()
  const vault = en.quantum.vaultBrowser
  await page.getByRole('navigation', { name: vault.categoriesLabel }).getByRole('button', { name: /^Movies/ }).click()
  await page.getByRole('columnheader', { name: vault.columns.items }).getByRole('button').click()
  await expect(page.locator('.q-vb-rowname').first()).toHaveText('Movie list 3')

  await page.locator('.q-vb-row', { hasText: 'Movie list 2' }).click()

  await expect(page.getByRole('heading', { level: 1, name: /Movie list 2/ })).toBeVisible()
  await expect(page.locator('.q-preview-row')).toHaveCount(4)
  expect(writes).toEqual([])

  await page.keyboard.press('Escape')

  await expect(page.getByRole('heading', { level: 1, name: vault.title })).toBeVisible()
  await expect(page.getByRole('navigation', { name: vault.categoriesLabel }).getByRole('button', { name: /^Movies/ })).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('columnheader', { name: vault.columns.items })).toHaveAttribute('aria-sort', 'descending')
  await expect(page.locator('.q-vb-rowname').first()).toHaveText('Movie list 3')
  expect(writes).toEqual([])

  // Enter on a focused row opens it too, and Add This List from here is the first and only write.
  await page.locator('.q-vb-row', { hasText: 'Movie list 1' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: en.quantum.preview.addButton }).click()

  await expect.poll(() => writes).toEqual(['from-source'])
})

test('a list the person already has opens from its row as Open My List, which opens that list and adds no copy (H-020)', async ({ page }) => {
  const mine = { externalRef: 'canonical:lists/movie/mine.yaml', title: 'Already mine', category: 'movie', itemCount: 4, tracked: true, trackedListId: FIXTURE_LIST_ID }
  const items = Array.from({ length: 4 }, (_, index) => ({ title: `Entry ${index + 1}`, timeToConsumeMinutes: 30, year: 2000 }))
  const writes: string[] = []

  await useHomeFixture(page)
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.route('**/api/library', (route) => route.fulfill({ json: { entries: [mine], reachable: true } }))
  await page.route('**/api/media-types/*/expansion**', (route) => route.fulfill({ json: { itemCount: 4, status: 'complete', items } }))
  await page.route('**/api/lists/from-source', (route) => {
    writes.push('from-source')

    return route.abort()
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  // Every library list is already tracked: the shelf has no cards, and the button is still there.
  await page.getByRole('button', { name: en.quantum.vaultShelf.browse }).click()
  const vault = en.quantum.vaultBrowser
  await page.getByRole('navigation', { name: vault.categoriesLabel }).getByRole('button', { name: /^Movies/ }).click()
  await expect(page.locator('.q-vb-mine')).toHaveText(en.quantum.vaultBrowser.inMyLists)

  await page.locator('.q-vb-row').click()
  await expect(page.getByRole('button', { name: en.quantum.preview.addButton })).toHaveCount(0)
  const opened = page.waitForRequest((request) => request.url().endsWith(`/api/lists/${FIXTURE_LIST_ID}`))
  await page.getByRole('button', { name: en.quantum.preview.openMyList }).click()

  await opened
  expect(writes).toEqual([])
})

/**
 * The browser from the keyboard, as in a file manager (H-020, 36.6): ↑/↓/Home/End move in either pane and the column selects as it moves,
 * → crosses to the first row and ← back, Enter opens a row, and Tab goes ✕, column, header row, rows.
 */
test('the browser works from the keyboard: arrows and Home/End in both panes, → and ← between them, Enter opens, Tab goes ✕, column, headers, rows (H-020)', async ({ page, browserName }) => {
  const entry = (category: string, n: number) => ({ externalRef: `canonical:lists/${category}/${n}.yaml`, title: `${category} list ${n}`, category, itemCount: n, tracked: false })
  const library = [entry('movie', 1), entry('movie', 2), entry('movie', 3), entry('book', 1)]
  const items = Array.from({ length: 4 }, (_, index) => ({ title: `Entry ${index + 1}`, timeToConsumeMinutes: 30, year: 2000 }))

  await useHomeFixture(page)
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [library[0]], reachable: true } }))
  await page.route('**/api/library', (route) => route.fulfill({ json: { entries: library, reachable: true } }))
  await page.route('**/api/media-types/*/expansion**', (route) => route.fulfill({ json: { itemCount: 4, status: 'complete', items } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.getByRole('button', { name: en.quantum.vaultShelf.browse }).click()

  const vault = en.quantum.vaultBrowser
  const column = page.getByRole('navigation', { name: vault.categoriesLabel })
  const active = () => page.evaluate(() => (document.activeElement as HTMLElement).textContent ?? '')
  // The column: the first key press selects, skipping every category with no lists (all but Books and Movies).
  await column.getByRole('button', { name: /^Books/ }).click()
  await expect(column.getByRole('button', { name: /^Books/ })).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(column.getByRole('button', { name: /^Movies/ })).toBeFocused()
  await expect(column.getByRole('button', { name: /^Movies/ })).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('ArrowUp')
  await expect(column.getByRole('button', { name: /^Books/ })).toBeFocused()
  await page.keyboard.press('End')
  await expect(column.getByRole('button', { name: /^Movies/ })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(column.getByRole('button', { name: /^Books/ })).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('End')

  // The rows: → crosses, ↑/↓/Home/End move, ← comes back to the selected category.
  const rows = page.locator('.q-vb-row')
  await page.keyboard.press('ArrowRight')
  await expect(rows.first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  expect(await active()).toContain('movie list 2')
  await page.keyboard.press('End')
  expect(await active()).toContain('movie list 3')
  await page.keyboard.press('Home')
  expect(await active()).toContain('movie list 1')
  await page.keyboard.press('ArrowLeft')
  await expect(column.getByRole('button', { name: /^Movies/ })).toBeFocused()

  // The names a screen reader gets: the table is a group named by its caption.
  await expect(page.getByRole('group', { name: vault.caption('Movies', 3) })).toBeVisible()

  // Enter on a row opens its Preview.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: /movie list 1/ })).toBeVisible()
  await page.keyboard.press('Escape')

  // Tab: ✕ first, then the column, then the header row, then the rows. Safari does not Tab onto buttons unless the system asks it to, so this
  // part runs in Chromium; the order itself is the page's order, which the component test reads in every engine.
  if (browserName !== 'chromium') return
  await page.getByRole('button', { name: vault.closeLabel }).focus()
  const kind = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      return el.matches('[data-vcat]') ? 'category' : el.classList.contains('q-vb-sort') ? 'header' : el.classList.contains('q-vb-row') ? 'row' : 'other'
    })
  // One stop for the column (the selected category), the four sort headers, one stop for the rows (roving tabindex, design 2026-10-27).
  const seen: string[] = []
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('Tab')
    seen.push(await kind())
  }
  expect(seen).toEqual(['category', 'header', 'header', 'header', 'header', 'row'])
  await expect(column.getByRole('button', { name: /^Movies/ })).toHaveAttribute('tabindex', '0')
})

test('Browse List Vault says the library is out of reach, and Try Again fills the browser in place (H-020)', async ({ page }) => {
  let reachable = false
  const entries = [{ externalRef: 'canonical:lists/book/a.yaml', title: 'A', category: 'book', itemCount: 4, tracked: false }]

  await useHomeFixture(page)
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: false } }))
  await page.route('**/api/library', (route) => route.fulfill({ json: reachable ? { entries, reachable: true } : { entries: [], reachable: false } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.getByRole('button', { name: en.quantum.vaultShelf.browse }).click()

  const vault = en.quantum.vaultBrowser
  await expect(page.getByText(vault.outTitle)).toBeVisible()
  reachable = true
  await page.getByRole('button', { name: vault.tryAgain }).click()

  await expect(page.getByText(vault.chooseTitle)).toBeVisible()
  await expect(page.getByText(vault.outTitle)).toBeHidden()
})

test('the web build never shows “Free key needed”, and every tile keeps a 20px bottom row so the source names stay level (H-018)', async ({ page }) => {
  await useHomeFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await expect(page.getByRole('heading', { name: picker.title })).toBeVisible()
  // The layer drums in with a transform; measure when it has stopped.
  await page.waitForFunction(() => document.getAnimations().length === 0)

  // Keys are the server's business here: there is no chip, whatever the registry says about a source.
  await expect(page.locator('.q-key-chip')).toHaveCount(0)

  const feet = await page.locator('.q-tile').evaluateAll((tiles) =>
    tiles.map((tile) => {
      const foot = tile.querySelector('.q-tile-foot')!.getBoundingClientRect()
      const box = tile.getBoundingClientRect()
      return { height: foot.height, fromBottom: Math.round(box.bottom - foot.bottom) }
    }),
  )
  expect(feet.length).toBeGreaterThan(5)
  for (const foot of feet) expect(foot.height).toBeGreaterThanOrEqual(20)
  // Level: every tile's bottom row is the same distance from its tile's bottom edge (its padding and border).
  expect(new Set(feet.map((foot) => foot.fromBottom)).size).toBe(1)
})

test('a “Free key needed” chip fits the tile’s bottom row: at its right, level with the source name, without making the row taller than the others (H-018)', async ({ page }) => {
  await useHomeFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await expect(page.getByRole('heading', { name: picker.title })).toBeVisible()

  await page.waitForFunction(() => document.getAnimations().length === 0)

  // The desktop app is what draws the chip; the CSS is the same everywhere, so put one in by hand and measure.
  const read = await page.evaluate((label) => {
    const tiles = [...document.querySelectorAll('.q-tile')]
    const foot = tiles[0]!.querySelector('.q-tile-foot')!
    const before = foot.getBoundingClientRect().height
    const chip = document.createElement('span')
    chip.className = 'q-key-chip'
    chip.textContent = label
    foot.appendChild(chip)
    const box = foot.getBoundingClientRect()
    const chipBox = chip.getBoundingClientRect()
    const src = foot.querySelector('.q-tile-src')!.getBoundingClientRect()
    const other = tiles[1]!.querySelector('.q-tile-foot')!.getBoundingClientRect().height
    const style = getComputedStyle(chip)

    return {
      before,
      after: box.height,
      other,
      chipRight: Math.round(box.right - chipBox.right),
      chipHeight: chipBox.height,
      centreGap: Math.abs(chipBox.top + chipBox.height / 2 - (src.top + src.height / 2)),
      font: `${style.fontWeight} ${style.fontSize}`,
      upper: style.textTransform,
      border: style.borderTopWidth,
    }
  }, picker.keyNeeded)

  expect(read.before).toBeGreaterThanOrEqual(20)
  // The row grows by no more than the chip's half pixel over its 20px minimum.
  expect(read.after - read.before).toBeLessThanOrEqual(1)
  expect(Math.abs(read.after - read.other)).toBeLessThanOrEqual(1)
  expect(read.chipRight).toBe(0)
  expect(read.centreGap).toBeLessThanOrEqual(1)
  expect([read.font, read.upper, read.border]).toEqual(['500 10.5px', 'uppercase', '1px'])
})

test('a tile’s source name and the count chip are in the mono font, as designed (the stylesheet named a token that does not exist)', async ({ page }) => {
  await useHomeFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await expect(page.getByRole('heading', { name: picker.title })).toBeVisible()

  const read = await page.evaluate(() => {
    const look = (selector: string) => {
      const style = getComputedStyle(document.querySelector(selector)!)
      return { family: style.fontFamily, size: style.fontSize }
    }
    return { src: look('.q-tile-src'), count: look('.q-count-chip') }
  })

  expect(read.src.family).toContain('JetBrains Mono')
  expect(read.src.size).toBe('12px')
  expect(read.count.family).toContain('JetBrains Mono')
  expect(read.count.size).toBe('12px')
})

test('picking a tile opens the Create layer for that category, Esc returns to the picker, and Close returns to Home', async ({
  page,
}) => {
  await useHomeFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible()

  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: 'Pro Wrestling' }).click()

  await expect(page.getByRole('heading', { name: createList.title('Pro Wrestling') })).toBeVisible()
  // The Search tab no longer names its source (the field under it does).
  await expect(page.getByRole('tab', { name: createList.searchTab('Wikipedia') })).toBeVisible()

  // Esc pops one layer — back to the picker, not all the way home.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: picker.title })).toBeVisible()
  await expect(page.getByRole('heading', { name: createList.title('Pro Wrestling') })).toBeHidden()
})
