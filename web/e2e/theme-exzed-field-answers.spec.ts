import { expect, test, type Locator, type Page } from '@playwright/test'
import { q } from './fixtures.js'
import { decodePng } from './pngPixels.js'

/**
 * Design's answers D10, D12, D13 and D14 (canvas `HANDOFF.md` 1794518537-79cc, 2026-11-12), on the real screens, in both engines and all six skins:
 * **D10** Hold My Beer's shelf chips: a shelf with candidates has its label in `ink`, one with none keeps the chip at rest in `ink2`, still a chip (hover and picked as usual, no dotted
 * outline); **D12** a multi-line field is as tall inside its border as its lines x 24 + 16 (the item note's 2 lines 64px, the list's description 3 lines 88px) and grows with its content;
 * **D13** the Group listbox marks an option with the ▶ pointer only when the typed value matches it exactly; **D14** an invalid field keeps the `ink` border and gains the refusal icon at its
 * right end in `ink`, and the same icon before the sentence under it in `ink2`, never red.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
const ENTRIES = [
  { externalRef: 'canonical:lists/book/lotr.yaml', title: 'The Lord of the Rings', category: 'book', itemCount: 3, description: 'Three volumes.', status: 'complete' },
  { externalRef: 'canonical:lists/mma/ufc.yaml', title: 'All UFC Events', category: 'mma', itemCount: 757 },
]

async function boot(page: Page, skin: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin }))
}

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const css = (hex: string) => `rgb(${rgbOf(hex).join(', ')})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)
const pseudo = (locator: Locator, which: '::before' | '::after', props: string[]) => locator.evaluate((element, [w, ...names]) => Object.fromEntries(names.map((n) => [n, getComputedStyle(element, w).getPropertyValue(n)])), [which, ...props] as const)
/** The height inside the border: lines x 24 + 16 for a textarea of those lines. */
const inner = (locator: Locator) => locator.evaluate((el) => el.clientHeight)

