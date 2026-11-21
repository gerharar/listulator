import { expect, test, type Page } from '@playwright/test'

/**
 * The warning that eX-Zed needs a window at least 1128px wide (Phase 49.12; 1080 for a layer plus the two 24px gaps the stage keeps), in both engines, in the
 * browser build (the desktop paths, Embiggen included, are driven in the unit tests: no browser can press a native window’s button). Starting in eX-Zed in a narrower
 * window shows a banner under the header; so does switching to it in one (D49, 57.1: the popover on the chip is gone, no dialog opens anywhere); at 1128 neither. Never blocking. In a browser there is no Embiggen and the
 * line asks to widen the window. Keep Quantum switches back and stores it; Dismiss hides it for this session only and never touches the stored theme. Quantum and
 * touch-only devices never see it.
 */
const LINE = 'Make the browser window at least 1128px wide, or switch back to Quantum.'

async function open(page: Page, stored: Record<string, string>, width: number) {
  await page.setViewportSize({ width, height: 800 })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ reducedMotion: 'true', skin: 'dark-orange', exzedSkin: 'exzed-1d', ...stored }))
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
}

const banner = (page: Page) => page.locator('.q-banner', { hasText: LINE })
const dialogs = (page: Page) => page.getByRole('dialog')
const stored = (page: Page, key: string) => page.evaluate((name) => localStorage.getItem(name), key)
const isExzed = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('theme-exzed'))

const SETTINGS: Record<string, string> = { en: 'Settings', ru: 'Настройки', de: 'Einstellungen' }

async function switchToExzed(page: Page, language = 'en') {
  await page.getByRole('button', { name: SETTINGS[language]!, exact: true }).click()
  await page.locator('.q-settings').waitFor()
  await page.locator('.q-settings').getByRole('button', { name: 'eX-Zed', exact: true }).click()
}

test.describe('starting in eX-Zed', () => {
  test('a window one pixel under the minimum shows the banner; at the minimum there is none', async ({ page }) => {
    await open(page, { theme: 'exzed' }, 1127)
    await expect(banner(page)).toBeVisible()
    await expect(banner(page).getByRole('button', { name: 'Keep Quantum' })).toBeVisible()
    await expect(banner(page).getByRole('button', { name: 'Dismiss' })).toBeVisible()
    // The web build has no way to resize the window: no Embiggen.
    await expect(banner(page).getByRole('button', { name: 'Embiggen' })).toHaveCount(0)
  })

  test('at 1128px there is no banner', async ({ page }) => {
    await open(page, { theme: 'exzed' }, 1128)

    await expect(banner(page)).toHaveCount(0)
    expect(await isExzed(page)).toBe(true)
  })

  test('widening the window to 1128 takes the banner away without a reload, and narrowing it brings it back', async ({ page }) => {
    await open(page, { theme: 'exzed' }, 1127)
    await expect(banner(page)).toBeVisible()

    await page.setViewportSize({ width: 1128, height: 800 })
    await expect(banner(page)).toHaveCount(0)

    await page.setViewportSize({ width: 1000, height: 800 })
    await expect(banner(page)).toBeVisible()
  })

  test('it never blocks: the app underneath still works (Settings opens)', async ({ page }) => {
    await open(page, { theme: 'exzed' }, 1127)
    await expect(banner(page)).toBeVisible()

    await page.getByRole('button', { name: 'Settings', exact: true }).click()

    await expect(page.locator('.q-settings')).toBeVisible()
  })

  test('Keep Quantum turns the page Quantum and stores it', async ({ page }) => {
    await open(page, { theme: 'exzed' }, 1127)

    await banner(page).getByRole('button', { name: 'Keep Quantum' }).click()

    await expect(banner(page)).toHaveCount(0)
    expect(await isExzed(page)).toBe(false)
    expect(await stored(page, 'theme')).toBe('quantum')
  })

  test('Dismiss hides it for this session and leaves the stored theme alone; a reload shows it again', async ({ page }) => {
    await open(page, { theme: 'exzed' }, 1127)

    await banner(page).getByRole('button', { name: 'Dismiss' }).click()
    await expect(banner(page)).toHaveCount(0)
    expect(await isExzed(page)).toBe(true)
    expect(await stored(page, 'theme')).toBe('exzed')

    // Still dismissed when the window moves across the line and back, in this session.
    await page.setViewportSize({ width: 1300, height: 800 })
    await page.setViewportSize({ width: 1000, height: 800 })
    await expect(banner(page)).toHaveCount(0)

    await page.reload()
    await page.locator('.q-home-row').first().waitFor()
    await expect(banner(page)).toBeVisible()
    expect(await stored(page, 'theme')).toBe('exzed')
  })
})

