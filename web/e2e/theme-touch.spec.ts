import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * eX-Zed is a desktop theme (Phase 49.10, design's answer 8), in both engines. On a device with no fine, hovering pointer (emulated with `hasTouch`: both
 * engines then answer `(hover: hover) and (pointer: fine)` with false) a stored `theme: exzed` is drawn as Quantum, with no THEME row in Settings and
 * Quantum's skin row and header button; the stored preference is left exactly as it was, after the load and after a skin is changed, because it may be shared
 * with a desktop. With a fine pointer nothing changes. And a change of the pointer while the app runs (a mouse plugged into a tablet) switches the drawing
 * without a reload and without writing anything. The live change is driven by a stand-in for that one media query, the rest is the browser’s own.
 */
const STORED = { theme: 'exzed', exzedSkin: 'exzed-1c', skin: 'dark-green', reducedMotion: 'true' }

async function open(page: Page, stored: Record<string, string>) {
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries(stored))
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
}

const look = (page: Page) =>
  page.evaluate(() => ({
    exzedClass: document.documentElement.classList.contains('theme-exzed'),
    skin: document.documentElement.getAttribute('data-theme'),
    stored: [localStorage.getItem('theme'), localStorage.getItem('exzedSkin'), localStorage.getItem('skin')],
    hexagon: document.querySelectorAll('.q-skin-btn .q-hex').length,
    swatch: document.querySelectorAll('.q-skin-btn .q-zx-swatch').length,
  }))

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('.q-settings').waitFor()
}

const settings = (page: Page) => page.locator('.q-settings')

