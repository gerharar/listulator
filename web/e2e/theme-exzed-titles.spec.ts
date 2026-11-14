import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng } from './pngPixels.js'

/**
 * Screen titles (51.1b, X-007; design's X-004, the Window card and `bundle.css`), in both engines and all six skins, under eX-Zed only. A screen title is **32px with the
 * three-band gradient clipped to the letters** (`t1` to 30% of the line, `t2` to 62%, `t3` below): My Lists, Choose Your Fighter, New List, List Vault, Settings and About
 * (the boards draw exactly these six). A list's name and a sheet's title are **24px plain `ink`**; the header's wordmark is 24px and the About's is 32px, LIST on a `skin`
 * block. The window head is the card's: 24px gutters (top 24, bottom 16) and a 2px `frame` rule 24px in from each side. Quantum draws none of it.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

async function boot(page: Page, { skin = 'exzed-1d', theme = 'exzed' } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 })
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

const SCREENS = {
  'My Lists': { title: '.q-home-title', head: '.q-home-head', open: async (page: Page) => page.goto('/') },
  'Choose Your Fighter': { title: '.q-picker-title', head: '.q-picker-head', open: async (page: Page) => { await page.goto('/'); await page.getByRole('button', { name: 'New List', exact: true }).click() } },
  'New List': { title: '.q-create-title', head: '.q-create-head', open: async (page: Page) => { await page.goto('/'); await page.getByRole('button', { name: 'New List', exact: true }).click(); await page.locator('.q-tile', { hasText: 'Movies' }).click() } },
  'List Vault': { title: '.q-vb-title', head: '.q-vb-head', open: async (page: Page) => { await page.goto('/'); await page.getByRole('button', { name: 'New List', exact: true }).click(); await page.getByRole('button', { name: 'Browse List Vault', exact: true }).click() } },
  Settings: { title: '.q-settings-title', head: '.q-settings-head', open: async (page: Page) => { await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click() } },
  About: { title: '.q-about-title', head: '.q-about-head', open: async (page: Page) => { await page.goto('/'); await page.getByRole('button', { name: 'About', exact: true }).click() } },
} as const
type Screen = keyof typeof SCREENS

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

/** How many pixels of each `colours` entry the element's box shows in the rows between `from` and `to` (fractions of its height), read in device pixels. */
async function count(page: Page, locator: Locator, from: number, to: number, colours: [number, number, number][]) {
  const box = (await locator.boundingBox())!
  const r = await page.evaluate(() => window.devicePixelRatio)
  const top = Math.ceil(box.y + box.height * from)
  const bottom = Math.floor(box.y + box.height * to)
  const left = Math.ceil(box.x)
  const right = Math.floor(box.x + box.width)
  const seen = decodePng(await page.screenshot({ clip: { x: left, y: top, width: right - left, height: bottom - top } }))
  expect(seen.height).toBe((bottom - top) * r)

  return colours.map(([cr, cg, cb]) => {
    let n = 0
    for (let i = 0; i < seen.width * seen.height; i++) if (seen.data[i * 4] === cr && seen.data[i * 4 + 1] === cg && seen.data[i * 4 + 2] === cb) n++

    return n
  })
}

/** Whether every pixel of the element's box between `from` and `to` (fractions of its height) is exactly `colour`: a hard stop, with no blend in the band. */
async function solid(page: Page, locator: Locator, from: number, to: number, colour: [number, number, number]) {
  const box = (await locator.boundingBox())!
  const top = Math.ceil(box.y + box.height * from)
  const bottom = Math.floor(box.y + box.height * to)
  const left = Math.ceil(box.x)
  const right = Math.floor(box.x + box.width)
  const seen = decodePng(await page.screenshot({ clip: { x: left, y: top, width: right - left, height: bottom - top } }))
  for (let i = 0; i < seen.width * seen.height; i++) if (seen.data[i * 4] !== colour[0] || seen.data[i * 4 + 1] !== colour[1] || seen.data[i * 4 + 2] !== colour[2]) return false

  return true
}