test.describe('switching to eX-Zed', () => {
  test('in a window one pixel under the minimum the same banner shows under the header, and no dialog opens', async ({ page }) => {
    await open(page, { theme: 'quantum' }, 1127)
    await expect(banner(page)).toHaveCount(0)

    await switchToExzed(page)

    await expect(banner(page)).toBeVisible()
    await expect(banner(page).getByRole('button', { name: 'Keep Quantum' })).toBeVisible()
    await expect(banner(page).getByRole('button', { name: 'Dismiss' })).toBeVisible()
    await expect(page.locator('.q-pop')).toHaveCount(0)
    // The Settings layer is a layer, not a dialog: nothing in the page is one.
    await expect(dialogs(page)).toHaveCount(0)
  })

  test('at 1128px nothing shows', async ({ page }) => {
    await open(page, { theme: 'quantum' }, 1128)

    await switchToExzed(page)

    expect(await isExzed(page)).toBe(true)
    await expect(dialogs(page)).toHaveCount(0)
    await expect(banner(page)).toHaveCount(0)
  })

  test('Keep Quantum in the banner switches back and stores quantum', async ({ page }) => {
    await open(page, { theme: 'quantum' }, 1127)
    await switchToExzed(page)

    await banner(page).getByRole('button', { name: 'Keep Quantum' }).click()

    await expect(banner(page)).toHaveCount(0)
    expect(await isExzed(page)).toBe(false)
    expect(await stored(page, 'theme')).toBe('quantum')
  })

  test('Dismiss in the banner hides it, keeps eX-Zed and stores it, and it stays away this session', async ({ page }) => {
    await open(page, { theme: 'quantum' }, 1127)
    await switchToExzed(page)

    await banner(page).getByRole('button', { name: 'Dismiss' }).click()

    await expect(banner(page)).toHaveCount(0)
    expect(await isExzed(page)).toBe(true)
    expect(await stored(page, 'theme')).toBe('exzed')
    await page.setViewportSize({ width: 1300, height: 800 })
    await page.setViewportSize({ width: 1000, height: 800 })
    await expect(banner(page)).toHaveCount(0)
  })

  test('widening the window takes the banner away, and narrowing it brings it back', async ({ page }) => {
    await open(page, { theme: 'quantum' }, 1127)
    await switchToExzed(page)
    await expect(banner(page)).toBeVisible()

    await page.setViewportSize({ width: 1200, height: 800 })
    await expect(banner(page)).toHaveCount(0)

    await page.setViewportSize({ width: 1127, height: 800 })
    await expect(banner(page)).toBeVisible()
  })

  test('a fresh switch after a Dismiss shows it again: it is a new question', async ({ page }) => {
    await open(page, { theme: 'quantum' }, 1127)
    await switchToExzed(page)
    await banner(page).getByRole('button', { name: 'Dismiss' }).click()
    await expect(banner(page)).toHaveCount(0)

    await page.locator('.q-settings').getByRole('button', { name: 'Quantum', exact: true }).click()
    await page.locator('.q-settings').getByRole('button', { name: 'eX-Zed', exact: true }).click()

    await expect(banner(page)).toBeVisible()
  })
})

/**
 * The desktop adds a third button, Embiggen, which a browser never shows, so the browser build cannot draw it: the test adds one of the same kind to the row, as the
 * desktop’s notice does (found by the owner on the Mac, when the notice was a popover: three buttons in the Spectrum font were wider than its card). In every language,
 * because the labels differ in length, no button may leave its container.
 */
test.describe('with the third button the desktop adds (Embiggen)', () => {
  for (const language of ['en', 'ru', 'de']) {
    test(`the banner keeps all three buttons inside the window (${language})`, async ({ page }) => {
      await open(page, { theme: 'exzed', language }, 1127)
      await page.locator('.q-banner .q-banner-actions').first().waitFor()
      await page.locator('.q-banner .q-banner-actions').first().evaluate((row) => {
        const button = document.createElement('button')
        button.className = 'q-btn secondary sm'
        button.textContent = 'Embiggen'
        row.prepend(button)
      })

      const outside = await page.evaluate(() => {
        const actions = document.querySelector('.q-banner .q-banner-actions')!
        const last = actions.getBoundingClientRect()
        const first = actions.querySelector('button')!.getBoundingClientRect()

        return { right: Math.max(last.right - window.innerWidth, 0), left: Math.max(-first.left, 0), page: document.documentElement.scrollWidth - window.innerWidth }
      })

      expect(outside).toEqual({ right: 0, left: 0, page: 0 })
    })
  }
})

test.describe('where it is never shown', () => {
  test('Quantum, in a narrow window', async ({ page }) => {
    await open(page, { theme: 'quantum' }, 800)

    await expect(banner(page)).toHaveCount(0)
  })

  test.describe('on a touch-only device (stored eX-Zed is drawn as Quantum, 49.10)', () => {
    test.use({ hasTouch: true })

    test('a stored eX-Zed in a narrow window shows no banner', async ({ page }) => {
      await open(page, { theme: 'exzed' }, 900)

      expect(await isExzed(page)).toBe(false)
      await expect(banner(page)).toHaveCount(0)
    })
  })
})
