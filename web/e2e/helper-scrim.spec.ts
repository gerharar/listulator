import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng } from './pngPixels.js'

/**
 * The scrim behind a helper sheet (canvas H-028, task 56.4), Quantum, in a real browser: a flat veil over Home's list from the help row's bottom edge to the card's inner bottom
 * edge, across the card's inner width; under the sheet, out of the way of every click, faded in once; no hairline of card between it and the card's edges at 100%, 125% and
 * 150%. The unit tests say what is drawn and the stylesheet says how; this says what a browser makes of it. Surprise Me is the sheet (its two library calls are answered here),
 * Finalizer the one that replaces it. Nothing is written.
 */
const ENTRIES = [{ externalRef: 'canonical:lists/book/lotr.yaml', title: 'The Lord of the Rings', category: 'book', itemCount: 3, description: 'Three volumes.', status: 'complete' }]

const SCRIMS = {
  'dark-orange': 'rgba(24, 21, 19, 0.72)',
  'dark-green': 'rgba(15, 28, 34, 0.72)',
  'dark-blue': 'rgba(13, 26, 36, 0.72)',
  'dark-violet': 'rgba(21, 19, 30, 0.72)',
  'light-bone': 'rgba(34, 31, 25, 0.1)',
} as const

async function open(page: Page, preferences: Record<string, string> = {}) {
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: ENTRIES, reachable: true } }))
  await page.route('**/api/media-types/*/expansion**', (route) => route.fulfill({ json: { itemCount: 1, items: [{ title: 'Item one', timeToConsumeMinutes: 30 }] } }))
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', ...preferences }))
  await page.goto('/')
  await expect(page.locator('.q-help-row')).toBeVisible({ timeout: 15_000 })
}

const surprise = (page: Page) => page.getByRole('button', { name: 'Surprise Me' })
const scrim = (page: Page) => page.locator('.q-scrim')
const sheet = (page: Page) => page.locator('.q-sheet')

async function openSheet(page: Page) {
  await surprise(page).click()
  await expect(sheet(page)).toBeVisible()
  await expect(scrim(page)).toHaveCount(1)
}

const box = async (locator: Locator) => (await locator.boundingBox())!

test('exists only while a sheet is open', async ({ page }) => {
  await open(page, { reducedMotion: 'true' })
  await expect(scrim(page)).toHaveCount(0)

  await openSheet(page)
  await surprise(page).click()

  await expect(sheet(page)).toHaveCount(0)
  await expect(scrim(page)).toHaveCount(0)
})

test('starts at the help row’s bottom edge and ends at the card’s inner bottom, across its inner width; the help row and both headers are not under it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, { reducedMotion: 'true' })
  await openSheet(page)

  const [veil, row, home, homeHead, appHeader] = await Promise.all([box(scrim(page)), box(page.locator('.q-help-row')), box(page.locator('.q-home')), box(page.locator('.q-home-head')), box(page.locator('.q-appheader'))])

  expect(veil.y, 'its top is the help row’s bottom edge').toBeCloseTo(row.y + row.height, 0)
  expect(veil.y + veil.height, 'its bottom is the card’s inner bottom').toBeCloseTo(home.y + home.height, 0)
  expect(veil.x, 'its left is the card’s inner left').toBeCloseTo(home.x, 0)
  expect(veil.x + veil.width, 'its right is the card’s inner right').toBeCloseTo(home.x + home.width, 0)
  expect(veil.y, 'below the screen header').toBeGreaterThanOrEqual(homeHead.y + homeHead.height - 0.5)
  expect(veil.y, 'below the app header').toBeGreaterThanOrEqual(appHeader.y + appHeader.height - 0.5)
})

test('is under the sheet and the list’s popover, takes no clicks, and a click on the shaded list closes the sheet', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, { reducedMotion: 'true' })
  await openSheet(page)

  const layers = await page.evaluate(() => {
    const z = (selector: string) => Number(getComputedStyle(document.querySelector(selector)!).zIndex)
    return { scrim: z('.q-scrim'), sheet: z('.q-sheet'), anchor: z('.q-help-anchor'), events: getComputedStyle(document.querySelector('.q-scrim')!).pointerEvents, hidden: document.querySelector('.q-scrim')!.getAttribute('aria-hidden') }
  })
  expect(layers).toEqual({ scrim: 89, sheet: 90, anchor: 90, events: 'none', hidden: 'true' })

  const veil = await box(scrim(page))
  // The strip beside the rows is the card's own colour under the veil: a click there is "outside" the sheet.
  await page.mouse.click(veil.x + 8, veil.y + veil.height - 12)

  await expect(sheet(page)).toHaveCount(0)
  await expect(scrim(page)).toHaveCount(0)
})

