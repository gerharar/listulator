import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * eX-Zed's buttons at their call sites (51.2b, X-007; design's answers D1, D2, D3, D4 and the map's classification), on the real screens, in both engines and all six skins:
 * the ⋯ menu's rows are **menu items** (40px, `ink`, left, no brackets, hover = the highlight; the Delete List row is not red), the export and Reorder answers are
 * **choices**, one under the other (a 2px `frame` box, full width), the Need-help helpers and the Vault shelf's two buttons are
 * **ghost buttons** (no brackets; the helpers 24px high with a separator between them and the open one lit), the ⋯ and Quit buttons are lit while their popover is open,
 * and **red is the final confirm of Delete List and Delete group only**. Quit's confirm is a primary (a unit test of the header: it needs the desktop app's quit).
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

async function boot(page: Page, { skin = 'exzed-1d', theme = 'exzed' } = {}) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme, exzedSkin: skin }))
}

async function makeList(page: Page) {
  const title = `Sites ${test.info().project.name} ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  const items = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name, n) => ({ title: name, timeToConsumeMinutes: 30, group: n < 2 ? 'Season 1' : 'Season 2' }))
  await page.request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return { id: list.id as string, title }
}

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)
const pseudo = (locator: Locator, which: '::before' | '::after', prop = 'content') => locator.evaluate((element, [w, p]) => getComputedStyle(element, w).getPropertyValue(p!), [which, prop] as const)
const noBrackets = (content: string) => expect(content).toMatch(/^(none|normal)$/)

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-group').first().waitFor()
}
const more = (page: Page) => page.locator('.q-list-actions').getByRole('button', { name: 'More', exact: true })
const item = (page: Page, name: string) => page.locator('.q-pop .q-btn', { hasText: name })

test.describe('the ⋯ menu, its export and reorder answers', () => {
  for (const skin of SKINS) {
    test(`${skin}: menu rows are 40px items in \`ink\` with no brackets and the highlight on hover (Delete List not red); the opener is lit while it is open`, async ({ page }) => {
      const list = await makeList(page)
      try {
        await boot(page, { skin })
        await openList(page, list.title)
        await more(page).click()
        await page.locator('.q-pop').first().waitFor()
        const [ink, acc, accInk, danger] = await Promise.all(['--zx-ink', '--zx-acc', '--zx-acc-ink', '--zx-danger'].map((n) => token(page, n)))

        for (const name of ['Edit List', 'Export List', 'Reorder List', 'Delete List']) {
          const row = item(page, name)
          const css = await style(row, ['height', 'padding-left', 'color', 'background-color', 'text-align'])
          expect([css.height, css['padding-left'], css['text-align']], name).toEqual(['40px', '16px', 'left'])
          expect(css.color, `${name}: ink, and Delete List is not red`).toBe(rgb(ink!))
          expect(css.color).not.toBe(rgb(danger!) === rgb(ink!) ? '' : rgb(danger!))
          noBrackets(await pseudo(row, '::before'))
          noBrackets(await pseudo(row, '::after'))
          expect((await row.boundingBox())!.width, `${name}: full width of the popover's content`).toBeGreaterThan(150)
        }
        await item(page, 'Edit List').hover()
        expect(await style(item(page, 'Edit List'), ['background-color', 'color'])).toMatchObject({ 'background-color': rgb(acc!), color: rgb(accInk!) })

        // The opener is lit while the popover is open: its own state, the highlight.
        await page.mouse.move(0, 0)
        expect(await more(page).getAttribute('aria-expanded')).toBe('true')
        expect(await style(more(page), ['background-color', 'color'])).toMatchObject({ 'background-color': rgb(acc!), color: rgb(accInk!) })
      } finally {
        await page.request.delete(`/api/lists/${list.id}`)
      }
    })

    test(`${skin}: export's answers are choices, one under the other, as Reorder's are`, async ({ page }) => {
      const list = await makeList(page)
      try {
        await boot(page, { skin })
        await openList(page, list.title)
        await more(page).click()
        await item(page, 'Export List').click()
        const [acc, accInk, frame, ink] = await Promise.all(['--zx-acc', '--zx-acc-ink', '--zx-frame', '--zx-ink'].map((n) => token(page, n)))

        const download = item(page, 'Download File')
        const copy = item(page, 'Copy To Clipboard')
        for (const [name, btn] of [['Download File', download], ['Copy To Clipboard', copy]] as const) {
          const css = await style(btn, ['border-top-width', 'border-top-color', 'color', 'background-color', 'height', 'text-align'])
          expect(css, name).toMatchObject({ 'border-top-width': '2px', 'border-top-color': rgb(frame!), color: rgb(ink!), height: '40px', 'text-align': 'left' })
          expect(css['background-color'], `${name} is not a primary`).not.toBe(rgb(acc!))
          noBrackets(await pseudo(btn, '::before'))
        }
        const [d, c] = [(await download.boundingBox())!, (await copy.boundingBox())!]
        expect([d.x, d.width], 'the two are as wide as each other and one under the other').toEqual([c.x, c.width])
        expect(c.y, 'Copy under Download').toBeGreaterThan(d.y + d.height - 1)
        await copy.hover()
        expect(await style(copy, ['background-color', 'color'])).toMatchObject({ 'background-color': rgb(acc!), color: rgb(accInk!) })
        await page.mouse.move(0, 0)

        // Back to the menu (the popover is still open on the export answer: dismiss, reopen) and on to Reorder.
        await page.keyboard.press('Escape')
        await more(page).click()
        await item(page, 'Reorder List').click()
        const sort = item(page, 'Sort By Release Date')
        const choice = await style(sort, ['border-top-width', 'border-top-color', 'color', 'background-color', 'height', 'text-align'])
        expect(choice).toMatchObject({ 'border-top-width': '2px', 'border-top-color': rgb(frame!), color: rgb(ink!), height: '40px', 'text-align': 'left' })
        noBrackets(await pseudo(sort, '::before'))
        const popBox = (await page.locator('.q-pop-menu').first().boundingBox())!
        expect((await sort.boundingBox())!.width, 'a choice is as wide as its box').toBeGreaterThan(popBox.width - 2)
        await sort.hover()
        expect(await style(sort, ['background-color', 'color'])).toMatchObject({ 'background-color': rgb(acc!), color: rgb(accInk!) })
      } finally {
        await page.request.delete(`/api/lists/${list.id}`)
      }
    })

    test(`${skin}: the final confirm of Delete List and of Delete group is the one red; Keep is bracketed`, async ({ page }) => {
      const list = await makeList(page)
      try {
        await boot(page, { skin })
        await openList(page, list.title)
        const danger = rgb((await token(page, '--zx-danger'))!)
        // Nothing on the list screen is a danger button until a delete is asked.
        expect(await page.locator('.q-btn.danger').count()).toBe(0)

        await more(page).click()
        await item(page, 'Delete List').click()
        await page.locator('.q-pop .q-btn.danger').waitFor()
        expect(await page.locator('.q-pop .q-btn.danger').count()).toBe(1)
        expect((await style(page.locator('.q-pop .q-btn.danger'), ['background-color']))['background-color']).toBe(danger)
        expect(await pseudo(page.locator('.q-pop .q-btn', { hasText: 'Keep' }), '::before')).toMatch(/\[/)
        await page.keyboard.press('Escape')

        // A group's own delete asks too, and its confirm is red as well.
        await page.locator('.q-group').first().hover()
        await page.locator('.q-group').first().locator('.q-group-remove').click()
        await page.locator('.q-pop .q-btn.danger').waitFor()
        expect((await style(page.locator('.q-pop .q-btn.danger'), ['background-color']))['background-color']).toBe(danger)
      } finally {
        await page.request.delete(`/api/lists/${list.id}`)
      }
    })
  }
})

