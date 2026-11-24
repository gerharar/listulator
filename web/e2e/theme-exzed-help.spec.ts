import { expect, test, type Locator, type Page } from '@playwright/test'
import { en } from '../src/locale/en.js'
import { q } from './fixtures.js'

/**
 * Rule 6 in eX-Zed (57.10; `DESIGN.md` section 5: (i) is about content, (?) is about the app, (!) marks a refusal), on the real screens, in both engines and all six skins. The (?) is design's pixel
 * `help` icon (a solid cell with the ? cut out): the header's About and the (?) after a setting's label (Enhance group arrows, Show time left in My Lists, and, eX-Zed's own, Show Spectrum border: its
 * label's hover tooltip is gone) are a 32 by 32 ghost button (a 2px transparent border) with a 16px icon in `ctl`, lit by the highlight block on hover and while the popover is open; a click opens the
 * popover, Esc closes it and focus goes back; it never opens on hover. The API-key marks draw the same icon, but only the desktop app shows the keys (jsdom reads them, ApiKeysSection.test.tsx).
 * The Import refusal's (!) is the pixel mark before the sentence: 16px, `ink2`, 8px before it, never red, and the stock line icon is not drawn.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
const text = en.quantum.settings

async function seed(page: Page, skin: string) {
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

async function openSettings(page: Page, skin: string) {
  await seed(page, skin)
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('.q-settings').waitFor()
  await page.evaluate(() => document.fonts.ready)
}

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgb = (hex: string) => {
  const h = hex.replace('#', '')

  return `rgb(${[0, 2, 4].map((at) => parseInt(h.slice(at, at + 2), 16)).join(', ')})`
}
const styleOf = (locator: Locator, names: string[]) => locator.evaluate((el, props) => Object.fromEntries(props.map((p) => [p, getComputedStyle(el).getPropertyValue(p)])), names)
const lineIcons = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('svg')]
      .filter((svg) => {
        const s = getComputedStyle(svg)
        const b = svg.getBoundingClientRect()

        return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 1 && b.height > 1 && s.fill === 'none' && s.stroke !== 'none'
      })
      .map((svg) => svg.closest('button, a, span')?.className ?? '?'),
  )

for (const skin of SKINS) {
  test.describe(skin, () => {
    test('the header’s About is the pixel (?) in its button, and Home shows no line icon', async ({ page }) => {
      await seed(page, skin)
      await page.goto('/')
      await page.locator('.q-home-row').first().waitFor()

      const button = page.getByRole('button', { name: 'About', exact: true })
      await expect(button.locator('svg[data-pixel-icon="help"]')).toHaveCount(1)
      await expect(button.locator('svg[data-pixel-icon="about"]')).toHaveCount(0)
      const box = (await button.locator('svg').boundingBox())!
      expect([box.width, box.height]).toEqual([16, 16])
      expect(await lineIcons(page), 'Home').toEqual([])
    })

    test('each setting with an explanation has a 32px ghost (?) with the pixel help icon in ctl, and Settings has no line icon (Enhance, Show time left, Show Spectrum border)', async ({ page }) => {
      await openSettings(page, skin)
      const ctl = rgb(await token(page, '--zx-ctl'))

      const labels = [text.markOpenGroups, text.showTimeLeft, text.spectrumBorder]
      for (const label of labels) {
        const help = page.getByRole('button', { name: `About ${label}`, exact: true })
        await expect(help, label).toHaveCount(1)
        await expect(help.locator('svg[data-pixel-icon="help"]'), label).toHaveCount(1)
        await expect(help.locator('svg.lucide'), `no line icon: ${label}`).toHaveCount(0)
        const box = (await help.boundingBox())!
        expect([box.width, box.height], `${label}: 32px`).toEqual([32, 32])
        expect(await styleOf(help, ['border-top-width', 'border-top-style', 'border-top-color', 'color', 'background-color', 'cursor']), label).toMatchObject({
          'border-top-width': '2px',
          'border-top-style': 'solid',
          'border-top-color': 'rgba(0, 0, 0, 0)',
          color: ctl,
          'background-color': 'rgba(0, 0, 0, 0)',
          cursor: 'pointer',
        })
        const icon = (await help.locator('svg').boundingBox())!
        expect([icon.width, icon.height], `${label}: the icon`).toEqual([16, 16])
        expect(Math.abs(icon.x + icon.width / 2 - (box.x + box.width / 2)), `${label}: centred`).toBeLessThan(1)
      }
      expect(await lineIcons(page), 'Settings').toEqual([])
    })

    test('the (?) is lit by the highlight block on hover and while its popover is open, and it opens on a click only, not on hover', async ({ page }) => {
      await openSettings(page, skin)
      const [hlBg, hlInk] = [rgb(await token(page, '--zx-hl-bg')), rgb(await token(page, '--zx-hl-ink'))]
      const help = page.getByRole('button', { name: `About ${text.showTimeLeft}`, exact: true })

      await help.hover()
      expect(await styleOf(help, ['background-color', 'color']), 'hover').toEqual({ 'background-color': hlBg, color: hlInk })
      await page.waitForTimeout(900)
      await expect(page.getByRole('dialog'), 'hover opens nothing').toHaveCount(0)

      await help.click()
      await page.mouse.move(2, 2)
      await expect(page.getByRole('dialog')).toBeVisible()
      expect(await styleOf(help, ['background-color', 'color']), 'while open').toEqual({ 'background-color': hlBg, color: hlInk })
    })

    test('a click opens the 480px popover with the label as a kicker and the explanation in 16px and no bold; Esc closes it and focus goes back to the (?)', async ({ page }) => {
      await openSettings(page, skin)
      const help = page.getByRole('button', { name: `About ${text.markOpenGroups}`, exact: true })

      await help.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('strong')).toHaveText(text.markOpenGroups)
      await expect(dialog).toContainText(text.markOpenGroupsTip)
      expect((await dialog.boundingBox())!.width, 'D63: a 480px popover').toBe(480)
      expect(await styleOf(dialog.locator('.q-help-pop'), ['font-size', 'line-height']), 'the explanation').toEqual({ 'font-size': '16px', 'line-height': '24px' })
      const lab = rgb(await token(page, '--zx-lab'))
      expect(await styleOf(dialog.locator('strong'), ['font-size', 'font-weight', 'text-transform', 'color']), 'the label is a kicker: capitals in lab').toEqual({ 'font-size': '16px', 'font-weight': '400', 'text-transform': 'uppercase', color: lab })

      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(help).toBeFocused()
    })

    test('Show Spectrum border has no hover tooltip on its label, and its (?) says the words: the usual ones, and on Lotus (where the box is disabled and the (?) still works) the Lotus ones', async ({ page }) => {
      await openSettings(page, skin)
      const box = page.getByRole('checkbox', { name: text.spectrumBorder, exact: true })

      await page.locator('label.q-settings-check', { hasText: text.spectrumBorder }).hover({ force: true })
      await page.waitForTimeout(900)
      await expect(page.getByRole('tooltip'), 'no tooltip on the label').toHaveCount(0)

      const lotus = skin === 'exzed-1l'
      const words = lotus ? text.spectrumBorderLotusTip : text.spectrumBorderTip
      await expect(box).toHaveAttribute('aria-description', words)
      expect(await box.isDisabled()).toBe(lotus)
      const help = page.getByRole('button', { name: `About ${text.spectrumBorder}`, exact: true })
      await expect(help).toBeEnabled()
      await help.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.locator('strong')).toHaveText(text.spectrumBorder)
      await expect(dialog).toContainText(words)
    })

    test('its line sits under the theme chips with the board’s 16px, and the (?) follows the label on the same row', async ({ page }) => {
      await openSettings(page, skin)
      const theme = page.locator('.q-settings section', { has: page.getByText(text.theme, { exact: true }) })
      const chips = (await theme.locator('.q-settings-row').boundingBox())!
      const label = (await theme.locator('label.q-settings-check').boundingBox())!
      const help = (await theme.getByRole('button', { name: `About ${text.spectrumBorder}`, exact: true }).boundingBox())!

      // The label's own 8px padding is in its box: 16px of margin under the chips.
      expect(label.y - (chips.y + chips.height), 'under the chips').toBe(16)
      expect(Math.abs(label.y + label.height / 2 - (help.y + help.height / 2)), 'one row, centred').toBeLessThan(1)
      expect(help.x - (label.x + label.width), 'after the label').toBeGreaterThanOrEqual(0)
    })

    test('an Import refusal starts with the pixel (!): 16px, ink2, 8px before the sentence, never red, and the stock line icon is not drawn (rule 6)', async ({ page }) => {
      await seed(page, skin)
      await page.goto('/')
      await page.getByRole('button', { name: q.home.newList }).click()
      await page.locator('.q-tile', { hasText: /^Movies/ }).click()
      await page.getByRole('tab', { name: q.createList.importTab }).click()
      await page.getByLabel(q.importFile.boxLabel).fill('title: X\ncategory: board games\nitems:\n  - { title: A }\n')
      await page.getByRole('button', { name: q.importFile.import, exact: true }).click()

      const line = page.getByRole('alert')
      await expect(line).toBeVisible()
      const ink2 = rgb(await token(page, '--zx-ink2'))
      expect(await lineIcons(page), 'no line icon').toEqual([])
      const mark = await line.evaluate((el) => {
        const before = getComputedStyle(el, '::before')
        const sentence = el.lastElementChild as HTMLElement
        const range = document.createRange()
        range.selectNodeContents(sentence)

        return { width: before.width, height: before.height, background: before.backgroundColor, mask: before.maskImage || before.webkitMaskImage, gap: getComputedStyle(el).columnGap, color: getComputedStyle(el).color, lineSvg: getComputedStyle(el.querySelector('svg')!).display }
      })
      expect(mark).toMatchObject({ width: '16px', height: '16px', background: ink2, gap: '8px', color: ink2, lineSvg: 'none' })
      expect(mark.mask, 'drawn from the 8x8 cells').toContain('M3 0h2v5H3zM3 6h2v2H3z')
    })
  })
}
