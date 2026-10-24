import { expect, test } from '@playwright/test'
import { q } from './fixtures.js'

/**
 * First run (tasks 10.10, 10.11): a successful fetch returning zero lists
 * starts on the Category picker, with no way back — matching the design
 * prototype's own boot stack, `[{kind:'cats', first:true}]`. Intercepted at the network
 * layer rather than actually emptying the dev database, which every other
 * spec in this suite shares.
 */
test('a fresh install with zero lists boots straight into the Category picker, with no way back', async ({
  page,
}) => {
  await page.route('**/api/lists', (route) => route.fulfill({ json: [] }))

  await page.goto('/')

  const headline = page.getByRole('heading', { name: q.categoryPicker.firstRunTitle })
  await expect(headline).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: q.home.title })).toBeHidden()

  // The picker is the base layer itself (index 0), not a layer pushed on top
  // of Home — so there is no close button, matching the design prototype's
  // `canClose:false`.
  await expect(page.getByRole('button', { name: q.categoryPicker.closeLabel })).toBeHidden()

  // The first-run subline (H-018). The TMDB key callout and the chips are the desktop app's: in the web build keys are the server's
  // business, so none of them is drawn here.
  await expect(page.getByText(q.categoryPicker.firstRunSubline)).toBeVisible()
  await expect(page.locator('.q-keycard')).toHaveCount(0)
  await expect(page.locator('.q-key-chip')).toHaveCount(0)
})

/**
 * The reset `App.tsx`'s `handleLegacyNavigate` needs after a first-run
 * creation (docs/DECISIONS.md): a plain `replaceTop` would leave the picker
 * (the base layer) under the new list, and Home would never get created at
 * all. Only `GET` is intercepted, so the actual `POST /api/lists` this
 * test triggers is a real write against the dev database — cleaned up at
 * the end, the same discipline `no-native-dialogs.spec.ts` uses.
 */
test('after the first-run creation, Home exists again with the new list pushed on top of it', async ({
  page,
}) => {
  await page.route('**/api/lists', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] })
    return route.continue()
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: q.categoryPicker.firstRunTitle })).toBeVisible({ timeout: 15_000 })

  await page.unroute('**/api/lists')

  // Pick the first shelf; the Create layer takes it from there. Add by hand
  // works with no API key, unlike the Search tab it opens on.
  await page.locator('.q-tile').first().click()
  await expect(page.getByRole('heading', { name: /^New .* List$/ })).toBeVisible()
  await page.getByRole('tab', { name: q.createList.handTab }).click()

  const title = `e2e first-run ${Date.now()}`
  await page.getByLabel(q.addByHand.titleLabel, { exact: true }).fill(title)
  await page.getByRole('button', { name: q.addByHand.create }).click()

  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  // Home's LayerTab, covered but present — it would not exist at all if the
  // stack were still just `[list]`.
  await expect(page.getByRole('button', { name: q.home.title })).toBeVisible()

  await page.getByRole('button', { name: q.home.title }).click()
  await expect(page.getByRole('heading', { name: q.home.title })).toBeVisible()
  await expect(page.getByText(title)).toBeVisible()

  // Clean up the real list this test created. (Through the API: the list
  // screen has no Delete until 10.22.)
  const all: { id: string; title: string }[] = await (await page.request.get('/api/lists')).json()
  const id = all.find((entry) => entry.title === title)?.id
  if (id) await page.request.delete(`/api/lists/${id}`)
})

/**
 * The List Vault shelf (H-018, 33.6): on a first run, under the tiles, up to six library lists from different categories. A card opens
 * the Preview the search rows open and builds nothing; the library is stubbed here (a live manifest has no business gating this suite).
 */
test('the first-run shelf shows six lists from six categories, and a card opens a Preview and creates no list', async ({ page }) => {
  const created: string[] = []
  const categories = ['movie', 'tv', 'game', 'book', 'music', 'comic', 'wrestling', 'mma']
  const entries = categories.flatMap((category) =>
    [1, 2].map((n) => ({ externalRef: `canonical:lists/${category}/shelf-${n}.yaml`, title: `Shelf ${category} ${n}`, category, itemCount: 12 })),
  )
  const items = Array.from({ length: 12 }, (_, index) => ({ title: `Entry ${index + 1}`, timeToConsumeMinutes: 30, year: 2000 }))

  await page.route('**/api/lists', (route) => {
    if (route.request().method() !== 'GET') created.push(route.request().method())

    return route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.abort()
  })
  await page.route('**/api/lists/from-source', (route) => {
    created.push('from-source')

    return route.abort()
  })
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries, reachable: true } }))
  await page.route('**/api/media-types/*/expansion**', (route) => route.fulfill({ json: { itemCount: 12, status: 'complete', items } }))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: q.categoryPicker.firstRunTitle })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(q.vaultShelf.label)).toBeVisible()
  await expect(page.getByText(q.vaultShelf.line)).toBeVisible()

  const cards = page.locator('.q-vault-card')
  await expect(cards).toHaveCount(6)
  const kinds = await cards.locator('.q-vault-meta').allTextContents()
  expect(new Set(kinds.map((meta) => meta.split(' · ')[0])).size).toBe(6)
  for (const meta of kinds) expect(meta).toMatch(/ · 12 items$/)

  await cards.first().click()

  await expect(page.locator('.q-preview-row')).toHaveCount(12)
  await expect(page.getByRole('button', { name: q.preview.addButton })).toBeVisible()
  expect(created).toEqual([])
})

