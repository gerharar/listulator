import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng } from './pngPixels.js'

/**
 * eX-Zed's buttons, the roles and the states (51.2a, X-007; design's Button card and `bundle.css`), in both engines and all six skins. The real `.q-btn` and `.q-icon-btn`
 * markup is put on the app's page and read from computed styles and pixels: **primary** (`acc` block, `acc-ink`; hover swaps to `pri-hv`), the **bracketed secondary** (the default
 * button, `quiet` and `ghost`: `[Label]`, no border, `ink2`, hover = the highlight, "[" 18px in, the brackets CSS content so the accessible name is the label), **danger**
 * (`danger` block, `chip-ink`), **disabled** (no fill, the dotted 2px `ink2` outline, `not-allowed`, no hover; a disabled icon has no outline and its icon is a checkerboard of
 * 2px cells), **busy** (the primary keeps its fill, the progress cursor), **lit** (an opener whose popover is open takes the hover look), and the **icon buttons** (40x40, 48x40
 * in the header, 32x32 borderless in a row; hover and lit = the highlight). The call-site exceptions (menu rows, choices, ghosts, Quit) are 51.2b.
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
  await page.goto('/')
  await page.locator('.q-home-row, .q-picker').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

/** Puts `html` in a fixed column at (24, 24) on the app's paper, one element per row, so each sits on whole pixels. */
async function inject(page: Page, html: string) {
  await page.evaluate((markup) => {
    document.getElementById('zx-harness')?.remove()
    const holder = document.createElement('div')
    holder.id = 'zx-harness'
    holder.style.cssText = 'position:fixed;left:24px;top:24px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-start;gap:16px;padding:16px;background:var(--zx-paper)'
    holder.innerHTML = markup
    document.body.append(holder)
  }, html)
}

const T = (page: Page, id: string) => page.locator(`#zx-harness [data-t="${id}"]`)
const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
const rgbArray = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)
const pseudo = (locator: Locator, which: '::before' | '::after') => locator.evaluate((element, w) => getComputedStyle(element, w).getPropertyValue('content'), which)

/** The element's box as pixels, in device pixels (`ratio` of them to a CSS pixel). */
async function pixels(page: Page, locator: Locator) {
  const box = (await locator.boundingBox())!
  const ratio = await page.evaluate(() => window.devicePixelRatio)
  const seen = decodePng(await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } }))
  const at = (x: number, y: number): [number, number, number] => {
    const i = (Math.floor(y * ratio) * seen.width + Math.floor(x * ratio)) * 4

    return [seen.data[i]!, seen.data[i + 1]!, seen.data[i + 2]!]
  }

  return { at, width: box.width, height: box.height, ratio }
}
const same = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

