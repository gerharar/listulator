import { expect, test, type Page } from '@playwright/test'
import { de } from '../src/locale/de.js'
import { en } from '../src/locale/en.js'
import { ru } from '../src/locale/ru.js'
import { decodePng } from './pngPixels.js'

/**
 * Settings → Screen → Show Spectrum border (50.7, X-006), in both engines. eX-Zed only, last in the group, on by default; turning it off puts `data-border="off"` on `<html>` at
 * once (the stripes around the app go and the ground is plain black; Lotus stays white), it is remembered, and a stored "off" is on the page before the first frame. It is
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

test('the checkbox is the last of Screen under eX-Zed, ticked, and the page has no data-border', async ({ page }) => {
  await boot(page, {})
  await openSettings(page)

  const screenBoxes = await page.locator('.q-settings section', { has: page.getByText(en.quantum.settings.screen, { exact: true }) }).locator('label.q-settings-check').allTextContents()
  expect(screenBoxes.at(-1)).toBe(LABEL)
  expect(screenBoxes.at(-2)).toBe(en.quantum.settings.showTimeLeft)
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

test('in Lotus the border is white ticked and unticked', async ({ page }) => {
  await boot(page, { exzedSkin: 'exzed-1l' })
  await openSettings(page)
  expect(await colours(page)).toEqual(['255,255,255'])

  await box(page).uncheck()
  expect(await colours(page), 'still plain bright white').toEqual(['255,255,255'])
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
