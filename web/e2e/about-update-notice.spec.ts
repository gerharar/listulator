import { expect, test, type Locator, type Page } from '@playwright/test'
import { de } from '../src/locale/de.js'
import { en } from '../src/locale/en.js'
import { ru } from '../src/locale/ru.js'
import { useHomeFixture } from './fixtures.js'

/**
 * The update block's notice row (canvas H-017), in a real browser: the card must not change width, the status line and the
 * button must not move when the row appears, and the row must be one line inside the card. jsdom cannot lay any of that out.
 * The development build's checker (`?aboutUpdate=available`, `?aboutUpdate=installError`) stands in for the desktop updater.
 */

const LOCALES = { en, ru, de } as const
const AGENTS = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
} as const

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('no box')

  return found
}

async function openAbout(page: Page, mode: 'available' | 'installError', language: keyof typeof LOCALES): Promise<void> {
  await useHomeFixture(page)
  await page.addInitScript((code) => localStorage.setItem('language', code), language)
  await page.goto(`/?aboutUpdate=${mode}`)
  const t = LOCALES[language].quantum
  await expect(page.getByRole('heading', { name: t.home.title })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: t.appHeader.about, exact: true }).click()
  await expect(page.locator('.q-about')).toBeVisible()
}

// The label a reader sees: the stacked variants that are not hidden (the others sit in the same cell, `off`).
const label = (button: Locator) => button.locator('.q-about-stack > :not(.off)')

// A card is drawn slightly scaled while a layer settles: measure after it has.
const settle = (page: Page) => page.waitForTimeout(400)

for (const platform of ['windows', 'mac'] as const) {
  test.describe(`on ${platform}`, () => {
    test.use({ userAgent: AGENTS[platform] })

    for (const language of ['en', 'ru', 'de'] as const) {
      test(`${language}: the row appears with the offer without moving the status line or the button, or widening the card`, async ({ page }) => {
        const t = LOCALES[language].quantum.about
        const words = platform === 'mac' ? t.updateNoticeRestart : t.updateNoticeWindows
        await openAbout(page, 'available', language)
        const card = page.locator('.q-about-update-block')
        const text = page.locator('.q-about-update-text')
        const button = card.getByRole('button')
        await settle(page)

        // Checking: no row.
        await expect(label(button)).toHaveText(t.checking)
        await expect(page.locator('.q-about-update-notice')).toHaveCount(0)
        const before = { card: await box(card), text: await box(text), button: await box(button) }

        // Available: the row arrives.
        await expect(page.locator('.q-about-update-notice')).toHaveText(words)
        await expect(label(button)).toHaveText(t.download)
        const after = { card: await box(card), text: await box(text), button: await box(button) }
        const row = page.locator('.q-about-update-notice')
        const rowBox = await box(row)
        const rowText = await box(row.locator('span'))

        expect(Math.abs(after.card.width - before.card.width), 'the card keeps its width').toBeLessThanOrEqual(0.5)
        expect(Math.abs(after.text.x - before.text.x), 'status column x').toBeLessThanOrEqual(0.5)
        expect(Math.abs(after.text.y - before.text.y), 'status column y').toBeLessThanOrEqual(0.5)
        expect(Math.abs(after.button.x - before.button.x), 'button x').toBeLessThanOrEqual(0.5)
        expect(Math.abs(after.button.y - before.button.y), 'button y').toBeLessThanOrEqual(0.5)
        // The card grows down by the row and its gap, and only by that.
        expect(after.card.height).toBeGreaterThan(before.card.height + 10)
        expect(after.card.height - before.card.height).toBeLessThanOrEqual(10 + 18 + 0.5)
        // One line, inside the card, under the status and the button.
        expect(rowBox.height).toBeLessThanOrEqual(18.5)
        expect(rowBox.y).toBeGreaterThanOrEqual(Math.max(after.text.y + after.text.height, after.button.y + after.button.height) - 0.5)
        expect(rowText.x + rowText.width).toBeLessThanOrEqual(after.card.x + after.card.width - 14 + 0.5)
      })
    }
  })
}

test('the row stays through every phase of the update and goes when the install fails', async ({ page }) => {
  await openAbout(page, 'installError', 'en')
  const t = en.quantum.about
  const card = page.locator('.q-about-update-block')
  const row = page.locator('.q-about-update-notice')
  await settle(page)
  await expect(label(card.getByRole('button'))).toHaveText(t.download)
  await expect(row).toHaveCount(1)
  const offered = await box(card)

  await card.getByRole('button').click()
  await expect(label(card.getByRole('button'))).toHaveText(t.downloading)
  await expect(row).toHaveCount(1)
  await expect(label(card.getByRole('button'))).toHaveText(t.installing)
  await expect(row).toHaveCount(1)

  // The simulated install fails: the row goes and the card is the size it was before the offer's row.
  await expect(label(card.getByRole('button'))).toHaveText(t.retry)
  await expect(row).toHaveCount(0)
  expect((await box(card)).height).toBeLessThan(offered.height - 10)
  expect(Math.abs((await box(card)).width - offered.width)).toBeLessThanOrEqual(0.5)
})
