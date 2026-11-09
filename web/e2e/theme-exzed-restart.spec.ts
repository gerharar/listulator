import { expect, test, type Page } from '@playwright/test'

/**
 * eX-Zed's skin across a real restart (Phase 49.14), in both engines: 49.2 and 49.8 tested the functions and one skin, this tests the pages. Each of the six
 * skin keys is chosen in the header's own menu, the page is reloaded (a new document, the app's own storage the only thing that carries over), and the page is
 * that skin again, from the first frame, with the theme and the key as they were stored and Quantum's `skin` untouched. An unknown stored key, then a reload,
 * is Lode and is left in storage. Reads only; the preferences live in the browser's storage.
 */
const SKINS = [
  { key: 'exzed-1d', name: 'Lode', paper: '#000000' },
  { key: 'exzed-1a', name: 'Focal', paper: '#000000' },
  { key: 'exzed-1b', name: 'Glemt', paper: '#000000' },
  { key: 'exzed-1c', name: 'Xen', paper: '#000000' },
  { key: 'exzed-1e', name: 'Kui', paper: '#000000' },
  { key: 'exzed-1l', name: 'Lotus', paper: '#d7d7d7' },
] as const

/** Seeds once per tab (a reload must show what the app stored itself, not the seed again) and records every `data-theme` the page ever has. */
async function open(page: Page, stored: Record<string, string>) {
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.addInitScript((entries) => {
    try {
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1')
        for (const [key, value] of entries) localStorage.setItem(key, value)
      }
    } catch {
      return
    }
    const seen: (string | null)[] = []
    ;(window as unknown as { __themes: (string | null)[] }).__themes = seen
    new MutationObserver((records) => {
      for (const record of records) if (record.target === document.documentElement) seen.push(document.documentElement.getAttribute('data-theme'))
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] })
  }, Object.entries({ reducedMotion: 'true', ...stored }))
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
}

async function restart(page: Page) {
  await page.reload()
  await page.locator('.q-home-row').first().waitFor()
}

const look = (page: Page) =>
  page.evaluate(() => ({
    history: (window as unknown as { __themes: (string | null)[] }).__themes,
    now: document.documentElement.getAttribute('data-theme'),
    exzedClass: document.documentElement.classList.contains('theme-exzed'),
    paper: getComputedStyle(document.documentElement).getPropertyValue('--zx-paper').trim(),
    stored: [localStorage.getItem('theme'), localStorage.getItem('exzedSkin'), localStorage.getItem('skin')],
  }))

for (const entry of SKINS) {
  test(`${entry.name} chosen in the header menu is the page again after a restart`, async ({ page }) => {
    // Start on a different eX-Zed skin, so that a pass cannot be the default or the seed.
    const start = entry.key === 'exzed-1a' ? 'exzed-1e' : 'exzed-1a'
    await open(page, { theme: 'exzed', exzedSkin: start, skin: 'dark-green' })

    await page.getByRole('button', { name: 'Skin', exact: true }).click()
    await page.locator('.q-pop .q-pop-menu').getByRole('button', { name: entry.name, exact: true }).click()
    expect((await look(page)).now, 'applied at once').toBe(entry.key)

    await restart(page)
    const seen = await look(page)

    expect(seen.exzedClass).toBe(true)
    expect(seen.now).toBe(entry.key)
    expect(seen.paper).toBe(entry.paper)
    // From the first instant of the new document: never Quantum's key, never the other skin, not even for a frame.
    expect(seen.history.length).toBeGreaterThan(0)
    expect(new Set(seen.history)).toEqual(new Set([entry.key]))
    expect(seen.stored).toEqual(['exzed', entry.key, 'dark-green'])
  })
}

test('an unknown stored key is Lode after a restart, and is left in storage as it was', async ({ page }) => {
  await open(page, { theme: 'exzed', exzedSkin: 'exzed-9z', skin: 'dark-green' })
  expect((await look(page)).now).toBe('exzed-1d')

  await restart(page)
  const seen = await look(page)

  expect(seen.exzedClass).toBe(true)
  expect(seen.now).toBe('exzed-1d')
  expect(new Set(seen.history)).toEqual(new Set(['exzed-1d']))
  expect(seen.stored).toEqual(['exzed', 'exzed-9z', 'dark-green'])
})

test('a skin chosen after an unknown key replaces it, and that survives a restart', async ({ page }) => {
  await open(page, { theme: 'exzed', exzedSkin: 'exzed-9z' })

  await page.getByRole('button', { name: 'Skin', exact: true }).click()
  await page.locator('.q-pop .q-pop-menu').getByRole('button', { name: 'Kui', exact: true }).click()
  await restart(page)

  expect((await look(page)).now).toBe('exzed-1e')
  expect((await look(page)).stored[1]).toBe('exzed-1e')
})
