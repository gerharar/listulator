import { expect, test, type Page } from '@playwright/test'
import { de } from '../src/locale/de.js'
import { en } from '../src/locale/en.js'
import { ru } from '../src/locale/ru.js'
import { decodePng } from './pngPixels.js'

/**
 * Settings → Theme → Show Spectrum border (50.7, X-006; moved from Screen to Theme by design's answer 15 of 2026-11-13), in both engines. eX-Zed only, directly under the theme chips, on by default; turning it off puts `data-border="off"` on `<html>` at
 * once (the stripes around the app go and the ground is plain black; Lotus has no border at all, the paper runs on), it is remembered, and a stored "off" is on the page before the first frame. It is
 * not there under Quantum. The words are in the locale (the tooltip is design's proposal; the Russian and German are drafts for the owner to read).
 */
const LABEL = en.quantum.settings.spectrumBorder

async function boot(page: Page, stored: Record<string, string>, width = 3440, height = 1440) {
  await page.setViewportSize({ width, height })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: 'exzed-1d', ...stored }))
}

async function openSettings(page: Page, label = 'Settings') {
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.locator('.q-settings').waitFor()
}

const box = (page: Page, name: string = LABEL) => page.getByRole('checkbox', { name, exact: true })
const attribute = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-border'))
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('spectrumBorder'))
const image = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector('.q-backdrop')!).backgroundImage)

/** The colours of the left border (x 0 to 439 of a 3440 screen, the whole height), as the distinct values a screenshot of it holds. */
async function colours(page: Page) {
  const seen = decodePng(await page.screenshot({ clip: { x: 0, y: 0, width: 440, height: 1440 } }))
  const distinct = new Set<string>()
  for (let at = 0; at < seen.data.length; at += 4) distinct.add(`${seen.data[at]},${seen.data[at + 1]},${seen.data[at + 2]}`)

  return [...distinct].sort()
}

test('the checkbox is directly under the theme chips (16px below them), no longer in Screen, ticked, and the page has no data-border', async ({ page }) => {
  await boot(page, {})
  await openSettings(page)

  const theme = page.locator('.q-settings section', { has: page.getByText(en.quantum.settings.theme, { exact: true }) })
  const screen = page.locator('.q-settings section', { has: page.getByText(en.quantum.settings.screen, { exact: true }) })
  expect(await theme.locator('label.q-settings-check').allTextContents(), 'the Theme section holds it, alone').toEqual([LABEL])
  expect(await screen.locator('label.q-settings-check').allTextContents(), 'Screen keeps only the app’s own options').not.toContain(LABEL)
  expect((await screen.locator('label.q-settings-check').allTextContents()).at(-1)).toBe(en.quantum.settings.showTimeLeft)

  // Directly under the chips: the label's box starts 16px below the chips' row (the board's section gap).
  const chips = (await theme.locator('.q-settings-row').boundingBox())!
  const label = (await theme.locator('label.q-settings-check').boundingBox())!
  expect(label.y - (chips.y + chips.height), 'the checkbox is 16px below the chips').toBeCloseTo(16, 0)
  await expect(box(page)).toBeChecked()
  expect(await attribute(page)).toBeNull()
  expect(await image(page)).toContain('border-stripes')
})

test('unticked, it takes the stripes away at once and leaves the ground plain black; ticked again they come back', async ({ page }) => {
  await boot(page, {})
  await openSettings(page)
  const stripes = await colours(page)
  expect(stripes.length, 'the stripes are two colours (and no black: normal blue and normal yellow bars)').toBe(2)

  await box(page).uncheck()
  expect(await attribute(page)).toBe('off')
  expect(await image(page)).toBe('none')
  expect(await colours(page), 'plain black').toEqual(['0,0,0'])
  expect(await stored(page)).toBe('false')

  await box(page).check()
  expect(await attribute(page)).toBeNull()
  expect(await colours(page)).toEqual(stripes)
  expect(await stored(page)).toBe('true')
})

