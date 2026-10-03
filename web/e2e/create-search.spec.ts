import { expect, test, type Page } from '@playwright/test'
import { q, useHomeFixture } from './fixtures.js'

/**
 * The Create layer's Search tab (task 10.12) in a real engine. The network
 * is stubbed at the browser boundary — a live MusicBrainz or TMDB call has no
 * business gating this suite — so this proves the wiring: rows, counts that
 * load in per result, the same filters on counts and import, the error strip
 * in its slot, and Add list landing on the new list's layer. The live path
 * (a real MusicBrainz search → Add list) is checked by hand.
 */
const SOURCES = [
  { externalRef: 'mb-1', title: 'Cannibal Corpse Discography', detail: 'Group · US' },
  { externalRef: 'mb-2', title: 'Cannibal Corpse Tribute', detail: 'Group · DE' },
]

async function openMusicSearch(page: Page) {
  await useHomeFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: q.home.newList }).click()
  await page.locator('.q-tile', { hasText: 'Music' }).click()
  await expect(page.getByRole('heading', { name: q.createList.title('Music') })).toBeVisible()
  await expect(page.getByRole('tab', { name: q.createList.searchTab('MusicBrainz'), exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
}

async function search(page: Page) {
  await page.getByLabel(q.search.queryLabel('MusicBrainz'), { exact: true }).fill('cannibal')
  await page.getByRole('button', { name: q.search.searchButton, exact: true }).click()
}

test('searching lists results, loads a count into each row, and Add list opens the new list', async ({
  page,
}) => {
  const expansionUrls: string[] = []
  let importBody: unknown

  await page.route('**/api/media-types/music/search**', (route) =>
    route.fulfill({ json: { sources: SOURCES } }),
  )
  await page.route('**/api/media-types/music/expansion**', (route) => {
    expansionUrls.push(route.request().url())
    return route.fulfill({ json: { itemCount: 14 } })
  })
  await page.route('**/api/lists/from-source', (route) => {
    importBody = route.request().postDataJSON()
    return route.fulfill({ status: 201, json: LIST_JSON })
  })
  await page.route('**/api/lists/created-1', (route) =>
    route.fulfill({ json: { ...LIST_JSON, items: [], groups: [] } }),
  )

  await openMusicSearch(page)
  await search(page)

  await expect(page.getByText(q.search.resultsCount(2))).toBeVisible()
  await expect(page.getByText('Cannibal Corpse Discography')).toBeVisible()
  // Each row's count loads in after the rows rendered.
  await expect(page.locator('.q-result .n', { hasText: '14' })).toHaveCount(2)

  // The count was fetched with the same discography types an import would use.
  expect(expansionUrls).toHaveLength(2)
  expect(expansionUrls[0]).toContain('externalRef=mb-1')
  expect(expansionUrls[0]).toContain('includeEp=true')
  expect(expansionUrls[0]).toContain('includeLive=false')

  await page.getByRole('button', { name: q.search.expandRow('Cannibal Corpse Discography') }).click()
  await page.getByRole('button', { name: q.search.addButton }).click()

  await expect(page.getByRole('heading', { name: 'Cannibal Corpse Discography' })).toBeVisible()
  expect(importBody).toMatchObject({
    mediaType: 'music',
    externalRef: 'mb-1',
    title: 'Cannibal Corpse Discography',
    includeEp: true,
    includeSingle: true,
    includeLive: false,
    includeCompilation: false,
  })
  // Home is still there under the new list.
  await expect(page.getByRole('button', { name: q.home.title })).toBeVisible()
})

test('a rate-limited search shows a strip in the results slot, and Retry recovers', async ({
  page,
}) => {
  let calls = 0
  await page.route('**/api/media-types/music/search**', (route) => {
    calls += 1
    return calls === 1
      ? route.fulfill({
          status: 502,
          json: { error: 'Upstream unavailable', message: 'MusicBrainz is rate-limiting us. Try again in a moment.' },
        })
      : route.fulfill({ json: { sources: SOURCES } })
  })
  await page.route('**/api/media-types/music/expansion**', (route) =>
    route.fulfill({ json: { itemCount: 3 } }),
  )

  await openMusicSearch(page)
  await search(page)

  const strip = page.getByRole('alert')
  await expect(strip).toContainText('MusicBrainz is rate-limiting us')
  // The form did not move: the search field is still in place above the strip.
  await expect(page.getByLabel(q.search.queryLabel('MusicBrainz'), { exact: true })).toBeVisible()

  await strip.getByRole('button', { name: q.search.retry }).click()
  await expect(page.getByText('Cannibal Corpse Discography')).toBeVisible()
  await expect(page.getByRole('alert')).toBeHidden()
})

test('when the community library cannot be reached, results still show, with a strip saying so', async ({
  page,
}) => {
  await page.route('**/api/media-types/music/search**', (route) =>
    route.fulfill({ json: { sources: SOURCES, libraryUnreachable: true } }),
  )
  await page.route('**/api/media-types/music/expansion**', (route) =>
    route.fulfill({ json: { itemCount: 3 } }),
  )

  await openMusicSearch(page)
  await search(page)

  await expect(page.getByText('Cannibal Corpse Discography')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(q.search.libraryUnreachable)
})

test('with no key and the library down, the block names both problems', async ({ page }) => {
  await page.route('**/api/media-types/music/search**', (route) =>
    route.fulfill({
      status: 409,
      json: { code: 'search.unavailableOffline', params: { category: 'Music' } },
    }),
  )

  await openMusicSearch(page)
  await search(page)

  await expect(page.getByText(q.search.offlineHeadline('Music'))).toBeVisible()
  await expect(page.getByLabel(q.search.queryLabel('MusicBrainz'), { exact: true })).toBeVisible()
})

const LIST_JSON = {
  id: 'created-1',
  title: 'Cannibal Corpse Discography',
  description: null,
  mediaType: 'music',
  source: 'api',
  externalRef: 'mb-1:ep,single',
  status: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  stats: {
    totalItems: 14,
    consumedItems: 0,
    completionPercent: 0,
    timeRemainingMinutes: 630,
    lastConsumedAt: null,
  },
}

test('Preview lists every item without creating anything; Esc returns to the results; Add list sends what the row would', async ({
  page,
}) => {
  const importBodies: unknown[] = []
  const previewItems = Array.from({ length: 30 }, (_, index) => ({
    title: `Track ${index + 1}`,
    timeToConsumeMinutes: 4,
    year: 1990,
    group: index < 15 ? 'Album A' : 'Album B',
  }))

  await page.route('**/api/media-types/music/search**', (route) =>
    route.fulfill({ json: { sources: SOURCES } }),
  )
  await page.route('**/api/media-types/music/expansion**', (route) => {
    const withItems = new URL(route.request().url()).searchParams.get('items') === 'true'
    return route.fulfill({
      json: withItems
        ? { itemCount: 30, status: 'complete', items: previewItems }
        : { itemCount: 30 },
    })
  })
  await page.route('**/api/lists/from-source', (route) => {
    importBodies.push(route.request().postDataJSON())
    return route.fulfill({ status: 201, json: LIST_JSON })
  })
  await page.route('**/api/lists/created-1', (route) =>
    route.fulfill({ json: { ...LIST_JSON, items: [], groups: [] } }),
  )

  await openMusicSearch(page)
  await search(page)
  await page.getByRole('button', { name: q.search.expandRow('Cannibal Corpse Discography') }).click()
  await page.getByRole('button', { name: q.search.previewButton, exact: true }).click()

  // Every item, in order, under the group heads; count and runtime up top.
  await expect(page.getByText(q.preview.summary(30, '2h', false))).toBeVisible()
  await expect(page.getByText('Track 1', { exact: true })).toBeVisible()
  await expect(page.locator('.q-preview-row')).toHaveCount(30)
  await expect(page.getByRole('button', { name: q.preview.collapseGroup('Album A') })).toBeVisible()
  expect(importBodies).toHaveLength(0)

  // Esc returns to the results, untouched: the row is still expanded.
  await page.keyboard.press('Escape')
  await expect(page.getByText(q.preview.summary(30, '2h', false))).toBeHidden()
  await expect(page.getByText(q.search.resultsCount(2))).toBeVisible()
  await expect(page.getByRole('button', { name: q.search.addButton })).toBeVisible()

  // Add list from Preview sends the same request as the row's.
  await page.getByRole('button', { name: q.search.addButton }).click()
  await expect(page.getByRole('heading', { name: 'Cannibal Corpse Discography' })).toBeVisible()
  await page.goto('/')
  await openMusicSearch(page)
  await search(page)
  await page.getByRole('button', { name: q.search.expandRow('Cannibal Corpse Discography') }).click()
  await page.getByRole('button', { name: q.search.previewButton, exact: true }).click()
  await expect(page.getByText(q.preview.summary(30, '2h', false))).toBeVisible()
  // The covered results layer has an Add list of its own; this is the Preview's.
  await page.locator('.q-preview').getByRole('button', { name: q.preview.addButton }).click()
  await expect(page.getByRole('heading', { name: 'Cannibal Corpse Discography' })).toBeVisible()

  expect(importBodies).toHaveLength(2)
  expect(importBodies[1]).toEqual(importBodies[0])
})