test.describe('the roles', () => {
  for (const skin of SKINS) {
    test(`${skin}: primary is the \`acc\` block, hover swaps to \`pri-hv\`; danger is the \`danger\` block, hover \`pri-hv\``, async ({ page }) => {
      await boot(page, { skin })
      await inject(page, '<button class="q-btn primary" data-t="primary">Add Item</button><button class="q-btn danger" data-t="danger">Delete List</button>')
      const [acc, accInk, hv, hvInk, hvLine, danger, chip] = await Promise.all(['--zx-acc', '--zx-acc-ink', '--zx-pri-hv', '--zx-pri-hv-ink', '--zx-pri-hv-line', '--zx-danger', '--zx-chip-ink'].map((n) => token(page, n)))
      const primary = await style(T(page, 'primary'), ['background-color', 'border-top-color', 'color', 'height', 'padding-left', 'padding-right', 'font-size', 'font-weight', 'border-top-width'])
      expect(primary).toMatchObject({ 'background-color': rgb(acc!), 'border-top-color': rgb(acc!), color: rgb(accInk!), height: '40px', 'padding-left': '16px', 'padding-right': '16px', 'font-size': '16px', 'font-weight': '400', 'border-top-width': '2px' })
      await T(page, 'primary').hover()
      expect(await style(T(page, 'primary'), ['background-color', 'color', 'border-top-color'])).toMatchObject({ 'background-color': rgb(hv!), color: rgb(hvInk!), 'border-top-color': rgb(hvLine!) })
      await page.mouse.move(0, 0)

      expect(await style(T(page, 'danger'), ['background-color', 'border-top-color', 'color', 'height'])).toMatchObject({ 'background-color': rgb(danger!), 'border-top-color': rgb(danger!), color: rgb(chip!), height: '40px' })
      await T(page, 'danger').hover()
      expect(await style(T(page, 'danger'), ['background-color', 'color'])).toMatchObject({ 'background-color': rgb(hv!), color: rgb(hvInk!) })
    })

    test(`${skin}: the bracketed secondary (default, quiet, ghost) is \`[Label]\` with no border in \`ink2\`, hover is the highlight, and the name is the label`, async ({ page }) => {
      await boot(page, { skin })
      await inject(page, ['', ' quiet', ' ghost'].map((kind, n) => `<button class="q-btn${kind}" data-t="b${n}">Cancel</button>`).join(''))
      const [acc, accInk, ink2] = await Promise.all(['--zx-acc', '--zx-acc-ink', '--zx-ink2'].map((n) => token(page, n)))
      for (let n = 0; n < 3; n++) {
        const button = T(page, `b${n}`)
        expect(await style(button, ['background-color', 'border-top-color', 'border-top-width', 'color', 'height', 'padding-left', 'font-size'])).toMatchObject({
          'background-color': 'rgba(0, 0, 0, 0)',
          'border-top-color': 'rgba(0, 0, 0, 0)',
          'border-top-width': '2px',
          color: rgb(ink2!),
          height: '40px',
          'padding-left': '16px',
          'font-size': '16px',
        })
        expect(await pseudo(button, '::before'), `button ${n}: the opening bracket`).toMatch(/\[/)
        expect(await pseudo(button, '::after'), `button ${n}: the closing bracket`).toMatch(/\]/)
        await button.hover()
        expect(await style(button, ['background-color', 'border-top-color', 'color'])).toMatchObject({ 'background-color': rgb(acc!), 'border-top-color': rgb(acc!), color: rgb(accInk!) })
        await page.mouse.move(0, 0)
      }
      // The brackets are drawn, not in the DOM: the label is the whole accessible name, in both engines.
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(3)
      expect(await T(page, 'b0').textContent()).toBe('Cancel')
    })

    test(`${skin}: the "[" cell starts 18px in (16px of padding and the 2px border), and no ink is nearer the edge`, async ({ page }) => {
      await boot(page, { skin })
      await inject(page, '<button class="q-btn quiet" data-t="b" style="width:160px">Cancel</button>')
      const ink2 = rgbArray(await token(page, '--zx-ink2'))
      const paper = rgbArray(await token(page, '--zx-paper'))
      const px = await pixels(page, T(page, 'b'))
      let first = Infinity
      for (let x = 0; x < px.width; x++) {
        for (let y = 0; y < px.height; y++) if (same(px.at(x, y), ink2)) first = Math.min(first, x)
      }
      expect(first, 'the first ink column of the label').toBeGreaterThanOrEqual(18)
      expect(first, '... and inside the first glyph cell (the bar is drawn in its right half), not a stray').toBeLessThan(34)
      expect(same(px.at(1, 20), paper), 'the box itself has no border').toBe(true)
    })
  }
})

