import { expect, test, type Page } from '@playwright/test'

/**
 * eX-Zed's skin preference (Phase 49.2), in both engines: the stored `exzedSkin` becomes `data-theme` on `<html>` before the first frame, the page never
 * carries the other theme's key (a MutationObserver records every value from the first instant), an unknown or foreign value is Lode and is left as it
 * is in storage, and Quantum's own `skin` is never read or written by eX-Zed. Reads only; no write to the server.
 */
const EXZED_KEYS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
const QUANTUM_KEYS = ['dark-orange', 'dark-green', 'dark-blue', 'dark-violet', 'light-bone']

/** Opens the app with these preferences and returns every `data-theme` value `<html>` has had, in order, and what storage holds afterwards. */
async function open(page: Page, stored: Record<string, string>) {
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
    const seen: (string | null)[] = []
    ;(window as unknown as { __themes: (string | null)[] }).__themes = seen
    // Observe the document, not `<html>`: at this point `<html>` may not exist yet.
    new MutationObserver((records) => {
      for (const record of records) if (record.target === document.documentElement) seen.push(document.documentElement.getAttribute('data-theme'))
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] })
  }, Object.entries({ reducedMotion: 'true', ...stored }))
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  return page.evaluate(() => ({
    history: (window as unknown as { __themes: (string | null)[] }).__themes,
    now: document.documentElement.getAttribute('data-theme'),
    exzedSkin: localStorage.getItem('exzedSkin'),
    skin: localStorage.getItem('skin'),
    theme: localStorage.getItem('theme'),
    exzedClass: document.documentElement.classList.contains('theme-exzed'),
    paper: getComputedStyle(document.documentElement).getPropertyValue('--zx-paper').trim(),
  }))
}

test.describe('with the theme exzed', () => {
  for (const key of EXZED_KEYS) {
    test(`a stored ${key} is the page's skin from the first frame, and is not rewritten`, async ({ page }) => {
      const seen = await open(page, { theme: 'exzed', skin: 'dark-green', exzedSkin: key })

      expect(seen.exzedClass).toBe(true)
      expect(seen.now).toBe(key)
      // Every value the attribute ever had is this key: never a Quantum skin, never another eX-Zed one, not even for a frame.
      expect(seen.history.length).toBeGreaterThan(0)
      expect(new Set(seen.history)).toEqual(new Set([key]))
      expect(seen.exzedSkin).toBe(key)
      expect(seen.paper).toBe(key === 'exzed-1l' ? '#d7d7d7' : '#000000')
    })
  }

  test('with no exzedSkin stored the page is Lode, and nothing is written', async ({ page }) => {
    const seen = await open(page, { theme: 'exzed', skin: 'dark-green' })

    expect(seen.now).toBe('exzed-1d')
    expect(new Set(seen.history)).toEqual(new Set(['exzed-1d']))
    expect(seen.exzedSkin).toBeNull()
  })

  test('an unknown stored key is Lode and is left in storage as it was', async ({ page }) => {
    const seen = await open(page, { theme: 'exzed', skin: 'dark-green', exzedSkin: 'exzed-9z' })

    expect(seen.now).toBe('exzed-1d')
    expect(seen.exzedSkin).toBe('exzed-9z')
  })

  test('a Quantum skin stored as the eX-Zed skin is Lode, not that skin', async ({ page }) => {
    const seen = await open(page, { theme: 'exzed', skin: 'dark-green', exzedSkin: 'dark-orange' })

    expect(seen.now).toBe('exzed-1d')
    expect(new Set(seen.history)).toEqual(new Set(['exzed-1d']))
  })

  test('Quantum’s own skin is neither read for the page nor rewritten', async ({ page }) => {
    const seen = await open(page, { theme: 'exzed', skin: 'dark-violet', exzedSkin: 'exzed-1c' })

    expect(seen.now).toBe('exzed-1c')
    expect(seen.skin).toBe('dark-violet')
  })
})

test.describe('with the theme quantum', () => {
  test('a stored exzedSkin is ignored: the page carries Quantum’s skin only', async ({ page }) => {
    const seen = await open(page, { skin: 'dark-green', exzedSkin: 'exzed-1b' })

    expect(seen.exzedClass).toBe(false)
    expect(seen.now).toBe('dark-green')
    expect(seen.history.length).toBeGreaterThan(0)
    expect(seen.history.every((value) => QUANTUM_KEYS.includes(value ?? ''))).toBe(true)
    expect(seen.exzedSkin).toBe('exzed-1b')
  })

  test('with no theme stored at all the page is Quantum and eX-Zed’s key is never set', async ({ page }) => {
    const seen = await open(page, { skin: 'dark-blue' })

    expect(seen.theme).toBeNull()
    expect(seen.now).toBe('dark-blue')
    expect(seen.history.length).toBeGreaterThan(0)
    expect(seen.history.some((value) => value?.startsWith('exzed-'))).toBe(false)
  })
})