/**
 * Try A Sample List (H-018, 33.8) through the whole round: First Run, add, band, Remove Sample (back to First Run), Undo (back to My Lists with
 * the list), add again, Keep It. The library and the lists are a small fake server in this test: a real one would need an empty database and
 * the network. What it proves is the app's own navigation and the calls it makes.
 */
test('Try A Sample List: add, Keep It keeps it with no change of screen; Remove Sample lands on First Run again, Undo brings the list back', async ({ page }) => {
  const MCU = { externalRef: 'canonical:lists/mega/mcu-extended.yaml', title: 'Marvel Cinematic Universe', category: 'mega', itemCount: 3 }
  const sampleItems = ['One', 'Two', 'Three'].map((title, index) => ({
    id: `i${index}`,
    listId: 'sample-e2e',
    title,
    orderIndex: index,
    timeToConsumeMinutes: 120,
    timeToConsumeIsEstimated: false,
    consumedAt: null,
    source: 'import',
    year: null,
    group: null,
    tags: null,
    notes: null,
    yearUnk: 0,
    isNew: false,
  }))
  let list: Record<string, unknown> | null = null
  const calls: string[] = []
  const stats = { totalItems: 3, consumedItems: 0, newItems: 0, completionPercent: 0, timeRemainingMinutes: 360, lastConsumedAt: null, runtimesPending: 0 }
  const summary = () => (list ? { ...list, stats } : null)

  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: list ? [] : [MCU], reachable: true } }))
  await page.route('**/api/lists', (route) => route.fulfill({ json: list ? [summary()] : [] }))
  await page.route('**/api/lists/from-source', (route) => {
    calls.push('from-source')
    list = { id: 'sample-e2e', title: MCU.title, description: null, mediaType: 'mega', source: 'canonical', externalRef: MCU.externalRef, status: null, isSample: false, createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z', canReset: true }

    return route.fulfill({ status: 201, json: summary() })
  })
  await page.route('**/api/lists/restore', (route) => {
    calls.push('restore')
    list = (route.request().postDataJSON() as { list: Record<string, unknown> }).list

    return route.fulfill({ status: 201, json: summary() })
  })
  await page.route('**/api/lists/sample-e2e', async (route) => {
    const method = route.request().method()
    if (method === 'PATCH') {
      const patch = route.request().postDataJSON() as { isSample?: boolean }
      calls.push(`patch ${JSON.stringify(patch)}`)
      list = { ...list, ...patch }

      return route.fulfill({ json: summary() })
    }
    if (method === 'DELETE') {
      calls.push('delete')
      const restore = { list, items: sampleItems, groups: [], snapshot: [], dismissals: [] }
      list = null

      return route.fulfill({ json: { restore } })
    }

    return route.fulfill({ json: { ...summary(), items: sampleItems, groups: [] } })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: q.categoryPicker.firstRunTitle })).toBeVisible({ timeout: 15_000 })

  // Add: the list opens, with Home under it, and the band is there.
  await page.getByRole('button', { name: q.vaultShelf.trySample }).click()
  await expect(page.getByRole('heading', { name: MCU.title })).toBeVisible()
  expect(calls).toEqual(['from-source', 'patch {"isSample":true}'])
  await expect(page.getByText(q.list.sample.text)).toBeVisible()

  // Remove Sample: First Run again, and Undo brings the list back to My Lists.
  await page.getByRole('button', { name: q.list.sample.remove }).click()
  await expect(page.getByRole('heading', { name: q.categoryPicker.firstRunTitle })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: q.list.itemActions.undo }).click()
  await expect(page.getByRole('heading', { name: q.home.title })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.q-home-row', { hasText: MCU.title })).toBeVisible()
  expect(calls).toContain('restore')

  // Open it: it is still a sample (the mark came back with the list). Keep It: the band goes and nothing else changes.
  await page.locator('.q-home-row', { hasText: MCU.title }).click()
  await expect(page.getByText(q.list.sample.text)).toBeVisible()
  await page.getByRole('button', { name: q.list.sample.keep }).click()
  await expect(page.getByText(q.list.sample.text)).toBeHidden()
  await expect(page.getByRole('heading', { name: MCU.title })).toBeVisible()
  expect(calls.at(-1)).toBe('patch {"isSample":false}')
})
