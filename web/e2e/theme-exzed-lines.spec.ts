import { expect, test, type Locator, type Page } from '@playwright/test'
import { en } from '../src/locale/en.js'
import { useHomeFixture } from './fixtures.js'

/**
 * No 1px line in eX-Zed, and the Platform panel drawn (57.9c and 57.9d, design's D59, D60 and D61; X-004, X-008): every line the theme draws is a 2px cell, read here from the computed
 * styles on the real screens, in both engines.
 *  - the filter bar's line is 2px `frame` and its row is 66px (12 + 40 + 12 + 2); Hide Done and Collapse / Expand are ghost buttons (2px transparent border, no fill, 40px); To Top / To Bottom are two
 *    40px icon buttons, no box and no line between them; 2px by 16px `frame` dividers (the `::before` of the button or group) stand before Hide Done, Collapse and the pair, 8px either side (D62);
 *  - the tooltip is 2px `frame-hi` on `paper`, no ring, no shadow; About's TMDB line is the link underline's dotted rule (a 2px / 2px gradient in `frame`), not a border;
 *  - the Platform panel: its search is a Field (40px, 2px `frame`, 16px), its row, section and list-top lines are 2px `frame`, its check boxes the done box (16px, 2px `frame`, the tick a drawn mask, no glyph),
 *    all its text 16px at weight 400, the picked chip the ToggleChip card's removable chip (32px, 2px `frame`, no fill, the name 12px in, the `close` icon in a 24px block 4px from the right edge and 8px
 *    after the name, hover lighting only that block);
 *  - the Vault's caption is the kicker: 16px `lab` capitals at weight 400 (D62 put it back to `lab`).
 */
const SKIN = 'exzed-1d'

async function boot(page: Page, skin = SKIN) {
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
const css = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
const colours = async (page: Page, names: string[]) => (await Promise.all(names.map((n) => token(page, n)))).map((hex) => css(hex))
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)
const box = (locator: Locator) =>
  locator.evaluate((element) => {
    const { left, top, width, height, right, bottom } = element.getBoundingClientRect()

    return { left, top, width, height, right, bottom }
  })
const TRANSPARENT = 'rgba(0, 0, 0, 0)'
/** A pseudo-element's own box, as the computed style gives it (it has no rectangle to measure). */
const pseudo = (locator: Locator, which: '::before' | '::after') =>
  locator.evaluate((element, w) => {
    const s = getComputedStyle(element, w)

    return { width: s.width, height: s.height, background: s.backgroundColor, left: s.left, top: s.top }
  }, which)

async function makeList(page: Page, category: string, label: string, count: number) {
  const rows = Array.from({ length: count }, (_, n) => `  - { title: "Thing ${n + 1}", minutes: 30, group: "Part ${n < count / 2 ? 1 : 2}" }`)
  const title = `e2e lines ${label} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`
  const made = await page.request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: ${category}\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)

  return { id: ((await made.json()) as { id: string }).id, title }
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
  await page.waitForFunction(() => document.getAnimations().length === 0)
  await page.evaluate(() => document.fonts.ready)
}

