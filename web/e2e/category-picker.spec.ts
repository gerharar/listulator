import { expect, test } from '@playwright/test'
import { en } from '../src/locale/en.js'
import { useHomeFixture } from './fixtures.js'

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