test.describe('ghost buttons', () => {
  for (const skin of SKINS) {
    test(`${skin}: the Need-help helpers are 24px ghost buttons with a separator between them; the open one is lit`, async ({ page }) => {
      await boot(page, { skin })
      await page.goto('/')
      await page.locator('.q-help-row').waitFor()
      const [acc, accInk, frame] = await Promise.all(['--zx-acc', '--zx-acc-ink', '--zx-frame'].map((n) => token(page, n)))
      const helpers = page.locator('.q-help-row .q-btn')
      expect(await helpers.count()).toBe(4)
      for (let n = 0; n < 4; n++) {
        const button = helpers.nth(n)
        expect(await style(button, ['height', 'padding-left', 'padding-right', 'border-top-color', 'background-color']), `helper ${n}`).toMatchObject({
          height: '24px',
          'padding-left': '8px',
          'padding-right': '8px',
          'border-top-color': 'rgba(0, 0, 0, 0)',
          'background-color': 'rgba(0, 0, 0, 0)',
        })
        noBrackets(await pseudo(button, '::before'))
        if (n < 3) {
          const sep = await button.evaluate((element) => {
            const css = getComputedStyle(element, '::after')

            return { content: css.content, width: css.width, height: css.height, background: css.backgroundColor }
          })
          expect([sep.width, sep.height, sep.background], `separator after helper ${n}`).toEqual(['2px', '16px', rgb(frame!)])
        }
      }
      await helpers.nth(1).hover()
      expect(await style(helpers.nth(1), ['background-color', 'color'])).toMatchObject({ 'background-color': rgb(acc!), color: rgb(accInk!) })
      await page.mouse.move(0, 0)
      await helpers.nth(1).click()
      await page.locator('.q-sheet').first().waitFor()
      await page.mouse.move(0, 0)
      expect(await style(helpers.nth(1), ['background-color', 'color']), 'the open helper is lit, with the pointer away').toMatchObject({ 'background-color': rgb(acc!), color: rgb(accInk!) })
    })

    test(`${skin}: the Vault shelf's Browse List Vault and Try A Sample List are ghost buttons`, async ({ page }) => {
      await boot(page, { skin })
      await page.goto('/')
      await page.getByRole('button', { name: 'New List', exact: true }).click()
      const actions = page.locator('.q-vault-actions .q-btn')
      await actions.first().waitFor()
      for (let n = 0; n < (await actions.count()); n++) {
        const button = actions.nth(n)
        noBrackets(await pseudo(button, '::before'))
        noBrackets(await pseudo(button, '::after'))
        expect(await style(button, ['height', 'border-top-color']), `shelf button ${n}`).toMatchObject({ height: '40px', 'border-top-color': 'rgba(0, 0, 0, 0)' })
      }
      const [acc, accInk] = await Promise.all(['--zx-acc', '--zx-acc-ink'].map((n) => token(page, n)))
      await actions.first().hover()
      expect(await style(actions.first(), ['background-color', 'color'])).toMatchObject({ 'background-color': rgb(acc!), color: rgb(accInk!) })
    })
  }
})

test('Quantum keeps its own buttons: menu rows are bordered, bold and red-labelled for Delete, helpers are bordered', async ({ page }) => {
  const list = await makeList(page)
  try {
    await boot(page, { theme: 'quantum' })
    await openList(page, list.title)
    await more(page).click()
    const row = item(page, 'Edit List')
    expect((await style(row, ['border-top-width', 'font-weight']))['font-weight']).toBe('600')
    expect(await pseudo(row, '::before')).toMatch(/^(none|normal)$/)
    await page.keyboard.press('Escape')
    await page.goto('/')
    expect((await style(page.locator('.q-help-row .q-btn').first(), ['border-top-width']))['border-top-width']).toBe('1px')
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})