test('the list toolbar draws no 1px line: the filter bar is 2px frame and 66px, Hide Done and Collapse are ghost buttons, To Top and To Bottom two 40px buttons after a 2px divider', async ({ page }) => {
  const { id, title } = await makeList(page, 'movie', 'toolbar', 300)
  try {
    await boot(page)
    await openList(page, title)
    const [frame, ctl] = await colours(page, ['--zx-frame', '--zx-ctl'])

    const bar = page.locator('.q-filterbar')
    expect(await style(bar, ['border-bottom-width', 'border-bottom-style', 'border-bottom-color']), 'the filter bar’s line').toEqual({ 'border-bottom-width': '2px', 'border-bottom-style': 'solid', 'border-bottom-color': frame })
    expect((await box(bar)).height, '12 + 40 + 12 + the 2px line').toBe(66)

    for (const selector of ['.q-hide-done', '.q-fold']) {
      const button = page.locator(selector)
      expect(await style(button, ['border-top-width', 'border-top-style', 'border-top-color', 'border-bottom-width', 'background-color', 'color']), `${selector}: ghost, a 2px transparent border`).toEqual({
        'border-top-width': '2px',
        'border-top-style': 'solid',
        'border-top-color': TRANSPARENT,
        'border-bottom-width': '2px',
        'background-color': TRANSPARENT,
        color: ctl,
      })
      const rest = await box(button)
      expect(rest.height, `${selector} is the toolbar’s 40px`).toBe(40)
      expect(await style(button, ['padding-left', 'padding-right', 'column-gap']), `${selector}: 8px at the sides and 8px between icon and word (D62)`).toEqual({ 'padding-left': '8px', 'padding-right': '8px', 'column-gap': '8px' })
      expect(await pseudo(button, '::before'), `${selector}: the divider before it, 2px by 16px in frame, centred on the 40px row, 8px from the button before`).toEqual({ width: '2px', height: '16px', background: frame, left: '-8px', top: '10px' })
      await button.hover()
      expect(await box(button), `${selector}: the size never changes on hover`).toEqual(rest)
      await page.mouse.move(0, 0)
    }

    const ends = page.locator('.q-ends')
    await ends.waitFor()
    expect(await style(ends, ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']), 'the pair has no box').toEqual({
      'border-top-width': '0px',
      'border-right-width': '0px',
      'border-bottom-width': '0px',
      'border-left-width': '0px',
    })
    expect(await pseudo(ends, '::before'), 'and the divider before it').toEqual({ width: '2px', height: '16px', background: frame, left: '-10px', top: '12px' })
    const [noteBox, hideBox, foldBox0, endsBox0] = await Promise.all([box(page.locator('.q-filter-note')), box(page.locator('.q-hide-done')), box(page.locator('.q-fold')), box(ends)])
    expect(foldBox0.left - hideBox.right, 'Hide Done and Collapse are 18px apart: 8, the divider’s 2, and 8').toBe(18)
    expect(endsBox0.left - foldBox0.right, 'and Collapse and the pair').toBe(18)
    expect(hideBox.left - noteBox.right, 'and the count and Hide Done').toBe(18)
    const [top, bottom, fold] = await Promise.all([box(page.locator('.q-ends-half').first()), box(page.locator('.q-ends-half').last()), box(page.locator('.q-fold'))])
    expect([top.width, top.height, bottom.width, bottom.height], 'two 40 x 40 buttons').toEqual([40, 40, 40, 40])
    expect(bottom.left, 'side by side, no line between them').toBe(top.right)
    expect(top.top).toBe(bottom.top)
    expect((await box(ends)).left, 'after Collapse / Expand').toBeGreaterThan(fold.right)
    for (const half of [page.locator('.q-ends-half').first(), page.locator('.q-ends-half').last()]) {
      expect(await style(half, ['border-top-width', 'border-top-color', 'background-color']), 'an icon button: a transparent 2px border').toMatchObject({ 'border-top-width': '2px', 'border-top-color': TRANSPARENT })
    }
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the tooltip is a 2px frame-hi box on paper, with no shadow', async ({ page }) => {
  const { id, title } = await makeList(page, 'movie', 'tooltip', 40)
  try {
    await boot(page)
    await openList(page, title)
    const [frameHi, paper] = await colours(page, ['--zx-frame-hi', '--zx-paper'])
    await page.locator('.q-fold').hover()
    const tip = page.locator('.q-tooltip')
    await tip.waitFor()

    expect(await style(tip, ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-top-color', 'background-color', 'box-shadow', 'font-size', 'font-weight'])).toEqual({
      'border-top-width': '2px',
      'border-right-width': '2px',
      'border-bottom-width': '2px',
      'border-left-width': '2px',
      'border-top-style': 'solid',
      'border-top-color': frameHi,
      'background-color': paper,
      'box-shadow': 'none',
      'font-size': '16px',
      'font-weight': '400',
    })
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('About’s TMDB line is the dotted link rule: 2px dots 2px apart in frame, not a border', async ({ page }) => {
  await boot(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'About', exact: true }).click()
  const attribution = page.locator('.q-about-attribution')
  await attribution.waitFor()
  const [frame] = await colours(page, ['--zx-frame'])

  expect(await style(attribution, ['border-top-width', 'border-top-style', 'background-size', 'background-position']), 'no border: the rule is a background').toMatchObject({ 'border-top-width': '0px', 'border-top-style': 'none', 'background-size': '100% 2px' })
  const image = (await style(attribution, ['background-image']))['background-image']!
  expect(image, 'a repeating gradient of 2px dots 2px apart').toMatch(/^repeating-linear-gradient\(90deg, /)
  expect(image).toContain(frame)
  expect(image).toMatch(/2px, rgba\(0, 0, 0, 0\) 2px, rgba\(0, 0, 0, 0\) 4px|0px, \S+ 2px, rgba\(0, 0, 0, 0\) 2px, rgba\(0, 0, 0, 0\) 4px/)
})

for (const skin of ['exzed-1d', 'exzed-1l'] as const) {
  test(`${skin}: the Platform panel draws a Field, 2px lines, the done box and 16px regular text, and a picked platform is the ToggleChip card's removable chip`, async ({ page }) => {
    const { id, title } = await makeList(page, 'game', `panel ${skin}`, 4)
    try {
      await boot(page, skin)
      await openList(page, title)
      const [frame, paper, ink, ctl, acc, accInk] = await colours(page, ['--zx-frame', '--zx-paper', '--zx-ink', '--zx-ctl', '--zx-acc', '--zx-acc-ink'])
      await page.locator('.q-item', { hasText: 'Thing 1' }).locator('.q-icon-btn.edit').click()
      await page.locator('.q-platfield').click()
      const panel = page.locator('.q-platpanel')
      await panel.waitFor()
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.q-platpanel')!).opacity === '1')
      await page.locator('.q-platpanel-row').first().click()
      await page.locator('.q-platpanel-token').first().waitFor()

      // Every piece of text in the panel is 16px at weight 400, with no letter-spacing.
      const offenders = await panel.evaluate((root) =>
        [root, ...root.querySelectorAll('*')]
          .filter((element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent!.trim() !== ''))
          .map((element) => ({ element, style: getComputedStyle(element) }))
          .filter(({ style: s }) => s.fontSize !== '0px' && (s.fontSize !== '16px' || s.fontWeight !== '400' || !['normal', '0px'].includes(s.letterSpacing)))
          .map(({ element, style: s }) => `${element.className} ${s.fontSize}/${s.fontWeight}/${s.letterSpacing}`),
      )
      expect(offenders, 'text off the 16px / 400 rule').toEqual([])

      // The search is a Field.
      expect(await style(page.locator('.q-platpanel-search'), ['height', 'border-top-width', 'border-top-color', 'background-color', 'color', 'font-size', 'font-weight'])).toEqual({
        height: '40px',
        'border-top-width': '2px',
        'border-top-color': frame,
        'background-color': paper,
        color: ink,
        'font-size': '16px',
        'font-weight': '400',
      })

      // The lines are 2px frame rules.
      expect(await style(page.locator('.q-platpanel-list'), ['border-top-width', 'border-top-style', 'border-top-color'])).toEqual({ 'border-top-width': '2px', 'border-top-style': 'solid', 'border-top-color': frame })
      expect(await style(page.locator('.q-platpanel-section').first(), ['border-bottom-width', 'border-bottom-color'])).toEqual({ 'border-bottom-width': '2px', 'border-bottom-color': frame })
      expect(await style(page.locator('.q-platpanel-row').first(), ['border-bottom-width', 'border-bottom-color'])).toEqual({ 'border-bottom-width': '2px', 'border-bottom-color': frame })

      // The check boxes are the done box: 16px, 2px frame, the tick a mask on a picked row and nothing on the others, never a glyph.
      const picked = page.locator('.q-platpanel-row[aria-pressed="true"] .q-platpanel-box').first()
      const empty = page.locator('.q-platpanel-row[aria-pressed="false"] .q-platpanel-box').first()
      for (const [name, boxEl] of [['picked', picked], ['empty', empty]] as const) {
        expect(await style(boxEl, ['width', 'height', 'border-top-width', 'border-top-color', 'background-color', 'font-size']), `the ${name} box`).toEqual({ width: '16px', height: '16px', 'border-top-width': '2px', 'border-top-color': frame, 'background-color': paper, 'font-size': '0px' })
      }
      const tick = await picked.evaluate((el) => {
        const after = getComputedStyle(el, '::after')

        return { content: after.content, background: after.backgroundColor, mask: after.maskImage || after.webkitMaskImage }
      })
      expect(tick.background, 'the tick is drawn in ink').toBe(ink)
      expect(tick.mask, 'as a mask, never a glyph').toMatch(/^url\(/)
      expect(await empty.evaluate((el) => getComputedStyle(el, '::after').content), 'an unpicked box draws no tick').toMatch(/^(none|normal)$/)

      // The chip.
      const chip = page.locator('.q-platpanel-token').first()
      const close = chip.locator('svg')
      expect(await style(chip, ['height', 'border-top-width', 'border-top-style', 'border-top-color', 'background-color', 'color', 'font-size', 'font-weight', 'letter-spacing'])).toMatchObject({
        height: '32px',
        'border-top-width': '2px',
        'border-top-style': 'solid',
        'border-top-color': frame,
        'background-color': TRANSPARENT,
        color: ink,
        'font-size': '16px',
        'font-weight': '400',
      })
      const [chipBox, closeBox, nameLeft, nameRight] = await Promise.all([
        box(chip),
        box(close),
        chip.evaluate((el) => { const range = document.createRange(); range.selectNodeContents(el.firstChild!); return range.getBoundingClientRect().left }),
        chip.evaluate((el) => { const range = document.createRange(); range.selectNodeContents(el.firstChild!); return range.getBoundingClientRect().right }),
      ])
      expect(nameLeft - chipBox.left, 'the name starts 12px in').toBe(12)
      expect([closeBox.width, closeBox.height], 'the close icon sits in a 24px block').toEqual([24, 24])
      expect(await style(close, ['padding-top', 'padding-left', 'color']), 'the 16px icon inside it, in ctl').toEqual({ 'padding-top': '4px', 'padding-left': '4px', color: ctl })
      expect(chipBox.right - closeBox.right, 'the block is 4px from the right edge').toBe(4)
      expect(closeBox.left - nameRight, 'and 8px after the name').toBe(8)
      expect(closeBox.top - chipBox.top, 'centred in the 32px chip').toBe((chipBox.height - closeBox.height) / 2)

      // Hover lights the block alone.
      await chip.locator('svg').hover()
      expect(await style(close, ['background-color', 'color']), 'the block is the highlight').toEqual({ 'background-color': acc, color: accInk })
      expect((await style(chip, ['background-color']))['background-color'], 'the chip does not light').toBe(TRANSPARENT)
      await page.mouse.move(chipBox.left + 14, chipBox.top + 16)
      expect((await style(close, ['background-color']))['background-color'], 'the pointer on the name leaves the block unlit').toBe(TRANSPARENT)
      expect((await style(chip, ['background-color']))['background-color'], 'and the chip unlit').toBe(TRANSPARENT)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}

test('the Vault’s caption is the kicker: 16px lab capitals at weight 400', async ({ page }) => {
  await boot(page)
  await useHomeFixture(page)
  const entry = (n: number) => ({ externalRef: `canonical:lists/movie/${n}.yaml`, title: `Movie list ${n}`, category: 'movie', itemCount: 10 + n, totalMinutes: 600 + n * 60, status: 'ongoing', tracked: false })
  const library = Array.from({ length: 3 }, (_, n) => entry(n))
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [library[0]], reachable: true } }))
  await page.route('**/api/library', (route) => route.fulfill({ json: { entries: library, reachable: true } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.getByRole('button', { name: en.quantum.vaultShelf.browse }).click()
  await page.locator('.q-vb-cat', { hasText: 'Movies' }).click()
  const caption = page.locator('.q-vb-caption')
  await caption.waitFor()
  const [lab] = await colours(page, ['--zx-lab'])

  expect(await style(caption, ['color', 'font-size', 'font-weight', 'letter-spacing', 'text-transform'])).toMatchObject({ color: lab, 'font-size': '16px', 'font-weight': '400', 'text-transform': 'uppercase' })
})
