import { expect, test } from '@playwright/test'
import { en } from '../src/locale/en.js'
import { useHomeFixture } from './fixtures.js'

/**
 * The List Vault browser's category column (H-020, revised by the owner 2026-10-27): as wide as its longest row (not 220px) between 160px and
 * 300px, the same whatever is selected, and each count a small chip right after the name, not at the column's edge. Measured in a real browser.
 */
const LONG_NAME = 'An extraordinarily long category name that cannot possibly fit in the column'

const entry = (category: string, n: number) => ({ externalRef: `canonical:lists/${category}/${n}.yaml`, title: `${category} ${n}`, category, itemCount: 4, tracked: false })

async function openBrowser(page: import('@playwright/test').Page, withLongCategory = false, everyCategoryHasLists = false) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await useHomeFixture(page)
  const keys = everyCategoryHasLists ? ((await (await page.request.get('/api/media-types')).json()) as Array<{ key: string }>).map((type) => type.key) : []
  const library = [
    ...Array.from({ length: 12 }, (_, n) => entry('book', n)),
    ...Array.from({ length: 5 }, (_, n) => entry('movie', n)),
    // Every category with a list: the widest row can then be selected.
    ...keys.filter((key) => key !== 'book' && key !== 'movie').map((key) => entry(key, 0)),
  ]
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [library[0]], reachable: true } }))
  await page.route('**/api/library', (route) => route.fulfill({ json: { entries: library, reachable: true } }))
  if (withLongCategory) {
    await page.route('**/api/media-types', async (route) => {
      const response = await route.fetch()
      const types = (await response.json()) as Array<Record<string, unknown>>
      await route.fulfill({ json: [...types, { ...types[0], key: 'zzlong', label: LONG_NAME, sortOrder: 999 }] })
    })
  }
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.getByRole('button', { name: en.quantum.vaultShelf.browse }).click()
  await page.locator('.q-vb-count').first().waitFor()
  await page.waitForFunction(() => document.getAnimations().length === 0)
  await expect(page.locator('.q-vb-count', { hasText: '12' })).toBeVisible()
}

/** What the column and each of its rows measure, in pixels. */
const measure = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const column = document.querySelector('.q-vb-column') as HTMLElement
    const rows = [...column.querySelectorAll<HTMLElement>('.q-vb-cat')].map((row) => {
      const name = row.querySelector('.q-vb-name') as HTMLElement
      const count = row.querySelector('.q-vb-count') as HTMLElement
      const style = getComputedStyle(row)
      return {
        text: name.textContent,
        padLeft: parseFloat(style.paddingLeft),
        padRight: parseFloat(style.paddingRight),
        nameLeft: name.getBoundingClientRect().left,
        nameRight: name.getBoundingClientRect().right,
        nameClipped: name.scrollWidth > name.clientWidth + 1,
        countLeft: count.getBoundingClientRect().left,
        countRight: count.getBoundingClientRect().right,
        rowRight: row.getBoundingClientRect().right,
      }
    })

    return { width: column.getBoundingClientRect().width, clientWidth: column.clientWidth, rows }
  })

test('the column is as wide as its longest row, between 160px and 300px, and not 220px (H-020)', async ({ page }) => {
  await openBrowser(page)

  const { width, rows } = await measure(page)

  expect(width).toBeGreaterThanOrEqual(160)
  expect(width).toBeLessThanOrEqual(300)
  expect(Math.abs(width - 220), 'it was a fixed 220px').toBeGreaterThan(2)
  // The longest row fills it: its chip ends at the row's right padding.
  const fullest = rows.reduce((best, row) => (row.countRight > best.countRight ? row : best))
  expect(Math.abs(fullest.rowRight - fullest.padRight - fullest.countRight)).toBeLessThanOrEqual(2)
})

