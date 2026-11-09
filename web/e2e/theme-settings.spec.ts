import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Settings → THEME and SKIN (Phase 49.8), in both engines. Two THEME chips with the lit one pressed; the SKIN row is Quantum's five skins under Quantum and
 * eX-Zed's six (Lode, Focal, Glemt, Xen, Kui, Lotus, each with its half-bucket swatch) under eX-Zed. A choice applies at once and is stored: theme under
 * `theme`, eX-Zed's skin under `exzedSkin`, Quantum's under `skin`, three keys that never touch one another, so switching back finds each theme as it was.
 * An unknown stored `exzedSkin` starts as Lode and is left in storage. A skin switched in eX-Zed redraws the open layers without losing a filter, an
 * open Add row or the scroll. The labels read in Russian and German. Real writes on the dev server, removed in a `finally`.
 */
const EXZED_NAMES = ['Lode', 'Focal', 'Glemt', 'Xen', 'Kui', 'Lotus'] as const
const QUANTUM_NAMES = ['Destiny', 'Jupiter', 'Deluge', 'Romans', 'Jouhou'] as const
const KEYS = { Lode: 'exzed-1d', Focal: 'exzed-1a', Glemt: 'exzed-1b', Xen: 'exzed-1c', Kui: 'exzed-1e', Lotus: 'exzed-1l' } as const

/** Opens the app once with these preferences: they are written on the first load only, so a reload shows what the app stored itself. */
async function open(page: Page, stored: Record<string, string>) {
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ reducedMotion: 'true', ...stored }))
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
}

const settings = (page: Page) => page.locator('.q-settings')

async function openSettings(page: Page) {
  if ((await settings(page).count()) === 0) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await settings(page).waitFor()
  }
}

const chip = (page: Page, name: string) => settings(page).getByRole('button', { name, exact: true })
const stored = (page: Page, key: string) => page.evaluate((name) => localStorage.getItem(name), key)
const attr = (page: Page, name: string) => page.evaluate((n) => document.documentElement.getAttribute(n), name)