test('a helper button while a sheet is open replaces the sheet and keeps the scrim: the same element, not faded in again', async ({ page }) => {
  await open(page)
  await openSheet(page)
  await page.waitForFunction(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'q-scrim-in').every((a) => a.playState === 'finished'))
  await scrim(page).evaluate((node) => node.setAttribute('data-mark', 'first'))

  await page.getByRole('button', { name: 'Finalizer' }).click()
  await expect(sheet(page)).toContainText('Finish Him!')

  await expect(scrim(page)).toHaveAttribute('data-mark', 'first')
  expect(await page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'q-scrim-in' && a.playState === 'running').length)).toBe(0)
})

test('fades in over 140ms, linear, when a sheet opens', async ({ page }) => {
  await open(page)
  await surprise(page).click()
  await expect(scrim(page)).toHaveCount(1)

  const style = await scrim(page).evaluate((node) => {
    const s = getComputedStyle(node)
    return { name: s.animationName, duration: s.animationDuration, timing: s.animationTimingFunction }
  })
  expect(style).toEqual({ name: 'q-scrim-in', duration: '0.14s', timing: 'linear' })
})

test('does not fade under reduced motion, from Settings or from the system', async ({ page }) => {
  await open(page, { reducedMotion: 'true' })
  await openSheet(page)
  expect(await scrim(page).evaluate((node) => getComputedStyle(node).animationName)).toBe('none')
})

for (const [skin, colour] of Object.entries(SCRIMS)) {
  test(`${skin}: the veil is ${colour} (the skin’s bg at .72, Jouhou’s ink at .10)`, async ({ page }) => {
    await open(page, { skin, reducedMotion: 'true' })
    await openSheet(page)

    expect(await scrim(page).evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(colour)
  })
}

/** What the card shows next to the veil's edges: the first device pixel inside each edge must be the veil's own, not a hairline of the card's colour. */
for (const factor of [1, 1.25, 1.5]) {
  test.describe(`at ${factor * 100}%`, () => {
    test.use({ deviceScaleFactor: factor })

    for (const skin of ['dark-orange', 'light-bone']) {
      test(`${skin}: no hairline of card between the veil and the card's left, right or bottom edge`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 })
        await open(page, { skin, reducedMotion: 'true' })
        await openSheet(page)
        await page.evaluate(() => document.fonts.ready)
        const [veil, home] = await Promise.all([box(scrim(page)), box(page.locator('.q-home'))])
        const picture = decodePng(await page.screenshot())
        const pixel = (x: number, y: number) => {
          const i = (Math.round(y * factor) * picture.width + Math.round(x * factor)) * 4
          return [picture.data[i]!, picture.data[i + 1]!, picture.data[i + 2]!]
        }
        const same = (a: number[], b: number[], what: string) => expect(Math.max(...a.map((value, index) => Math.abs(value - b[index]!))), `${what}: ${a} against ${b}`).toBeLessThanOrEqual(3)
        // The 24px beside and under the list is nothing but the card's colour, veiled. The edge pixel is compared with the one three device pixels in, close enough to be clear
        // of the sheet's own shadow (a point 12px in is darker for it): a hairline of unveiled card would be a whole column, tens of levels lighter, not the few of a shadow's edge.
        const y = veil.y + veil.height / 2
        const x = home.x + 12
        const step = 1 / factor
        // One device pixel in from each edge (the edge pixel itself is the card's border, which is drawn there).
        same(pixel(home.x + step, y), pixel(home.x + 4 * step, y), 'the left edge')
        same(pixel(home.x + home.width - 2 * step, y), pixel(home.x + home.width - 5 * step, y), 'the right edge')
        same(pixel(x, home.y + home.height - 2 * step), pixel(x, home.y + home.height - 5 * step), 'the bottom edge')
      })
    }
  })
}