test('selecting a category does not change the column, not even the widest row, whose name turns bold (H-020)', async ({ page }) => {
  await openBrowser(page, false, true)
  const before = await measure(page)
  // The widest row decides the width: its name is the one that would make the column grow when it is bold.
  const widest = before.rows.reduce((best, row) => (row.nameRight - row.nameLeft > best.nameRight - best.nameLeft ? row : best))

  await page.locator('.q-vb-cat', { hasText: widest.text! }).first().click()
  await expect(page.locator('.q-vb-cat.on')).toHaveCount(1)
  const afterWidest = (await measure(page)).width
  await page.locator('.q-vb-cat', { hasText: 'Books' }).click()
  const afterBooks = (await measure(page)).width

  expect(Math.abs(afterWidest - before.width), `selecting ${widest.text}`).toBeLessThanOrEqual(0.5)
  expect(Math.abs(afterBooks - before.width)).toBeLessThanOrEqual(0.5)
})

test('each count is a small chip right after the name, 8px away, not at the column\'s edge (H-020)', async ({ page }) => {
  await openBrowser(page)

  const { rows } = await measure(page)
  const shortest = rows.reduce((best, row) => (row.nameRight < best.nameRight ? row : best))

  // A short name's chip sits next to it, not pushed to the far right.
  expect(Math.abs(shortest.countLeft - shortest.nameRight - 8)).toBeLessThanOrEqual(1.5)
  expect(shortest.rowRight - shortest.padRight - shortest.countRight, 'room to the right of a short name\'s chip').toBeGreaterThan(8)

  const chip = await page.locator('.q-vb-count', { hasText: '12' }).evaluate((element) => {
    const style = getComputedStyle(element)
    return { border: style.borderTopWidth, size: style.fontSize, weight: style.fontWeight, padTop: style.paddingTop, padLeft: style.paddingLeft, tabular: style.fontVariantNumeric }
  })
  expect(chip).toMatchObject({ border: '1px', size: '11px', weight: '600', padTop: '3px', padLeft: '6px' })
  expect(chip.tabular).toContain('tabular-nums')
})

test('the selected row\'s chip takes the rule border and the ink text; a zero chip is ink3 (H-020)', async ({ page }) => {
  await openBrowser(page)
  const colours = () =>
    page.evaluate(() => {
      const of = (row: Element) => {
        const chip = row.querySelector('.q-vb-count') as HTMLElement
        const style = getComputedStyle(chip)
        return { border: style.borderTopColor, color: style.color }
      }
      const probe = document.createElement('span')
      document.body.append(probe)
      const resolve = (variable: string) => {
        probe.style.color = `var(${variable})`

        return getComputedStyle(probe).color
      }
      const result = {
        ink: resolve('--ink'),
        ink2: resolve('--ink2'),
        ink3: resolve('--ink3'),
        books: of([...document.querySelectorAll('.q-vb-cat')].find((row) => row.textContent?.includes('Books'))!),
        games: of([...document.querySelectorAll('.q-vb-cat')].find((row) => row.textContent?.includes('Games'))!),
      }
      probe.remove()

      return result
    })

  const before = await colours()
  expect(before.books.color).toBe(before.ink2)
  expect(before.games.color, 'a category with no lists').toBe(before.ink3)

  await page.locator('.q-vb-cat', { hasText: 'Books' }).click()
  const after = await colours()

  expect(after.books.color).toBe(after.ink)
  expect(after.books.border, 'the selected chip\'s border is stronger than the others\'').not.toBe(before.books.border)
})

test('a name too long for 300px is cut with an ellipsis and its count stays whole (H-020)', async ({ page }) => {
  await openBrowser(page, true)

  const { width, rows } = await measure(page)
  const long = rows.find((row) => row.text === LONG_NAME)!

  expect(Math.abs(width - 300)).toBeLessThanOrEqual(1.5)
  expect(long.nameClipped, 'the name is cut').toBe(true)
  expect(long.countRight, 'the count is inside the row').toBeLessThanOrEqual(long.rowRight - long.padRight + 1)
  expect(long.countRight - long.countLeft, 'the chip keeps its width').toBeGreaterThan(14)
})
