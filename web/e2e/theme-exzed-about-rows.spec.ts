import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * eX-Zed's About rows (51.8, X-007; design's About board), on the real screen, in both engines and all six skins. **The data sources are flat rows with no rule between them or under the list, at least
 * 40px high, 16px apart: the name `ink`, its description and link `ink2`, all 16px regular; the folded TMDB row takes the highlight on hover.**
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

async function openAbout(page: Page, skin: string) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin }))
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  await page.getByRole('button', { name: 'About', exact: true }).click()
  await page.locator('.q-about-source').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const css = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)

for (const skin of SKINS) {
  test(`${skin}: About's data sources are flat 40px rows in 16px ink and ink2, and the folded TMDB row takes the highlight`, async ({ page }) => {
    await openAbout(page, skin)
    const [ink, ink2, acc, accInk] = (await Promise.all(['--zx-ink', '--zx-ink2', '--zx-acc', '--zx-acc-ink'].map((n) => token(page, n)))).map((hex) => css(hex))
    await page.mouse.move(0, 0)

    expect((await style(page.locator('.q-about-sources'), ['border-bottom-width']))['border-bottom-width'], 'no rule under the list').toBe('0px')
    const row = page.locator('.q-about-source').first()
    const seen = await style(row, ['border-top-width', 'min-height', 'column-gap', 'padding-top'])
    expect(seen).toMatchObject({ 'border-top-width': '0px', 'min-height': '40px', 'column-gap': '16px' })
    expect(await style(row.locator('.q-about-source-name'), ['color', 'font-size', 'font-weight'])).toEqual({ color: ink, 'font-size': '16px', 'font-weight': '400' })
    expect(await style(row.locator('.q-about-source-powers'), ['color', 'font-size', 'font-weight'])).toEqual({ color: ink2, 'font-size': '16px', 'font-weight': '400' })

    // The folded TMDB row (it opens by default: fold it first) takes the highlight.
    const tmdb = page.locator('.q-about-tmdb')
    if (await tmdb.evaluate((el) => el.classList.contains('open'))) await tmdb.locator('.q-about-toggle').click()
    await page.mouse.move(0, 0)
    await expect(tmdb).not.toHaveClass(/\bopen\b/)
    await tmdb.hover({ position: { x: 400, y: 16 } })
    expect(await style(tmdb, ['background-color', 'color'])).toEqual({ 'background-color': acc, color: accInk })
  })
}
