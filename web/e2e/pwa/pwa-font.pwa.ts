import { expect, test, type Page } from '@playwright/test'

/**
 * The Spectrum font is in the installed web app’s precache (Phase 49.13): an offline start in eX-Zed draws in it from the first start, not only after the font was seen
 * once online. The first visit is in Quantum, which never requests the font, so nothing but the precache can have it.
 *  - In both engines: once the worker is active (it installs by fetching the whole precache) its cache holds the font.
 *  - In Chromium: the network goes down, the theme is set to eX-Zed, the page is reloaded and the font loads. WebKit cannot be driven here: Playwright’s WebKit fails a
 *    reload with the network off and a service worker (“WebKit encountered an internal error”), so its half is the cache check above (the gap is recorded in DECISIONS).
 */
const family = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready
    await document.fonts.load('16px "ZX Spectrum"').catch(() => [])

    return [...document.fonts].filter((face) => face.family.replace(/["']/g, '') === 'ZX Spectrum').map((face) => face.status)
  })

async function install(page: Page) {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
}

test('the install holds the Spectrum font in its precache, though Quantum never asks for it', async ({ page }) => {
  await install(page)

  expect(await page.evaluate(() => performance.getEntriesByType('resource').some((entry) => entry.name.includes('ZXSpectrum'))), 'Quantum never asks for the font').toBe(false)
  const held = await page.evaluate(async () => {
    const found: string[] = []
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) if (/\/assets\/ZXSpectrum-[\w-]+\.ttf$/.test(request.url)) found.push(`${name}: ${new URL(request.url).pathname}`)
    }

    return found
  })

  expect(held).toHaveLength(1)
})

test('an offline start in eX-Zed draws in the Spectrum font, which the install already holds', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright’s WebKit cannot reload offline with a service worker; the cache check above is its half')
  await install(page)

  await context.setOffline(true)
  await page.evaluate(() => localStorage.setItem('theme', 'exzed'))
  await page.reload()
  await page.waitForFunction(() => document.documentElement.classList.contains('theme-exzed'))

  expect(await family(page)).toEqual(['loaded'])
})
