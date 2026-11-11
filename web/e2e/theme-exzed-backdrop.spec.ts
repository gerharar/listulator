import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The art slots (Phase 48.6), in both engines and both themes: Quantum keeps its fixed background field (`.q-atmo`) and a plate on every header;
 * eX-Zed has neither, and has the five named slots instead, empty of content (the skin's art is their background: the ground and the header strip under Lode, 50.1). Real write on the dev server, removed in a `finally`.
 */
const SLOTS = ['window', 'header', 'bottom', 'sides', 'scene']

async function makeList(request: APIRequestContext, title: string) {
  const rows = ['One', 'Two', 'Three'].map((name) => `  - { title: "Item ${name}", minutes: 30, group: "Season 1" }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

async function boot(page: Page, theme: string) {
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ theme, skin: 'dark-orange', reducedMotion: 'true' }))
  await page.route('**/api/library/untracked', (route) =>
    route.fulfill({ json: { entries: [{ externalRef: 'canonical:lists/book/lotr.yaml', title: 'The Lord of the Rings', category: 'book', itemCount: 3, status: 'complete' }], reachable: true } }),
  )
}

const counts = (page: Page) =>
  page.evaluate(() => ({
    atmo: document.querySelectorAll('.q-atmo').length,
    plates: document.querySelectorAll('.q-plate').length,
    backdrop: document.querySelectorAll('.q-backdrop').length,
  }))

for (const theme of ['quantum', 'exzed'] as const) {
  test.describe(`with the theme ${theme}`, () => {
    const exzed = theme === 'exzed'

    test('Home: the background field and the header plate', async ({ page }) => {
      await boot(page, theme)
      await page.goto('/')
      await page.locator('.q-home-row').first().waitFor()

      const seen = await counts(page)
      expect(seen.atmo, 'the background field').toBe(exzed ? 0 : 1)
      expect(seen.plates, 'header plates').toBe(exzed ? 0 : 1)
      expect(seen.backdrop, 'the art slots').toBe(exzed ? 1 : 0)
    })

    test('every other screen with a plate: Settings, About, the picker, a sheet, a list', async ({ page }) => {
      const title = `e2e backdrop ${theme} ${Date.now()}`
      const id = await makeList(page.request, title)

      try {
        await boot(page, theme)
        await page.goto('/')
        await page.locator('.q-home-row').first().waitFor()
        const plates = async () => (await counts(page)).plates

        await page.getByRole('button', { name: 'Settings' }).click()
        await page.locator('.q-settings-head').waitFor()
        expect(await plates(), 'Settings (and Home under it)').toBe(exzed ? 0 : 2)
        await page.getByRole('button', { name: 'Close', exact: true }).click()

        await page.getByRole('button', { name: 'About', exact: true }).click()
        await page.locator('.q-about-head').waitFor()
        // About's header plate and its update block's wash.
        expect(await plates(), 'About (and Home under it)').toBe(exzed ? 0 : 3)
        await page.getByRole('button', { name: 'Close', exact: true }).click()

        await page.getByRole('button', { name: 'New List' }).click()
        await page.locator('.q-picker-head').waitFor()
        expect(await plates(), 'the picker (and Home under it)').toBe(exzed ? 0 : 2)
        await page.keyboard.press('Escape')
        await page.locator('.q-picker-head').waitFor({ state: 'detached' })

        await page.getByRole('button', { name: 'Surprise Me' }).click()
        await page.locator('.q-sheet').waitFor()
        expect(await plates(), 'the sheet’s wash (and Home under it)').toBe(exzed ? 0 : 2)
        await page.keyboard.press('Escape')
        await page.locator('.q-sheet').waitFor({ state: 'detached' })

        await page.locator('.q-home-row', { hasText: title }).click()
        await page.locator('.q-item').first().waitFor()
        expect(await plates(), 'a list (and Home under it)').toBe(exzed ? 0 : 2)
        expect((await counts(page)).atmo).toBe(exzed ? 0 : 1)
      } finally {
        await page.request.delete(`/api/lists/${id}`)
      }
    })

    test('the slots: five, in order, empty, taking no space (eX-Zed only)', async ({ page }) => {
      await boot(page, theme)
      await page.goto('/')
      await page.locator('.q-home-row').first().waitFor()

      const slots = await page.evaluate(() =>
        [...document.querySelectorAll('.q-backdrop > [data-slot]')].map((el) => {
          const box = el.getBoundingClientRect()
          return { slot: el.getAttribute('data-slot'), children: el.childNodes.length, width: box.width, height: box.height }
        }),
      )

      if (!exzed) {
        expect(slots).toEqual([])
        return
      }
      expect(slots.map((s) => s.slot)).toEqual(SLOTS)
      // Empty of children always (the art is a CSS background). Lode, the default skin, fills the ground and the strip under the header (50.1); the rest of the slots
      // take no height until their skin's art is built.
      for (const slot of slots) {
        expect(slot.children, `${slot.slot} is empty`).toBe(0)
        if (slot.slot === 'window' || slot.slot === 'header') expect(slot.width, `${slot.slot} has Lode's art`).toBeGreaterThan(0)
        else expect(slot.height, `${slot.slot} takes no height`).toBe(0)
      }
      // The wrapper does not catch the pointer, and the app is still clickable through it.
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.q-backdrop')!).pointerEvents)).toBe('none')
      await page.getByRole('button', { name: 'Settings' }).click()
      await page.locator('.q-settings-head').waitFor()
    })
  })
}