async function makeList(request: APIRequestContext, title: string) {
  const items = Array.from({ length: 12 }, (_, n) => `  - { title: "Item ${String(n).padStart(2, '0')}", minutes: 30, group: "Group ${Math.floor(n / 6) + 1}" }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${items.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

test.describe('on a touch-only device', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1180, height: 820 } })

  test('a stored eX-Zed is drawn as Quantum: no theme class, Quantum’s skin, its hexagon in the header', async ({ page }) => {
    await open(page, STORED)

    expect(await look(page)).toEqual({ exzedClass: false, skin: 'dark-green', stored: ['exzed', 'exzed-1c', 'dark-green'], hexagon: 1, swatch: 0 })
  })

  test('a list opened on it is laid out for Quantum from its first render: 46px rows and 47px group heads, not eX-Zed’s 32px', async ({ page }) => {
    const title = `e2e touch rows ${test.info().project.name} ${Date.now()}`
    const id = await makeList(page.request, title)

    try {
      await open(page, STORED)
      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-item').first().waitFor()

      expect(await page.evaluate(() => [(document.querySelector('.q-item') as HTMLElement).offsetHeight, (document.querySelector('.q-group') as HTMLElement).offsetHeight])).toEqual([46, 47])
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })

  test('Settings offers no THEME choice and shows Quantum’s five skins', async ({ page }) => {
    await open(page, STORED)
    await openSettings(page)

    await expect(settings(page).getByRole('button', { name: 'eX-Zed', exact: true })).toHaveCount(0)
    await expect(settings(page).getByRole('button', { name: 'Quantum', exact: true })).toHaveCount(0)
    await expect(settings(page).locator('.q-kicker', { hasText: /^Theme$/i })).toHaveCount(0)
    for (const name of ['Destiny', 'Jupiter', 'Deluge', 'Romans', 'Jouhou']) await expect(settings(page).getByRole('button', { name, exact: true })).toBeVisible()
    await expect(settings(page).locator('.q-chip.skin .q-zx-swatch')).toHaveCount(0)
  })

  test('the stored theme and eX-Zed’s skin are left as they are after a skin is changed, which writes Quantum’s own', async ({ page }) => {
    await open(page, STORED)
    await openSettings(page)
    await settings(page).getByRole('button', { name: 'Romans', exact: true }).click()

    expect(await look(page)).toEqual({ exzedClass: false, skin: 'dark-violet', stored: ['exzed', 'exzed-1c', 'dark-violet'], hexagon: 1, swatch: 0 })
  })

  test('with nothing stored it is Quantum, with no THEME row either', async ({ page }) => {
    await open(page, { reducedMotion: 'true', skin: 'dark-orange' })
    await openSettings(page)

    expect((await look(page)).exzedClass).toBe(false)
    await expect(settings(page).getByRole('button', { name: 'eX-Zed', exact: true })).toHaveCount(0)
  })
})

test.describe('with a fine pointer', () => {
  test('a stored eX-Zed is drawn, and the THEME choice is there', async ({ page }) => {
    await open(page, STORED)

    expect(await look(page)).toEqual({ exzedClass: true, skin: 'exzed-1c', stored: ['exzed', 'exzed-1c', 'dark-green'], hexagon: 0, swatch: 1 })
    await openSettings(page)
    await expect(settings(page).getByRole('button', { name: 'eX-Zed', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('when the pointer changes while the app runs', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const query = '(hover: hover) and (pointer: fine)'
      const real = window.matchMedia.bind(window)
      const listeners = new Set<(event: { matches: boolean }) => void>()
      let fine = true
      const stand = {
        media: query,
        get matches() {
          return fine
        },
        onchange: null,
        addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => true,
      }
      window.matchMedia = ((text: string) => (text === query ? stand : real(text))) as typeof window.matchMedia
      ;(window as unknown as { __setFine: (value: boolean) => void }).__setFine = (value) => {
        fine = value
        for (const listener of [...listeners]) listener({ matches: value })
      }
      // Every write to storage after the page has loaded, so "nothing is written" is a measurement.
      const writes: string[] = []
      ;(window as unknown as { __writes: string[] }).__writes = writes
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key: string, value: string) {
        writes.push(key)
        return original.call(this, key, value)
      }
    })
  })

  const setFine = (page: Page, value: boolean) => page.evaluate((v) => (window as unknown as { __setFine: (value: boolean) => void }).__setFine(v), value)
  const writes = (page: Page) => page.evaluate(() => (window as unknown as { __writes: string[] }).__writes)

  test('taking the mouse away turns the page Quantum at once, and plugging it back turns it eX-Zed again, with nothing written', async ({ page }) => {
    await open(page, STORED)
    expect((await look(page)).exzedClass).toBe(true)
    await page.evaluate(() => ((window as unknown as { __writes: string[] }).__writes.length = 0))

    // React draws the header and sets the skin a moment after the class is on: wait for the settled page, not the instant of the event.
    await setFine(page, false)
    await expect.poll(() => look(page)).toEqual({ exzedClass: false, skin: 'dark-green', stored: ['exzed', 'exzed-1c', 'dark-green'], hexagon: 1, swatch: 0 })

    await setFine(page, true)
    await expect.poll(() => look(page)).toEqual({ exzedClass: true, skin: 'exzed-1c', stored: ['exzed', 'exzed-1c', 'dark-green'], hexagon: 0, swatch: 1 })
    expect(await writes(page), 'no preference written by a change of pointer').toEqual([])
  })

  test('an open Settings loses its THEME row when the mouse goes, and gets it back, and a row drawn at eX-Zed’s height is redrawn at Quantum’s', async ({ page }) => {
    await open(page, STORED)
    await openSettings(page)
    await expect(settings(page).getByRole('button', { name: 'eX-Zed', exact: true })).toBeVisible()

    await setFine(page, false)
    await expect(settings(page).getByRole('button', { name: 'eX-Zed', exact: true })).toHaveCount(0)
    await expect(settings(page).getByRole('button', { name: 'Jupiter', exact: true })).toHaveAttribute('aria-pressed', 'true')

    await setFine(page, true)
    await expect(settings(page).getByRole('button', { name: 'eX-Zed', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(settings(page).getByRole('button', { name: 'Xen', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
})
