import { expect, test, type Locator, type Page } from '@playwright/test'
import { en } from '../src/locale/en.js'
import { useHomeFixture } from './fixtures.js'

/**
 * eX-Zed's List Vault rows (51.8, X-007; design's Row card and the Vault board), on the real screen, in both engines and all six skins. **The category column is 2px `frame` on its right with 8px above its
 * first row; a category is a 32px row (16px sides, 8px between its name and its plain count) that takes the highlight on hover, and the picked one is the highlight itself (no stripe, no bold, no chip
 * round its count); an empty category is `ink2` and takes nothing. The pane's caption is `lab`, its head row 2px `frame` under it with 32px sort buttons (the sorted one `ink`, the others `lab`), and
 * its rows are 32px flat grid rows (name, status tag, items, time at 128 / 80 / 80px with 16px between) that take the highlight on hover; the numbers are `ink2`, 16px, right-aligned.**
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

const entry = (category: string, n: number) => ({
  externalRef: `canonical:lists/${category}/${n}.yaml`,
  title: `${category === 'book' ? 'Book' : 'Movie'} list ${n}`,
  category,
  itemCount: 10 + n,
  totalMinutes: 600 + n * 60,
  status: n % 2 === 0 ? 'complete' : 'ongoing',
  tracked: false,
})

async function openVault(page: Page, skin: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await useHomeFixture(page)
  const library = [...Array.from({ length: 6 }, (_, n) => entry('book', n)), ...Array.from({ length: 3 }, (_, n) => entry('movie', n))]
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [library[0]], reachable: true } }))
  await page.route('**/api/library', (route) => route.fulfill({ json: { entries: library, reachable: true } }))
  await page.addInitScript((entries) => {
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin }))
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.getByRole('button', { name: en.quantum.vaultShelf.browse }).click()
  await page.locator('.q-vb-count').first().waitFor()
  await page.waitForFunction(() => document.getAnimations().length === 0)
  await page.evaluate(() => document.fonts.ready)
}

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const css = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)

for (const skin of SKINS) {
  test(`${skin}: the Vault's category column, table head and rows are the board's flat 32px lines with the highlight on hover, the picked category the highlight itself`, async ({ page }) => {
    await openVault(page, skin)
    const [ink, ink2, lab, frame, acc, accInk] = (await Promise.all(['--zx-ink', '--zx-ink2', '--zx-lab', '--zx-frame', '--zx-acc', '--zx-acc-ink'].map((n) => token(page, n)))).map((hex) => css(hex))
    await page.mouse.move(0, 0)

    // The column.
    const column = page.locator('.q-vb-column')
    expect(await style(column, ['border-right-width', 'border-right-style', 'border-right-color', 'padding-top'])).toEqual({
      'border-right-width': '2px',
      'border-right-style': 'solid',
      'border-right-color': frame,
      'padding-top': '8px',
    })
    const book = page.locator('.q-vb-cat', { hasText: 'Books' })
    expect(await style(book, ['height', 'padding-left', 'padding-right', 'column-gap', 'font-size', 'font-weight', 'color'])).toEqual({
      height: '32px',
      'padding-left': '16px',
      'padding-right': '16px',
      'column-gap': '8px',
      'font-size': '16px',
      'font-weight': '400',
      color: ink,
    })
    expect(await style(book.locator('.q-vb-count'), ['border-top-width', 'font-size', 'padding-left']), 'a plain count, no chip').toEqual({ 'border-top-width': '0px', 'font-size': '16px', 'padding-left': '0px' })

    // Hover on an unpicked category: the highlight.
    await book.hover()
    expect(await style(book, ['background-color', 'color'])).toEqual({ 'background-color': acc, color: accInk })
    await page.mouse.move(0, 0)

    // Pick one: the highlight itself, plain weight, no stripe.
    await book.click()
    await expect(book).toHaveClass(/\bon\b/)
    await page.mouse.move(0, 0)
    expect(await style(book, ['background-color', 'color', 'font-weight', 'box-shadow'])).toEqual({ 'background-color': acc, color: accInk, 'font-weight': '400', 'box-shadow': 'none' })
    expect((await style(book.locator('.q-vb-count'), ['color'])).color).toBe(accInk)

    // An empty category: ink2, no hover.
    const empty = page.locator('.q-vb-cat.empty').first()
    expect((await style(empty, ['color'])).color).toBe(ink2)
    await empty.hover()
    expect((await style(empty, ['background-color']))['background-color']).toBe('rgba(0, 0, 0, 0)')
    await page.mouse.move(0, 0)

    // The pane: the caption in lab, the head row ruled in frame, 32px sort buttons.
    expect(await style(page.locator('.q-vb-caption'), ['color', 'font-size'])).toEqual({ color: lab, 'font-size': '16px' })
    const head = page.locator('.q-vb-headrow')
    expect(await style(head, ['padding-left', 'padding-right', 'column-gap', 'border-bottom-width', 'border-bottom-color', 'grid-template-columns'])).toMatchObject({
      'padding-left': '8px',
      'padding-right': '8px',
      'column-gap': '16px',
      'border-bottom-width': '2px',
      'border-bottom-color': frame,
    })
    const columns = (await style(head, ['grid-template-columns']))['grid-template-columns']!.split(' ').map((width) => Math.round(parseFloat(width)))
    expect(columns.slice(1), 'status 128, items 80, time 80').toEqual([128, 80, 80])
    const sorts = page.locator('.q-vb-sort')
    expect((await style(sorts.first(), ['height', 'font-size', 'letter-spacing']))).toEqual({ height: '32px', 'font-size': '16px', 'letter-spacing': 'normal' })
    expect((await style(page.locator('.q-vb-sort.on'), ['color'])).color, 'the sorted column is ink').toBe(ink)
    expect((await style(sorts.nth(1), ['color'])).color, 'the others are lab').toBe(lab)

    // The rows.
    const row = page.locator('.q-vb-row').first()
    expect(await style(row, ['height', 'border-bottom-width', 'padding-left', 'column-gap', 'font-size'])).toEqual({ height: '32px', 'border-bottom-width': '0px', 'padding-left': '8px', 'column-gap': '16px', 'font-size': '16px' })
    expect(await style(row.locator('.q-vb-rowname'), ['color', 'font-size', 'font-weight'])).toEqual({ color: ink, 'font-size': '16px', 'font-weight': '400' })
    expect(await style(row.locator('.q-vb-items'), ['color', 'font-size', 'font-weight', 'text-align'])).toEqual({ color: ink2, 'font-size': '16px', 'font-weight': '400', 'text-align': 'right' })
    await row.hover({ position: { x: 200, y: 16 } })
    expect(await style(row, ['background-color', 'color'])).toEqual({ 'background-color': acc, color: accInk })
    expect((await style(row.locator('.q-vb-items'), ['color'])).color).toBe(accInk)
  })
}