test('in Lotus there is no border: the paper runs to both edges of the screen, ticked or unticked, and the switch is disabled with its reason (50.13, design answer 12)', async ({ page }) => {
  await boot(page, { exzedSkin: 'exzed-1l' })
  await openSettings(page)
  const paper = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zx-stage').trim())
  const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)].join(',')
  expect(await colours(page), 'the left of the screen is the paper').toEqual([rgb(paper)])
  expect(await image(page)).toBe('none')

  // The right side too, and no line between the app's box and the paper beside it: a column inside the box and one outside, in a band with nothing drawn on it.
  const right = decodePng(await page.screenshot({ clip: { x: 3000, y: 100, width: 440, height: 600 } }))
  const distinct = new Set<string>()
  for (let at = 0; at < right.data.length; at += 4) distinct.add(`${right.data[at]},${right.data[at + 1]},${right.data[at + 2]}`)
  expect([...distinct], 'the right of the screen is the paper').toEqual([rgb(paper)])

  await expect(box(page)).toBeDisabled()
  await box(page).hover({ force: true })
  await expect(page.getByRole('tooltip')).toHaveText(en.quantum.settings.spectrumBorderLotusTip)
})

test('on Lotus the stored choice is kept: a stored "off" still shows unticked, and the dark skins have it again when the skin changes', async ({ page }) => {
  await boot(page, { exzedSkin: 'exzed-1l', spectrumBorder: 'false' })
  await openSettings(page)
  await expect(box(page)).toBeDisabled()
  await expect(box(page)).not.toBeChecked()
  expect(await stored(page)).toBe('false')
  await page.getByRole('button', { name: 'Lode' }).click()
  await expect(box(page), 'the dark skins have the switch again, as it was left').toBeEnabled()
  await expect(box(page)).not.toBeChecked()
  expect(await attribute(page)).toBe('off')
})

test('it is remembered both ways across a restart, and a stored "off" is on the page before the first frame', async ({ page }) => {
  await boot(page, { spectrumBorder: 'false' })
  // `data-border` the first time the shell is in the page: before any frame is painted, so no frame has the stripes.
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.q-shell')) return
      Object.assign(window, { __firstBorder: document.documentElement.getAttribute('data-border') })
      observer.disconnect()
    })
    observer.observe(document, { childList: true, subtree: true })
  })
  await openSettings(page)
  expect(await page.evaluate(() => (window as unknown as { __firstBorder?: string | null }).__firstBorder), 'the attribute the first time the shell is drawn').toBe('off')
  await expect(box(page)).not.toBeChecked()

  await page.reload()
  await page.locator('.q-home-row').first().waitFor()
  expect(await attribute(page)).toBe('off')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await box(page).check()
  await page.reload()
  await page.locator('.q-home-row').first().waitFor()
  expect(await attribute(page)).toBeNull()
  expect(await stored(page)).toBe('true')
})

test('it is not in Settings under Quantum', async ({ page }) => {
  await boot(page, { theme: 'quantum' })
  await openSettings(page)

  await expect(box(page)).toHaveCount(0)
  const last = await page.locator('.q-settings label.q-settings-check').last().textContent()
  expect(last).toBe(en.quantum.settings.showTimeLeft)
})

test('it has its own words in English, Russian and German, and each is the box’s description for a screen reader', async ({ page }) => {
  await boot(page, {})
  await openSettings(page)

  await expect(box(page)).toHaveAttribute('aria-description', en.quantum.settings.spectrumBorderTip)
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await expect(box(page, ru.quantum.settings.spectrumBorder)).toHaveAttribute('aria-description', ru.quantum.settings.spectrumBorderTip)
  await page.getByRole('button', { name: 'Deutsch', exact: true }).click()
  await expect(box(page, de.quantum.settings.spectrumBorder)).toHaveAttribute('aria-description', de.quantum.settings.spectrumBorderTip)
})