test.describe('the six screen titles', () => {
  for (const skin of SKINS) {
    for (const screen of Object.keys(SCREENS) as Screen[]) {
      test(`${skin}: ${screen} is 32px with the three-band gradient clipped to its letters`, async ({ page }) => {
        await boot(page, { skin })
        await SCREENS[screen].open(page)
        const title = page.locator(SCREENS[screen].title).first()
        await title.waitFor()
        await page.evaluate(() => document.fonts.ready)

        const style = await title.evaluate((element) => {
          const css = getComputedStyle(element)

          return { size: css.fontSize, line: css.lineHeight, weight: css.fontWeight, clip: css.backgroundClip, webkitClip: css.getPropertyValue('-webkit-background-clip'), colour: css.color, image: css.backgroundImage, spacing: css.letterSpacing }
        })
        expect([style.size, style.line, style.weight]).toEqual(['32px', '32px', '400'])
        expect([style.clip, style.webkitClip].includes('text'), 'the background is clipped to the text').toBe(true)
        expect(style.colour, 'the letters are transparent, the gradient shows through').toBe('rgba(0, 0, 0, 0)')
        for (const role of ['--zx-t1', '--zx-t2', '--zx-t3']) {
          const hex = await token(page, role)
          const [r, g, b] = rgbOf(hex)
          expect(style.image.replace(/\s/g, ''), role).toContain(`rgb(${r},${g},${b})`)
        }
        expect(style.spacing === 'normal' || style.spacing === '0px').toBe(true)

        // Read in pixels: the top rows show `t1`, the middle `t2`, the bottom `t3` (a band's colour is absent from the others unless the skin gives two bands one colour).
        const [t1, t2, t3] = (await Promise.all(['--zx-t1', '--zx-t2', '--zx-t3'].map(async (name) => rgbOf(await token(page, name))))) as [[number, number, number], [number, number, number], [number, number, number]]
        const same = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
        const top = await count(page, title, 0, 0.26, [t1, t2, t3])
        const middle = await count(page, title, 0.36, 0.58, [t1, t2, t3])
        const bottom = await count(page, title, 0.68, 1, [t1, t2, t3])
        expect(top[0], 'the top band is `t1`').toBeGreaterThan(0)
        expect(middle[1], 'the middle band is `t2`').toBeGreaterThan(0)
        expect(bottom[2], 'the bottom band is `t3`').toBeGreaterThan(0)
        if (!same(t1, t2)) expect([top[1], middle[0]], 't1 and t2 stay in their bands').toEqual([0, 0])
        if (!same(t2, t3)) expect([middle[2], bottom[1]], 't2 and t3 stay in their bands').toEqual([0, 0])

        // The control: with the clip taken away the same background is a block, and its rows are the bands at 30% and 62% of the line.
        await title.evaluate((element) => {
          element.style.setProperty('background-clip', 'border-box', 'important')
          element.style.setProperty('-webkit-background-clip', 'border-box', 'important')
        })
        // 30% of a 32px line is row 9.6 and 62% is row 19.8: each region keeps a row and a bit clear of the edges and must hold its own band's colour and no other's.
        const block = [await count(page, title, 0.04, 0.27, [t1, t2, t3]), await count(page, title, 0.34, 0.58, [t1, t2, t3]), await count(page, title, 0.66, 0.96, [t1, t2, t3])]
        expect(block[0]![0], 'block, top rows: t1').toBeGreaterThan(0)
        expect(block[1]![1], 'block, middle rows: t2').toBeGreaterThan(0)
        expect(block[2]![2], 'block, bottom rows: t3').toBeGreaterThan(0)
        if (!same(t1, t2)) expect([block[0]![1], block[1]![0]], 'the t1/t2 edge is at 30%').toEqual([0, 0])
        if (!same(t2, t3)) expect([block[1]![2], block[2]![1]], 'the t2/t3 edge is at 62%').toEqual([0, 0])
        if (!same(t1, t3)) expect([block[0]![2], block[2]![0]]).toEqual([0, 0])
        // And the stops are hard: each band, right up to its edges, is one colour (a gap between stops would blend).
        expect(await solid(page, title, 0.04, 0.27, t1), 'the top band is solid t1').toBe(true)
        expect(await solid(page, title, 0.33, 0.59, t2), 'the middle band is solid t2').toBe(true)
        expect(await solid(page, title, 0.66, 0.96, t3), 'the bottom band is solid t3').toBe(true)
      })

      test(`${skin}: the ${screen} head is the card’s: 24px gutters (top 24, bottom 16) and a 2px \`frame\` rule 24px in from each side`, async ({ page }) => {
        test.skip(screen === 'New List', 'New List keeps its tab strip’s own rule (51.3); every other head has the card’s inset rule')
        await boot(page, { skin })
        await SCREENS[screen].open(page)
        await page.locator(SCREENS[screen].head).first().waitFor()
        const head = page.locator(SCREENS[screen].head).first()
        const geometry = await head.evaluate((element) => {
          const css = getComputedStyle(element)
          const rule = getComputedStyle(element, '::after')

          return { padding: [css.paddingTop, css.paddingRight, css.paddingBottom, css.paddingLeft], border: css.borderBottomWidth, rule: { height: rule.height, left: rule.left, right: rule.right, background: rule.backgroundColor, position: rule.position } }
        })
        expect(geometry.padding).toEqual(['24px', '24px', '16px', '24px'])
        expect(geometry.border, 'the rule is the head’s own inset element, not its full-width border').toBe('0px')
        expect([geometry.rule.height, geometry.rule.left, geometry.rule.right, geometry.rule.position]).toEqual(['2px', '24px', '24px', 'absolute'])
        const frame = await token(page, '--zx-frame')
        const [r, g, b] = rgbOf(frame)
        expect(geometry.rule.background).toBe(`rgb(${r}, ${g}, ${b})`)
      })
    }
  }
})

