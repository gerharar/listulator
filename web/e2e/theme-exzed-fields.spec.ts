import { expect, test, type Locator, type Page } from '@playwright/test'
import { q } from './fixtures.js'

/**
 * eX-Zed's fields and listboxes (51.4, X-007; design's Field card and the boards), on the real screens, in both engines and all six skins: **a field is a 40px box with a 2px `frame`
 * border on `paper`, text `ink`, placeholder `ink2`, padding `0 8px`, its label above it as a kicker 8px off; a multi-line field grows from 64px with 24px leading and 8px padding; focus
 * turns the border `acc` (no outline); a dropdown field's chevron flips up while its menu is open. The listbox that drops from a field is exactly field-wide, a 2px `frame-hi`
 * border and the 4px `paper` ring, 40px options, hover (and the keyboard's pick) the highlight, the current option marked with the ▶ pointer.**
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

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
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)

async function roles(page: Page) {
  const [frame, frameHi, ink, ink2, acc, accInk, paper] = await Promise.all(['--zx-frame', '--zx-frame-hi', '--zx-ink', '--zx-ink2', '--zx-acc', '--zx-acc-ink', '--zx-paper'].map((n) => token(page, n)))

  return { frame: rgb(frame!), frameHi: rgb(frameHi!), ink: rgb(ink!), ink2: rgb(ink2!), acc: rgb(acc!), accInk: rgb(accInk!), paper: rgb(paper!) }
}
type Roles = Awaited<ReturnType<typeof roles>>

/** A field at rest: the box, the border, the ground, the text, the label's 8px, and (when it has one) the placeholder; then focus. */
async function readField(page: Page, field: Locator, r: Roles, label: string, { multi = false, placeholder = true, kicker = true } = {}) {
  // A field opens focused here and there (the Create layer's title, the edit popover's first): read it at rest.
  await field.evaluate((el) => (el as HTMLElement).blur())
  const box = (await field.boundingBox())!
  if (multi) expect(box.height, `${label}: grows from 64px`).toBeGreaterThanOrEqual(64)
  else expect(box.height, `${label}: 40px high`).toBe(40)

  const css = await style(field, ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-color', 'border-left-color', 'background-color', 'color', 'padding-top', 'padding-left', 'padding-right', 'font-size', 'font-weight', 'line-height'])
  for (const side of ['top', 'right', 'bottom', 'left']) expect(css[`border-${side}-width`], `${label}: ${side} border`).toBe('2px')
  expect([css['border-top-color'], css['border-left-color'], css['background-color'], css.color], `${label} at rest`).toEqual([r.frame, r.frame, r.paper, r.ink])
  expect([css['padding-left'], css['font-size'], css['font-weight']], `${label}: padding and type`).toEqual(['8px', '16px', '400'])
  expect(css['padding-top'], `${label}: vertical padding`).toBe(multi ? '8px' : '0px')
  if (multi) expect(css['line-height'], `${label}: 24px leading`).toBe('24px')
  if (placeholder) expect(await field.evaluate((el) => getComputedStyle(el, '::placeholder').color), `${label}: placeholder`).toBe(r.ink2)

  if (kicker) {
    const gap = await field.evaluate((el) => {
      const head = el.closest('.q-field')!.querySelector('.q-kicker')!.getBoundingClientRect()
      return Math.round((el.getBoundingClientRect().top - head.bottom) * 10) / 10
    })
    expect(gap, `${label}: the kicker is 8px above`).toBe(8)
  }

  await field.focus()
  expect(await style(field, ['border-top-color', 'border-bottom-color', 'outline-style']), `${label}: focus`).toEqual({ 'border-top-color': r.acc, 'border-bottom-color': r.acc, 'outline-style': 'none' })
  await field.evaluate((el) => (el as HTMLElement).blur())
}

async function makeList(page: Page, mediaType = 'tv') {
  const title = `Fields ${test.info().project.name} ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType } })).json()
  const items = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].map((name, n) => ({ title: name, timeToConsumeMinutes: 30, group: ['Season 1', 'Season 2', 'Specials'][n % 3] }))
  await page.request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return { id: list.id as string, title }
}

for (const skin of SKINS) {
  test(`${skin}: the Create layer's title, description and items fields are 40px / multi-line frame boxes on paper; focus turns the border acc`, async ({ page }) => {
    await boot(page, skin)
    await page.goto('/')
    await page.getByRole('button', { name: q.home.newList }).click()
    await page.locator('.q-tile').first().click()
    await page.getByRole('tab', { name: q.createList.handTab }).click()
    await page.getByLabel(q.addByHand.titleLabel, { exact: true }).waitFor()
    await page.evaluate(() => document.fonts.ready)
    const r = await roles(page)

    await readField(page, page.getByLabel(q.addByHand.titleLabel, { exact: true }), r, 'Title')
    await readField(page, page.getByLabel(q.addByHand.descriptionLabel, { exact: true }), r, 'Description', { multi: true })
    await readField(page, page.getByLabel(q.addByHand.itemsLabel, { exact: true }), r, 'Items', { multi: true })
  })

  test(`${skin}: the Search tab's query field and its button are 40px and level`, async ({ page }) => {
    await boot(page, skin)
    await page.goto('/')
    await page.getByRole('button', { name: q.home.newList }).click()
    await page.locator('.q-tile').first().click()
    await page.locator('.q-search-form .q-input').waitFor()
    await page.evaluate(() => document.fonts.ready)
    const r = await roles(page)

    const field = page.locator('.q-search-form .q-input')
    await readField(page, field, r, 'the query field')
    const [f, b] = [(await field.boundingBox())!, (await page.locator('.q-search-form > .q-btn').boundingBox())!]
    expect([b.height, b.y], 'the button is the field’s height and level with it').toEqual([40, f.y])
  })

  test(`${skin}: the list's add row and Group field are 40px; the Group listbox is field-wide with the frame-hi border, the ring, 40px options and the highlight; its chevron flips while open`, async ({ page }) => {
    const list = await makeList(page)
    try {
      await boot(page, skin)
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: list.title }).click()
      await page.locator('.q-group').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      const r = await roles(page)

      const row = page.locator('.q-add-item-row')
      await readField(page, row.locator('input.q-input').first(), r, 'the add-item title')
      // Year's placeholder is the longest thing the small fields hold: it must fit its box.
      const year = row.locator('.q-add-item-year input, input.q-add-item-year').first()
      const fits = await year.evaluate((el) => {
        const input = el as HTMLInputElement
        const css = getComputedStyle(input)
        const ctx = document.createElement('canvas').getContext('2d')!
        ctx.font = css.font
        const inner = input.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)

        return { text: ctx.measureText(input.placeholder).width, inner }
      })
      expect(fits.text, `the Year placeholder (${fits.text}px) fits the ${fits.inner}px inside the field`).toBeLessThanOrEqual(fits.inner)
      const group = row.locator('.q-combo input.q-input').first()
      await readField(page, group, r, 'the Group field')
      const [g, add] = [(await group.boundingBox())!, (await row.locator(':scope > .q-btn').boundingBox())!]
      expect(add.height, 'the Add button matches the fields').toBe(40)

      const chevron = (open: boolean) => group.evaluate((el, o) => getComputedStyle(el.closest('.q-combo-label')!, '::after').transform === (o ? 'matrix(1, 0, 0, -1, 0, 0)' : 'none'), open)
      expect(await chevron(false), 'the chevron points down at rest').toBe(true)
      await group.click()
      const listbox = page.locator('.q-combo-list')
      await listbox.waitFor()
      expect(await chevron(true), 'the chevron is flipped up while open').toBe(true)

      const lb = (await listbox.boundingBox())!
      expect([Math.round(lb.x), Math.round(lb.width)], 'exactly field-wide').toEqual([Math.round(g.x), Math.round(g.width)])
      const css = await style(listbox, ['border-top-width', 'border-top-color', 'box-shadow', 'background-color', 'padding-top'])
      expect(css['border-top-width']).toBe('2px')
      expect(css['border-top-color'], 'frame-hi').toBe(r.frameHi)
      expect(css['box-shadow'], 'the 4px paper ring').toBe(`${r.paper} 0px 0px 0px 4px`)
      expect([css['background-color'], css['padding-top']]).toEqual([r.paper, '4px'])
      const gap = lb.y >= g.y + g.height ? lb.y - (g.y + g.height) : g.y - (lb.y + lb.height)
      expect(gap, 'the ring touches the field: 4px between the boxes').toBe(4)

      const options = listbox.locator('li')
      expect(await options.count()).toBeGreaterThan(1)
      for (const box of await options.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(box, 'an option is 40px').toBe(40)
      await options.first().hover()
      expect(await style(options.first(), ['background-color', 'color']), 'hover = the highlight').toEqual({ 'background-color': r.acc, color: r.accInk })
    } finally {
      await page.request.delete(`/api/lists/${list.id}`)
    }
  })

  test(`${skin}: the item edit popover's fields are 40px frame boxes, its note a multi-line one; the filter field is a field`, async ({ page }) => {
    const list = await makeList(page)
    try {
      await boot(page, skin)
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: list.title }).click()
      await page.locator('.q-group').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      const r = await roles(page)

      await readField(page, page.locator('.q-filter-input'), r, 'the filter field', { kicker: false })
      const clear = page.locator('.q-filter-field')
      await page.locator('.q-filter-input').fill('a')
      const [fi, cl] = [(await page.locator('.q-filter-input').boundingBox())!, (await clear.locator('.q-filter-clear').boundingBox())!]
      expect(cl.x + cl.width, 'the ✕ is inside the field').toBeLessThanOrEqual(fi.x + fi.width)
      await page.locator('.q-filter-input').fill('')

      await page.locator('.q-item').first().hover()
      await page.locator('.q-item').first().locator('.q-icon-btn.edit').first().click({ force: true })
      await page.locator('.q-pop').first().waitFor()
      await expect(page.locator('.q-pop').first()).toHaveCSS('opacity', '1')
      const pop = page.locator('.q-pop').first()
      const inputs = pop.locator('input.q-input')
      expect(await inputs.count()).toBeGreaterThan(1)
      // The edit popover's Year holds a placeholder of ten characters: it must fit its box.
      const fits = await pop.locator('.q-edit-year').evaluate((el) => {
        const input = el as HTMLInputElement
        const style = getComputedStyle(input)
        const ctx = document.createElement('canvas').getContext('2d')!
        ctx.font = style.font

        return { text: ctx.measureText(input.placeholder).width, inner: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) }
      })
      expect(fits.text, `the Year placeholder (${fits.text}px) fits the ${fits.inner}px inside the field`).toBeLessThanOrEqual(fits.inner)
      await readField(page, inputs.first(), r, 'an item edit field', { placeholder: false })
      await readField(page, pop.locator('textarea.q-input').first(), r, 'the note', { multi: true })
    } finally {
      await page.request.delete(`/api/lists/${list.id}`)
    }
  })
}