async function makeList(request: APIRequestContext, title: string) {
  const items = Array.from({ length: 60 }, (_, n) => `  - { title: "Item ${String(n).padStart(3, '0')}", minutes: 30, group: "Group ${Math.floor(n / 20) + 1}" }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${items.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

test.describe('the THEME and SKIN choices', () => {
  test('under Quantum: two THEME chips with Quantum lit, and the five Quantum skins as before', async ({ page }) => {
    await open(page, { theme: 'quantum', skin: 'dark-blue' })
    await openSettings(page)

    await expect(chip(page, 'Quantum')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page, 'eX-Zed')).toHaveAttribute('aria-pressed', 'false')
    for (const name of QUANTUM_NAMES) await expect(chip(page, name)).toBeVisible()
    await expect(chip(page, 'Deluge')).toHaveAttribute('aria-pressed', 'true')
    for (const name of EXZED_NAMES) await expect(chip(page, name)).toHaveCount(0)
    await expect(settings(page).locator('.q-chip.skin .q-hex')).toHaveCount(5)
  })

  test('picking eX-Zed turns the page eX-Zed at once, shows its six skins with their swatches, and announces it', async ({ page }) => {
    await open(page, { theme: 'quantum', skin: 'dark-orange' })
    await openSettings(page)

    await chip(page, 'eX-Zed').click()

    await expect(chip(page, 'eX-Zed')).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => document.documentElement.classList.contains('theme-exzed'))).toBe(true)
    expect(await attr(page, 'data-theme')).toBe('exzed-1d')
    for (const name of EXZED_NAMES) await expect(chip(page, name)).toBeVisible()
    for (const name of QUANTUM_NAMES) await expect(chip(page, name)).toHaveCount(0)
    await expect(chip(page, 'Lode')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.q-live')).toHaveText('Switched to the eX-Zed theme')
    await expect(settings(page).locator('.q-chip.skin .q-zx-swatch')).toHaveCount(6)
    await expect(settings(page).locator('.q-chip.skin .q-hex')).toHaveCount(0)
  })

  test('each swatch is a 16px square with a 2px rim, its top the skin’s paper and its bottom the skin’s colour', async ({ page }) => {
    await open(page, { theme: 'exzed' })
    await openSettings(page)

    const swatches = await settings(page)
      .locator('.q-chip.skin')
      .evaluateAll((chips) =>
        chips.map((chipEl) => {
          const swatch = chipEl.querySelector('.q-zx-swatch') as HTMLElement
          const style = getComputedStyle(swatch)
          return { name: chipEl.textContent?.trim(), size: [swatch.offsetWidth, swatch.offsetHeight], rim: style.borderTopWidth, image: style.backgroundImage }
        }),
      )

    expect(swatches.map((entry) => entry.name)).toEqual([...EXZED_NAMES])
    for (const entry of swatches) expect([entry.size, entry.rim], entry.name).toEqual([[16, 16], '2px'])
    // From design's tokens: Lode is black over bright red, Lotus grey over normal blue (and every other skin black over its own colour).
    expect(swatches[0]!.image).toContain('rgb(255, 0, 0)')
    expect(swatches[1]!.image).toContain('rgb(0, 0, 255)')
    expect(swatches[5]!.image).toContain('rgb(215, 215, 215)')
    expect(swatches[5]!.image).toContain('rgb(0, 0, 215)')
    // The top half is the paper and the bottom half the skin colour, in that order down the square.
    const before = (image: string, first: string, second: string) => image.indexOf(first) !== -1 && image.indexOf(first) < image.indexOf(second)
    expect(before(swatches[0]!.image, 'rgb(0, 0, 0)', 'rgb(255, 0, 0)'), 'Lode: black over red').toBe(true)
    expect(before(swatches[5]!.image, 'rgb(215, 215, 215)', 'rgb(0, 0, 215)'), 'Lotus: grey over blue').toBe(true)
  })

  test('picking a skin applies it at once, stores it under exzedSkin, and survives a reload with the theme', async ({ page }) => {
    await open(page, { theme: 'quantum', skin: 'dark-green' })
    await openSettings(page)
    await chip(page, 'eX-Zed').click()
    await chip(page, 'Xen').click()

    expect(await attr(page, 'data-theme')).toBe(KEYS.Xen)
    await expect(page.locator('.q-live')).toHaveText('Switched to the Xen skin')
    expect([await stored(page, 'theme'), await stored(page, 'exzedSkin'), await stored(page, 'skin')]).toEqual(['exzed', 'exzed-1c', 'dark-green'])

    await page.reload()
    await page.locator('.q-home-row').first().waitFor()
    expect(await page.evaluate(() => document.documentElement.classList.contains('theme-exzed'))).toBe(true)
    expect(await attr(page, 'data-theme')).toBe('exzed-1c')
    await openSettings(page)
    await expect(chip(page, 'Xen')).toHaveAttribute('aria-pressed', 'true')
  })

  test('switching back to Quantum restores its own last skin, and eX-Zed keeps its own', async ({ page }) => {
    await open(page, { theme: 'quantum', skin: 'dark-violet', exzedSkin: 'exzed-1e' })
    await openSettings(page)

    await chip(page, 'eX-Zed').click()
    expect(await attr(page, 'data-theme')).toBe('exzed-1e')
    await chip(page, 'Lotus').click()
    await chip(page, 'Quantum').click()

    expect(await attr(page, 'data-theme')).toBe('dark-violet')
    await expect(chip(page, 'Romans')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.q-live')).toHaveText('Switched to the Quantum theme')
    expect([await stored(page, 'theme'), await stored(page, 'skin'), await stored(page, 'exzedSkin')]).toEqual(['quantum', 'dark-violet', 'exzed-1l'])

    await chip(page, 'eX-Zed').click()
    expect(await attr(page, 'data-theme')).toBe('exzed-1l')
  })

  test('an unknown stored exzedSkin starts as Lode and is left as it is in storage', async ({ page }) => {
    await open(page, { theme: 'exzed', exzedSkin: 'exzed-9z' })

    expect(await attr(page, 'data-theme')).toBe('exzed-1d')
    await openSettings(page)
    await expect(chip(page, 'Lode')).toHaveAttribute('aria-pressed', 'true')
    expect(await stored(page, 'exzedSkin')).toBe('exzed-9z')
  })

  test('a skin switched in eX-Zed redraws the open layers and keeps the filter, a half-typed Add row and the scroll', async ({ page }) => {
    const title = `e2e theme choices ${test.info().project.name} ${Date.now()}`
    const id = await makeList(page.request, title)

    try {
      await open(page, { theme: 'exzed', exzedSkin: 'exzed-1d' })
      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-item').first().waitFor()
      await page.getByPlaceholder('Filter items…').fill('Item')
      await page.locator('.q-add-item').getByLabel('Title').fill('Half typed')
      await page.evaluate(() => ((document.querySelector('.q-list-body') as HTMLElement).scrollTop = 400))
      const scrolled = await page.evaluate(() => (document.querySelector('.q-list-body') as HTMLElement).scrollTop)
      const ground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      expect(await ground()).toBe('rgb(0, 0, 0)')

      await openSettings(page)
      await chip(page, 'Lotus').click()
      await settings(page).getByRole('button', { name: 'Close', exact: true }).click()

      expect(await attr(page, 'data-theme')).toBe('exzed-1l')
      expect(await ground(), 'the page is Lotus’s grey').toBe('rgb(215, 215, 215)')
      await expect(page.getByPlaceholder('Filter items…')).toHaveValue('Item')
      await expect(page.locator('.q-add-item').getByLabel('Title')).toHaveValue('Half typed')
      expect(await page.evaluate(() => (document.querySelector('.q-list-body') as HTMLElement).scrollTop)).toBe(scrolled)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })

  test('the labels read in Russian and German: the theme names as they are, the kickers translated, no « »', async ({ page }) => {
    await open(page, { theme: 'exzed' })
    await openSettings(page)

    await chip(page, 'Русский').click()
    await expect(settings(page).locator('.q-kicker').first()).toHaveText('Тема')
    await expect(chip(page, 'eX-Zed')).toBeVisible()
    await expect(chip(page, 'Quantum')).toBeVisible()
    await chip(page, 'Quantum').click()
    await expect(page.locator('.q-live')).toHaveText('Тему заменили: Quantum')
    await chip(page, 'eX-Zed').click()

    await chip(page, 'Deutsch').click()
    await expect(settings(page).locator('.q-kicker').first()).toHaveText('Design')
    await chip(page, 'Quantum').click()
    await expect(page.locator('.q-live')).toHaveText('Thema gewechselt: Quantum.')

    expect(await settings(page).innerText()).not.toMatch(/[«»]/)
    for (const name of EXZED_NAMES) expect(KEYS[name]).toMatch(/^exzed-1[a-z]$/)
  })
})