test.describe('disabled, busy and lit', () => {
  for (const skin of SKINS) {
    test(`${skin}: a disabled button has no fill and the dotted 2px \`ink2\` outline, \`not-allowed\`, no hover; every role alike`, async ({ page }) => {
      await boot(page, { skin })
      const roles = ['', ' primary', ' quiet', ' ghost', ' danger']
      await inject(page, roles.map((kind, n) => `<button class="q-btn${kind}" data-t="d${n}" disabled style="width:120px">Save</button>`).join(''))
      const ink2 = rgbArray(await token(page, '--zx-ink2'))
      const paper = rgbArray(await token(page, '--zx-paper'))
      for (let n = 0; n < roles.length; n++) {
        const button = T(page, `d${n}`)
        const css = await style(button, ['background-color', 'background-image', 'color', 'cursor', 'opacity'])
        expect(css['background-color'], `role${roles[n]}: no fill`).toBe('rgba(0, 0, 0, 0)')
        expect(css['background-image']!.match(/repeating-linear-gradient/g)?.length, `role${roles[n]}: four dotted edges`).toBe(4)
        expect([css.color, css.cursor, css.opacity]).toEqual([rgb(await token(page, '--zx-ink2')), 'not-allowed', '1'])

        // The pixels: along the top edge 2px on, 2px off (from the left), two rows deep, then the paper; the same down the left edge.
        const px = await pixels(page, button)
        for (let x = 0; x < 40; x += 2) {
          const wanted = (x % 4 === 0 ? ink2 : paper) as number[]
          expect(same(px.at(x + 0.5, 0.5), wanted), `role${roles[n]}: top edge at ${x}`).toBe(true)
          expect(same(px.at(x + 0.5, 1.5), wanted), `role${roles[n]}: top edge, second row, at ${x}`).toBe(true)
        }
        for (let y = 0; y < 24; y += 2) {
          const wanted = (y % 4 === 0 ? ink2 : paper) as number[]
          expect(same(px.at(0.5, y + 0.5), wanted), `role${roles[n]}: left edge at ${y}`).toBe(true)
        }
        expect(same(px.at(4.5, 20.5), paper), `role${roles[n]}: the inside is the ground`).toBe(true)

        await button.hover({ force: true })
        expect((await style(button, ['background-color']))['background-color'], `role${roles[n]}: no hover`).toBe('rgba(0, 0, 0, 0)')
        await page.mouse.move(0, 0)
      }
    })

    test(`${skin}: a disabled icon button has no outline and its icon is a checkerboard of 2px cells in \`ink2\``, async ({ page }) => {
      await boot(page, { skin })
      await inject(
        page,
        '<button class="q-icon-btn" data-t="i" disabled aria-label="Refresh"><svg width="16" height="16" viewBox="0 0 8 8" fill="currentColor" shape-rendering="crispEdges"><path d="M0 0h8v8H0z"/></svg></button>',
      )
      const button = T(page, 'i')
      const css = await style(button, ['background-image', 'color', 'cursor'])
      expect(css['background-image'], 'no dotted outline on an icon').toBe('none')
      expect([css.color, css.cursor]).toEqual([rgb(await token(page, '--zx-ink2')), 'not-allowed'])
      expect(await T(page, 'i').locator('svg').evaluate((svg) => `${getComputedStyle(svg).maskImage} ${getComputedStyle(svg).getPropertyValue('-webkit-mask-image')}`)).toContain('repeating-conic-gradient')

      // A solid 16px icon makes the checkerboard plain: its 2px cells alternate ink and ground, from the icon's own top left.
      const ink2 = rgbArray(await token(page, '--zx-ink2'))
      const paper = rgbArray(await token(page, '--zx-paper'))
      const icon = (await T(page, 'i').locator('svg').boundingBox())!
      const ratio = await page.evaluate(() => window.devicePixelRatio)
      const seen = decodePng(await page.screenshot({ clip: { x: icon.x, y: icon.y, width: 16, height: 16 } }))
      const cell = (cx: number, cy: number) => {
        const i = (Math.floor((cy * 2 + 1) * ratio) * seen.width + Math.floor((cx * 2 + 1) * ratio)) * 4

        return [seen.data[i]!, seen.data[i + 1]!, seen.data[i + 2]!]
      }
      let ink = 0
      for (let cy = 0; cy < 8; cy++) {
        for (let cx = 0; cx < 8; cx++) {
          const even = (cx + cy) % 2 === 0
          const got = cell(cx, cy)
          if (same(got, ink2)) ink++
          expect(even ? same(got, ink2) : same(got, paper), `cell ${cx},${cy} is ${even ? 'ink' : 'ground'}`).toBe(true)
        }
      }
      expect(ink).toBe(32)
    })

    test(`${skin}: a busy primary keeps its fill and shows the progress cursor; a lit opener takes the hover look`, async ({ page }) => {
      await boot(page, { skin })
      await inject(
        page,
        '<button class="q-btn primary" data-t="busy" disabled aria-busy="true">Importing…</button>' +
          '<button class="q-icon-btn" data-t="lit-icon" aria-expanded="true" aria-label="More"><svg width="16" height="16"><rect width="8" height="8"/></svg></button>' +
          '<button class="q-btn quiet" data-t="lit-btn" aria-expanded="true">Edit</button>' +
          '<button class="q-btn quiet is-lit" data-t="lit-class">Edit</button>',
      )
      const [acc, accInk] = await Promise.all(['--zx-acc', '--zx-acc-ink'].map((n) => token(page, n)))
      const busy = await style(T(page, 'busy'), ['background-color', 'background-image', 'color', 'cursor'])
      expect([busy['background-color'], busy.color, busy.cursor]).toEqual([rgb(acc!), rgb(accInk!), 'progress'])
      expect(busy['background-image'], 'busy is not the disabled look').toBe('none')
      for (const id of ['lit-icon', 'lit-btn', 'lit-class']) {
        expect(await style(T(page, id), ['background-color', 'color']), `${id}: at rest, an opener with its popover open is the highlight`).toMatchObject({ 'background-color': rgb(acc!), color: rgb(accInk!) })
      }
    })
  }
})