test.describe('the other titles and the wordmarks', () => {
  test('a list’s name is 24px plain `ink`, no gradient; a sheet’s title is 24px plain `ink`', async ({ page }) => {
    await boot(page)
    await page.goto('/')
    await page.locator('.q-home-row').first().click()
    await page.locator('.q-list-title').waitFor()
    const name = await page.locator('.q-list-title').evaluate((element) => ({ size: getComputedStyle(element).fontSize, weight: getComputedStyle(element).fontWeight, image: getComputedStyle(element).backgroundImage, colour: getComputedStyle(element).color }))
    expect([name.size, name.weight, name.image]).toEqual(['24px', '400', 'none'])
    const ink = rgbOf(await token(page, '--zx-ink'))
    expect(name.colour).toBe(`rgb(${ink.join(', ')})`)

    await page.goto('/')
    await page.locator('.q-home-row').first().waitFor()
    await page.getByRole('button', { name: /Hold My Beer|I.m Tired, Boss|Finalizer|Just One Fix|Surprise Me/ }).first().click()
    const sheet = await page.locator('.q-sheet-title').first().evaluate((element) => ({ size: getComputedStyle(element).fontSize, line: getComputedStyle(element).lineHeight, weight: getComputedStyle(element).fontWeight, image: getComputedStyle(element).backgroundImage }))
    // 32px of line, as the Home-Helpers board draws it (51.11): the explanation sits 8px under it.
    expect([sheet.size, sheet.line, sheet.weight, sheet.image]).toEqual(['24px', '32px', '400', 'none'])
  })

  for (const skin of SKINS) {
    test(`${skin}: the header’s wordmark is 24px, LIST on a \`skin\` block; the About’s is 32px, the same lockup`, async ({ page }) => {
      await boot(page, { skin })
      await page.goto('/')
      await page.locator('.q-appheader .q-wordmark').waitFor()
      const lockup = (selector: string) =>
        page.locator(selector).first().evaluate((element) => {
          const list = element.querySelector('b')!
          const rest = element.querySelector('span')!
          const css = getComputedStyle(element)
          const b = getComputedStyle(list)
          const s = getComputedStyle(rest)

          return { size: css.fontSize, line: css.lineHeight, weight: css.fontWeight, listBg: b.backgroundColor, listInk: b.color, listPad: b.padding, restPad: s.padding, restInk: s.color, name: element.getAttribute('aria-label') }
        })
      const skinColour = rgbOf(await token(page, '--zx-skin'))
      const skinInk = rgbOf(await token(page, '--zx-skin-ink'))
      const ink = rgbOf(await token(page, '--zx-ink'))
      const header = await lockup('.q-appheader .q-wordmark')
      expect([header.size, header.line, header.weight]).toEqual(['24px', '24px', '400'])
      expect([header.listBg, header.listInk, header.restInk]).toEqual([`rgb(${skinColour.join(', ')})`, `rgb(${skinInk.join(', ')})`, `rgb(${ink.join(', ')})`])
      expect([header.listPad, header.restPad]).toEqual(['8px 4px 8px 8px', '8px 0px 8px 4px'])

      await page.getByRole('button', { name: 'About', exact: true }).click()
      await page.locator('.q-about .q-wordmark').first().waitFor()
      const about = await lockup('.q-about .q-wordmark')
      expect([about.size, about.line, about.weight, about.name]).toEqual(['32px', '32px', '400', 'Listulator'])
      expect([about.listBg, about.listInk]).toEqual([`rgb(${skinColour.join(', ')})`, `rgb(${skinInk.join(', ')})`])
      expect([about.listPad, about.restPad]).toEqual(['8px 8px 8px 16px', '8px 0px 8px 8px'])
    })
  }

  test('Quantum draws none of it: bold titles at 24 and 22px, no gradient, the 19px wordmark, the plain name in About', async ({ page }) => {
    await boot(page, { theme: 'quantum' })
    await page.goto('/')
    const home = await page.locator('.q-home-title').evaluate((element) => ({ size: getComputedStyle(element).fontSize, weight: getComputedStyle(element).fontWeight, image: getComputedStyle(element).backgroundImage }))
    expect([home.size, home.weight, home.image]).toEqual(['24px', '700', 'none'])
    expect(await page.locator('.q-appheader .q-wordmark').evaluate((element) => getComputedStyle(element).fontSize)).toBe('19px')
    await page.getByRole('button', { name: 'About', exact: true }).click()
    await page.locator('.q-about-title').waitFor()
    expect(await page.locator('.q-about-title').evaluate((element) => getComputedStyle(element).fontSize)).toBe('22px')
    expect(await page.locator('.q-about .q-wordmark').count()).toBe(0)
    expect(await page.locator('.q-about-name').textContent()).toBe('Listulator')
  })
})
