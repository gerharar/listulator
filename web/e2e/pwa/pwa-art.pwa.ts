import { expect, test, type Page } from '@playwright/test'

/**
 * eX-Zed's art in the installed web app (Phase 50.11): a **runtime cache**, not the precache (the owner: "Runtime cache is OK"). The first visit is in Quantum, so the install
 * holds none of it; the art is cached the first time a skin draws it (`listulator-art`, CacheFirst). In Chromium the network then goes down and the skin's art still draws from
 * the cache; and a skin never used online draws without its art while the app still stands (accepted: the art is decoration). WebKit cannot reload offline with a worker here
 * (see pwa-font.pwa.ts), so its half is the cache contents.
 */
async function install(page: Page) {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
}

const held = (page: Page, cache: string) =>
  page.evaluate(async (name) => {
    if (!(await caches.has(name))) return []

    return (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname.replace(/^\/assets\//, '').replace(/-[\w-]{8}\.png$/, ''))
  }, cache)

const precached = (page: Page) =>
  page.evaluate(async () => {
    const found: string[] = []
    for (const name of await caches.keys()) {
      if (!name.includes('precache')) continue
      for (const request of await (await caches.open(name)).keys()) if (/\/assets\/.+\.png$/.test(request.url)) found.push(request.url)
    }

    return found
  })

/** Whether each picture the slot's `background-image` names can be decoded now (from the cache when offline). */
const slotPictures = (page: Page) =>
  page.evaluate(async () => {
    const urls = [...document.querySelectorAll('.q-backdrop > [data-slot]')].flatMap((slot) => [...getComputedStyle(slot).backgroundImage.matchAll(/url\("?([^")]+)"?\)/g)].map((match) => match[1]!))
    const results: boolean[] = []
    for (const url of urls) {
      const image = new Image()
      image.src = url
      results.push(await image.decode().then(() => true, () => false))
    }

    return results
  })

async function chooseSkin(page: Page, skin: string) {
  await page.evaluate((value) => {
    localStorage.setItem('theme', 'exzed')
    localStorage.setItem('exzedSkin', value)
  }, skin)
  await page.reload()
  await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, skin)
  await page.locator('.q-backdrop').waitFor({ state: 'attached' })
}

test('the install holds no art (Quantum never draws it); using a skin online caches that skin’s pictures and not another’s', async ({ page }) => {
  await install(page)
  expect(await precached(page), 'no picture in the precache').toEqual([])
  expect(await held(page, 'listulator-art'), 'nothing cached before a skin is used').toEqual([])

  await chooseSkin(page, 'exzed-1d')
  await page.waitForLoadState('networkidle')
  // The worker caches a response after it has served it: wait for the cache to hold the skin's two pictures.
  await expect.poll(() => held(page, 'listulator-art')).toEqual(expect.arrayContaining(['red-bricks-wall', 'red-bricks-cornice']))
  const cached = await held(page, 'listulator-art')
  expect(cached.filter((name) => !['red-bricks-wall', 'red-bricks-cornice'].includes(name)), 'only Lode’s pictures, and what the screen itself draws').toEqual(expect.not.arrayContaining(['blue-stones-wall', 'grey-stones-wall', 'island-waves']))
})

test('offline, the skin that was used draws its art from the cache; a skin never used online draws without it and the app stands', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright’s WebKit cannot reload offline with a service worker; the cache check above is its half')
  await install(page)
  await chooseSkin(page, 'exzed-1d')
  await page.waitForLoadState('networkidle')
  await expect.poll(() => held(page, 'listulator-art')).toEqual(expect.arrayContaining(['red-bricks-wall', 'red-bricks-cornice']))

  await context.setOffline(true)
  await page.reload()
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'exzed-1d')
  await page.locator('.q-backdrop').waitFor({ state: 'attached' })
  const used = await slotPictures(page)
  expect(used.length, 'Lode names pictures').toBeGreaterThan(0)
  expect(used, 'all of them decode, offline').not.toContain(false)

  await chooseSkin(page, 'exzed-1a')
  const unused = await slotPictures(page)
  expect(unused, 'Focal was never used online: its pictures are not there').toContain(false)
  await expect(page.locator('.q-backdrop')).toBeAttached()
  expect(await page.evaluate(() => document.documentElement.classList.contains('theme-exzed'))).toBe(true)
})