test.describe('icon buttons', () => {
  for (const skin of SKINS) {
    test(`${skin}: 40x40, 48x40 in the header, 32x32 borderless in a row; \`ink2\` at rest, the highlight on hover`, async ({ page }) => {
      await boot(page, { skin })
      await inject(
        page,
        ['', ' sq', ' list', ' rail', ' row'].map((kind, n) => `<button class="q-icon-btn${kind}" data-t="i${n}" aria-label="x${n}"><svg width="16" height="16"><rect width="8" height="8"/></svg></button>`).join(''),
      )
      const [acc, accInk, ink2] = await Promise.all(['--zx-acc', '--zx-acc-ink', '--zx-ink2'].map((n) => token(page, n)))
      for (const [n, size] of [[0, [40, 40]], [1, [40, 40]], [2, [40, 40]], [4, [32, 32]]] as const) {
        const box = (await T(page, `i${n}`).boundingBox())!
        expect([box.width, box.height], `icon button ${n}`).toEqual(size)
        expect((await style(T(page, `i${n}`), ['color'])).color, `icon button ${n}: ink2`).toBe(rgb(ink2!))
        await T(page, `i${n}`).hover()
        expect(await style(T(page, `i${n}`), ['background-color', 'color']), `icon button ${n}: hover`).toMatchObject({ 'background-color': rgb(acc!), color: rgb(accInk!) })
        await page.mouse.move(0, 0)
      }
      expect((await style(T(page, 'i4'), ['border-top-width']))['border-top-width'], 'a row’s icon has no border').toBe('0px')

      // In the header they are 48x40, `hdr-ink2` at rest, and take the highlight.
      const settings = page.locator('.q-appheader').getByRole('button', { name: 'Settings', exact: true })
      const box = (await settings.boundingBox())!
      expect([box.width, box.height]).toEqual([48, 40])
      expect((await style(settings, ['color'])).color).toBe(rgb((await token(page, '--zx-hdr-ink2'))!))
      await settings.hover()
      expect(await style(settings, ['background-color', 'color'])).toMatchObject({ 'background-color': rgb(acc!), color: rgb(accInk!) })
    })
  }

  test('the header buttons of a list rest on the paper cell of 50.15 and take the highlight when pointed at', async ({ page }) => {
    const list = await (await page.request.post('/api/lists', { data: { title: `Cell ${Date.now()}`, mediaType: 'tv' } })).json()
    try {
      await boot(page)
      await page.locator('.q-home-row', { hasText: list.title }).click()
      await page.locator('.q-list-head').waitFor()
      const more = page.locator('.q-list-actions').getByRole('button', { name: 'More', exact: true })
      const [paper, acc] = await Promise.all([token(page, '--zx-paper'), token(page, '--zx-acc')])
      expect((await style(more, ['background-color']))['background-color'], 'at rest: the paper cell').toBe(rgb(paper))
      await more.hover()
      expect((await style(more, ['background-color']))['background-color'], 'pointed at: the highlight wins over the cell').toBe(rgb(acc))
    } finally {
      await page.request.delete(`/api/lists/${list.id}`)
    }
  })
})

test('Quantum draws none of it: a button keeps its 1px line, its 13px bold label and no brackets', async ({ page }) => {
  await boot(page, { theme: 'quantum' })
  await inject(page, '<button class="q-btn" data-t="b">Cancel</button><button class="q-icon-btn" data-t="i" aria-label="x"><svg width="16" height="16"/></button>')
  expect(await style(T(page, 'b'), ['border-top-width', 'font-size', 'font-weight'])).toMatchObject({ 'border-top-width': '1px', 'font-size': '13px', 'font-weight': '600' })
  expect(await pseudo(T(page, 'b'), '::before')).toMatch(/none|normal/)
  expect((await T(page, 'i').boundingBox())!.width).toBe(40)
})
