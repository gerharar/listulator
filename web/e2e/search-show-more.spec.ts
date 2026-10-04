import { expect, test, type Page } from '@playwright/test'
import { q, useHomeFixture } from './fixtures.js'

/**
 * The Search tab's "Show more" (owner's design `docs/design/search-show-more`, 5A) in a real engine: a search that
 * has more matches than it shows closes its list with the stop, Show more appends the next twenty under the rows
 * above, and the stop goes with the last page. The network is stubbed at the browser boundary, as in
 * `create-search.spec.ts`; the live path (a real Comic Vine search) is checked by hand.
 */
const volume = (n: number) => ({ externalRef: `volume:${n}`, title: `Batman (${1900 + n})`, detail: `${n} issues`, itemCount: n })
const volumes = (from: number, count: number) => Array.from({ length: count }, (_, index) => volume(from + index))

const PAGES: Record<string, object> = {
  '1': { sources: volumes(1, 20), hasMore: true, total: 52, totalIsLowerBound: true },
  '2': { sources: volumes(21, 20), hasMore: true, total: 52, totalIsLowerBound: true },
  '3': { sources: volumes(41, 12), total: 52 },
}

async function openComicSearch(page: Page) {
  await useHomeFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: q.home.newList }).click()
  await page.locator('.q-tile', { hasText: 'Comic' }).click()
  await expect(page.getByRole('heading', { name: /^New .* List$/ })).toBeVisible()
}

async function search(page: Page) {
  await page.getByLabel(q.search.queryLabel('Comic Vine'), { exact: true }).fill('batman')
  await page.getByRole('button', { name: q.search.searchButton, exact: true }).click()
}

const rows = (page: Page) => page.getByRole('button', { name: /^Show details for Batman/ })

test('a cut-off search says so, closes its list, and Show more appends twenty at a time until the last page', async ({
  page,
}) => {
  const searchUrls: string[] = []
  const expansions: string[] = []
  await page.route('**/api/media-types/comic/search**', (route) => {
    const url = new URL(route.request().url())
    searchUrls.push(url.search)
    return route.fulfill({ json: PAGES[url.searchParams.get('page') ?? '1'] })
  })
  await page.route('**/api/media-types/comic/expansion**', (route) => {
    expansions.push(route.request().url())
    return route.fulfill({ json: { itemCount: 1 } })
  })

  await openComicSearch(page)
  await search(page)

  // The header says the list is cut, and the stop closes it after the last row.
  await expect(page.getByText(q.search.more.count(20, 52, true))).toBeVisible()
  await expect(rows(page)).toHaveCount(20)
  await expect(page.getByText(q.search.more.caption(20))).toBeVisible()
  await expect(page.getByText(q.search.more.note)).toBeVisible()
  // Counts came with the search answer: no request for any of them.
  await expect(page.locator('.q-result .n', { hasText: '20' })).toHaveCount(1)
  expect(expansions).toEqual([])

  // Show more: twenty more under the rows above, and the stop moves down.
  await page.getByRole('button', { name: q.search.more.showMore, exact: true }).click()
  await expect(rows(page)).toHaveCount(40)
  await expect(page.getByText(q.search.more.count(40, 52, true))).toBeVisible()
  await expect(page.getByText(q.search.more.caption(40))).toBeVisible()
  await expect(page.getByText(q.search.more.caption(20))).toBeHidden()

  // The last page: twelve more, and the stop and the cut-off header go.
  await page.getByRole('button', { name: q.search.more.showMore, exact: true }).click()
  await expect(rows(page)).toHaveCount(52)
  await expect(page.getByText(q.search.resultsCount(52))).toBeVisible()
  await expect(page.getByText(q.search.more.note)).toBeHidden()
  await expect(page.getByRole('button', { name: q.search.more.showMore, exact: true })).toBeHidden()

  // The next pages were asked for by number, as the query that was searched.
  expect(searchUrls.map((search) => new URLSearchParams(search).get('page'))).toEqual([null, '2', '3'])
  expect(searchUrls.every((search) => new URLSearchParams(search).get('q') === 'batman')).toBe(true)
})

test('Show more keeps a row that is open open, and Refine search selects the query without clearing the results', async ({
  page,
}) => {
  await page.route('**/api/media-types/comic/search**', (route) =>
    route.fulfill({ json: PAGES[new URL(route.request().url()).searchParams.get('page') ?? '1'] }),
  )
  await page.route('**/api/media-types/comic/expansion**', (route) => route.fulfill({ json: { itemCount: 1 } }))

  await openComicSearch(page)
  await search(page)
  await expect(rows(page)).toHaveCount(20)

  const first = page.getByRole('button', { name: q.search.expandRow('Batman (1901)') })
  await first.click()
  await expect(first).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: q.search.more.showMore, exact: true }).click()
  await expect(rows(page)).toHaveCount(40)
  await expect(first).toHaveAttribute('aria-expanded', 'true')

  await page.getByRole('button', { name: q.search.more.refine, exact: true }).click()

  const field = page.getByLabel(q.search.queryLabel('Comic Vine'), { exact: true })
  await expect(field).toBeFocused()
  expect(await field.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 'batman'.length])
  await expect(rows(page)).toHaveCount(40)
})

test('a failed Show more keeps the rows and shows the strip, and Retry gets the page', async ({ page }) => {
  let page2 = 0
  await page.route('**/api/media-types/comic/search**', (route) => {
    const number = new URL(route.request().url()).searchParams.get('page') ?? '1'
    if (number === '2') {
      page2 += 1
      if (page2 === 1) {
        return route.fulfill({
          status: 502,
          json: { error: 'Upstream unavailable', message: 'Comic Vine is rate-limiting us. Try again in a moment.' },
        })
      }
    }
    return route.fulfill({ json: PAGES[number] })
  })

  await openComicSearch(page)
  await search(page)
  await expect(rows(page)).toHaveCount(20)

  await page.getByRole('button', { name: q.search.more.showMore, exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Comic Vine is rate-limiting us')
  await expect(rows(page)).toHaveCount(20)

  await page.getByRole('alert').getByRole('button', { name: q.search.retry }).click()
  await expect(rows(page)).toHaveCount(40)
  await expect(page.getByRole('alert')).toBeHidden()
})