async function makeList(page: Page) {
  const title = `Answers ${test.info().project.name} ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  const items = ['Alpha', 'Beta', 'Gamma'].map((name, n) => ({ title: name, timeToConsumeMinutes: 30, group: n < 2 ? 'Season 1' : 'Season 2' }))
  await page.request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return { id: list.id as string, title }
}

async function openItemEdit(page: Page, listTitle: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: listTitle }).click()
  await page.locator('.q-group').first().waitFor()
  await page.locator('.q-item').first().hover()
  await page.locator('.q-item').first().locator('.q-icon-btn.edit').first().click({ force: true })
  await page.locator('.q-pop').first().waitFor()
  await expect(page.locator('.q-pop').first()).toHaveCSS('opacity', '1')
  await page.waitForTimeout(250)
}

for (const skin of SKINS) {
  test(`${skin}: D10 a shelf with candidates is ink, one with none is ink2 at rest, still a chip (hover acc-dim, picked acc), not dotted`, async ({ page }) => {
    await boot(page, skin)
    await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: ENTRIES, reachable: true } }))
    await page.goto('/')
    await page.getByRole('button', { name: 'Surprise Me' }).click()
    await page.locator('.q-shelves .q-chip').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const [ink, ink2, accDim, acc, accInk] = await Promise.all(['--zx-ink', '--zx-ink2', '--zx-acc-dim', '--zx-acc', '--zx-acc-ink'].map((n) => token(page, n)))

    const books = page.locator('.q-shelves .q-chip', { hasText: 'Books' })
    const none = page.locator('.q-shelves .q-chip.none').first()
    expect(await none.count(), 'a shelf with no results is on screen').toBe(1)
    await page.mouse.move(0, 0)
    expect((await style(books, ['color'])).color, 'with candidates: ink').toBe(css(ink!))
    expect(await style(none, ['color', 'background-image']), 'with none: ink2, no dotted outline').toEqual({ color: css(ink2!), 'background-image': 'none' })

    await none.hover()
    expect(await style(none, ['background-color', 'color']), 'a shelf with none still takes the hover').toEqual({ 'background-color': css(accDim!), color: css(accInk!) })
    await page.mouse.move(0, 0)
    await none.click()
    expect(await style(none, ['background-color', 'color']), 'and can be picked').toEqual({ 'background-color': css(acc!), color: css(accInk!) })
  })

  test(`${skin}: D12 the item note is 2 lines (64px inside its border) and the list description 3 lines (88px), both growing with what is typed`, async ({ page }) => {
    const list = await makeList(page)
    try {
      await boot(page, skin)
      await openItemEdit(page, list.title)
      await page.evaluate(() => document.fonts.ready)

      const note = page.locator('.q-pop textarea.q-input').first()
      expect(await inner(note), 'the note: 2 lines x 24 + 16').toBe(64)
      await note.fill(['one', 'two', 'three', 'four'].join('\n'))
      expect(await inner(note), 'the note grows with four lines').toBe(4 * 24 + 16)
      await note.fill(Array.from({ length: 12 }, (_, n) => `line ${n}`).join('\n'))
      expect(await inner(note), 'and stops at eight lines, then scrolls').toBe(8 * 24 + 16)
      expect(await note.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
      await page.keyboard.press('Escape')

      // The Create layer's hand tab: the description.
      await page.goto('/')
      await page.getByRole('button', { name: q.home.newList }).click()
      await page.locator('.q-tile').first().click()
      await page.getByRole('tab', { name: q.createList.handTab }).click()
      // By position, not by label: a filled textarea's value becomes part of its label's name.
      const description = page.locator('textarea.q-input').first()
      await description.waitFor()
      expect(await inner(description), 'the description: 3 lines x 24 + 16').toBe(88)
      await description.fill(['a', 'b', 'c', 'd', 'e'].join('\n'))
      expect(await inner(description), 'grows with five lines').toBe(5 * 24 + 16)
    } finally {
      await page.request.delete(`/api/lists/${list.id}`)
    }
  })

  test(`${skin}: D13 the Group listbox marks an option with the pointer only when the typed value is exactly it`, async ({ page }) => {
    const list = await makeList(page)
    try {
      await boot(page, skin)
      await openItemEdit(page, list.title)
      const group = page.locator('.q-pop .q-combo input.q-input').first()
      expect(await group.inputValue(), 'the item is in Season 1').toBe('Season 1')
      await group.click()
      const options = page.locator('.q-combo-list li')
      await options.first().waitFor()
      const hasMark = async (loc: Locator) => (await pseudo(loc, '::before', ['content', '-webkit-mask-image', 'mask-image']))['-webkit-mask-image'] !== 'none' || (await pseudo(loc, '::before', ['mask-image']))['mask-image'] !== 'none'
      expect(await hasMark(options.filter({ hasText: 'Season 1' })), 'the typed value is a group: marked').toBe(true)
      expect(await hasMark(options.filter({ hasText: 'Season 2' })), 'another group: not marked').toBe(false)
      expect(await hasMark(options.filter({ hasText: q.list.noGroup })), 'No group: not marked').toBe(false)

      await group.fill('Season')
      expect(await options.filter({ hasText: 'Season 1' }).count()).toBe(1)
      expect(await hasMark(options.filter({ hasText: 'Season 1' })), 'a partial match is not current').toBe(false)
      await group.fill('Season 2')
      expect(await hasMark(options.filter({ hasText: 'Season 2' })), 'an exact match is').toBe(true)
    } finally {
      await page.request.delete(`/api/lists/${list.id}`)
    }
  })

  test(`${skin}: D14 an invalid field keeps the ink border and shows the refusal icon at its right end and before its sentence, never red`, async ({ page }) => {
    await boot(page, skin)
    await page.goto('/')
    await page.getByRole('button', { name: q.home.newList }).click()
    await page.locator('.q-tile').first().click()
    await page.getByRole('tab', { name: q.createList.handTab }).click()
    const title = page.getByLabel(q.addByHand.titleLabel, { exact: true })
    await title.fill('')
    await page.getByRole('button', { name: q.addByHand.create }).click()
    await expect(page.locator('.q-field-msg')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.mouse.move(0, 0)
    const [ink, ink2, paper, danger] = await Promise.all(['--zx-ink', '--zx-ink2', '--zx-paper', '--zx-danger'].map((n) => token(page, n)))

    expect(await title.getAttribute('aria-invalid')).toBe('true')
    await title.evaluate((el) => (el as HTMLElement).blur())
    expect((await style(title, ['border-top-color'])), 'the border is ink').toEqual({ 'border-top-color': css(ink!) })
    expect(css(danger!), 'never red: the border is not the danger colour').not.toBe(css(ink!))

    // The mark at the field's right end: 16px, ink, at the box's vertical middle, drawn as the refusal icon (a bar and a dot on the 8x8 grid).
    const mark = await title.evaluate((el) => {
      const label = el.closest('.q-field')!
      const css = getComputedStyle(label, '::after')

      return { width: css.width, height: css.height, background: css.backgroundColor, mask: css.webkitMaskImage !== 'none' || css.maskImage !== 'none' }
    })
    expect(mark).toEqual({ width: '16px', height: '16px', background: css(ink!), mask: true })
    const box = (await title.boundingBox())!
    const icon = { x: box.x + box.width - 2 - 8 - 16, y: box.y + (box.height - 16) / 2 }
    const shot = decodePng(await page.screenshot({ clip: { x: icon.x, y: icon.y, width: 16, height: 16 } }))
    const scale = shot.width / 16
    const at = (x: number, y: number) => {
      const i = (Math.floor(y * scale) * shot.width + Math.floor(x * scale)) * 4

      return [shot.data[i], shot.data[i + 1], shot.data[i + 2]]
    }
    expect(at(7, 2), 'the bar of the ! is ink').toEqual(rgbOf(ink!))
    expect(at(7, 13), 'its dot is ink').toEqual(rgbOf(ink!))
    expect(at(7, 11), 'the gap between them is the field').toEqual(rgbOf(paper!))

    // The sentence: ink2, the same icon before it in place of the browser's alert glyph.
    const msg = page.locator('.q-field-msg')
    expect((await style(msg, ['color'])).color, 'the sentence is ink2').toBe(css(ink2!))
    expect(await style(msg.locator('svg'), ['display']), 'the stock icon is not drawn').toEqual({ display: 'none' })
    expect(await pseudo(msg, '::before', ['width', 'height', 'background-color']), 'the refusal icon before it').toEqual({ width: '16px', height: '16px', 'background-color': css(ink2!) })
  })
}
