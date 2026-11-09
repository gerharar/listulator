import { expect, test, type Page } from '@playwright/test'

/**
 * The header's skin button and menu per theme (Phase 49.9, design X-003: the Header and Menu cards), in both engines. Under eX-Zed, for each of the six
 * skins: the bar’s ground is the skin’s `hdr` (Lotus’s is light), the button’s swatch is the half-bucket with `hdr` on top and the skin colour below in a 2px
 * rim of the header’s text colour, the menu is 288px with the six skins by name, the one in force is the `acc` block and marked, and picking another applies
 * it at once, closes the menu and announces it; Esc and a click outside close it, and the keyboard reaches and picks a row. Quantum’s menu is still 220px
 * with its five skins. Reads only; the preferences live in the browser’s storage.
 */
const SKINS = [
  { key: 'exzed-1d', name: 'Lode', hdr: 'rgb(0, 0, 0)', hdrInk: 'rgb(255, 255, 255)', skin: 'rgb(255, 0, 0)', acc: 'rgb(255, 255, 0)', accInk: 'rgb(0, 0, 0)' },
  { key: 'exzed-1a', name: 'Focal', hdr: 'rgb(0, 0, 0)', hdrInk: 'rgb(255, 255, 255)', skin: 'rgb(0, 0, 255)', acc: 'rgb(255, 255, 0)', accInk: 'rgb(0, 0, 0)' },
  { key: 'exzed-1b', name: 'Glemt', hdr: 'rgb(0, 0, 0)', hdrInk: 'rgb(255, 255, 255)', skin: 'rgb(255, 255, 255)', acc: 'rgb(255, 255, 255)', accInk: 'rgb(0, 0, 0)' },
  { key: 'exzed-1c', name: 'Xen', hdr: 'rgb(0, 0, 0)', hdrInk: 'rgb(255, 255, 255)', skin: 'rgb(0, 255, 0)', acc: 'rgb(255, 255, 0)', accInk: 'rgb(0, 0, 0)' },
  { key: 'exzed-1e', name: 'Kui', hdr: 'rgb(0, 0, 0)', hdrInk: 'rgb(255, 255, 255)', skin: 'rgb(0, 255, 255)', acc: 'rgb(255, 255, 0)', accInk: 'rgb(0, 0, 0)' },
  { key: 'exzed-1l', name: 'Lotus', hdr: 'rgb(215, 215, 215)', hdrInk: 'rgb(0, 0, 0)', skin: 'rgb(0, 0, 215)', acc: 'rgb(0, 0, 0)', accInk: 'rgb(215, 215, 215)' },
] as const

const NAMES = SKINS.map((entry) => entry.name)

async function open(page: Page, stored: Record<string, string>) {
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ reducedMotion: 'true', skin: 'dark-orange', ...stored }))
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
}

const skinButton = (page: Page) => page.getByRole('button', { name: 'Skin', exact: true })
const menu = (page: Page) => page.locator('.q-pop')
const rows = (page: Page) => menu(page).locator('.q-pop-menu button')
const attr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'))

test.describe('with the theme exzed', () => {
  for (const entry of SKINS) {
    test.describe(`the skin ${entry.name}`, () => {
      test.beforeEach(async ({ page }) => {
        await open(page, { theme: 'exzed', exzedSkin: entry.key })
      })

      test('the header is the skin’s hdr and the button’s swatch is hdr over the skin colour in a 2px rim of the header’s text', async ({ page }) => {
        const look = await page.evaluate(() => {
          const header = getComputedStyle(document.querySelector('.q-appheader')!)
          const swatch = document.querySelector('.q-skin-btn .q-zx-swatch') as HTMLElement
          const style = getComputedStyle(swatch)

          return { ground: header.backgroundColor, size: [swatch.offsetWidth, swatch.offsetHeight], rim: [style.borderTopWidth, style.borderTopColor], image: style.backgroundImage, theme: swatch.getAttribute('data-theme') }
        })

        expect(look.ground).toBe(entry.hdr)
        expect(look.size).toEqual([16, 16])
        expect(look.rim).toEqual(['2px', entry.hdrInk])
        expect(look.theme).toBe(entry.key)
        expect(look.image.indexOf(entry.hdr), 'the header’s ground is the top half').toBeGreaterThanOrEqual(0)
        expect(look.image.indexOf(entry.skin), 'the skin colour is the bottom half').toBeGreaterThan(look.image.indexOf(entry.hdr))
        await expect(page.locator('.q-skin-btn .q-hex')).toHaveCount(0)
      })

      test('the menu is 288px with the six skins by name, the one in force marked and filled with the accent', async ({ page }) => {
        await skinButton(page).click()
        await menu(page).waitFor()

        expect((await menu(page).boundingBox())!.width).toBe(288)
        await expect(rows(page)).toHaveText(NAMES)
        for (const other of SKINS) {
          await expect(rows(page).filter({ hasText: other.name })).toHaveAttribute('aria-current', other.key === entry.key ? 'true' : 'false')
        }
        const current = await rows(page).filter({ hasText: entry.name }).evaluate((row) => ({ background: getComputedStyle(row).backgroundColor, color: getComputedStyle(row).color }))
        expect(current).toEqual({ background: entry.acc, color: entry.accInk })
        await expect(menu(page).locator('.q-zx-swatch')).toHaveCount(6)
      })
    })
  }

  test('picking a skin with the mouse applies it at once, closes the menu and announces it', async ({ page }) => {
    await open(page, { theme: 'exzed', exzedSkin: 'exzed-1d' })
    await skinButton(page).click()
    await rows(page).filter({ hasText: 'Xen' }).click()

    expect(await attr(page)).toBe('exzed-1c')
    await expect(menu(page)).toHaveCount(0)
    await expect(page.locator('.q-live')).toHaveText('Switched to the Xen skin')
    expect(await page.evaluate(() => localStorage.getItem('exzedSkin'))).toBe('exzed-1c')
    expect(await page.evaluate(() => localStorage.getItem('skin'))).toBe('dark-orange')
    // The header follows at once: the swatch is Xen’s.
    await expect(page.locator('.q-skin-btn .q-zx-swatch')).toHaveAttribute('data-theme', 'exzed-1c')
  })

  test('Esc closes the menu and changes nothing; so does a click outside it', async ({ page }) => {
    await open(page, { theme: 'exzed', exzedSkin: 'exzed-1a' })

    await skinButton(page).click()
    await menu(page).waitFor()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    expect(await attr(page)).toBe('exzed-1a')

    await skinButton(page).click()
    await menu(page).waitFor()
    await page.mouse.click(40, 600)
    await expect(menu(page)).toHaveCount(0)
    expect(await attr(page)).toBe('exzed-1a')
  })

  test('the keyboard opens the menu with Enter, and Enter on a row picks it', async ({ page }) => {
    await open(page, { theme: 'exzed', exzedSkin: 'exzed-1d' })

    await skinButton(page).focus()
    await page.keyboard.press('Enter')
    await menu(page).waitFor()
    // The shared popover does not move focus into itself (true of every popover in the app, Quantum's too; BL-168): a row is a real button, so it is
    // focused here and operated with the key, which is what a person who Tabbed to it does.
    const row = rows(page).filter({ hasText: 'Glemt' })
    await row.focus()
    await page.keyboard.press('Enter')

    expect(await attr(page)).toBe('exzed-1b')
    await expect(menu(page)).toHaveCount(0)
    await expect(page.locator('.q-live')).toHaveText('Switched to the Glemt skin')
  })
})

test.describe('the skin button beside the header\u2019s icon buttons', () => {
  // Found by the owner at 49.12: the skin button\u2019s height was a literal 36px, 4px short of the 40px icon buttons beside it under eX-Zed.
  for (const [theme, height] of [['quantum', 36], ['exzed', 40]] as const) {
    test(`is as tall as they are under ${theme}: ${height}px`, async ({ page }) => {
      await open(page, { theme })

      const heights = await page.evaluate(() => ['.q-skin-btn', '.q-appheader .tools .q-icon-btn'].map((selector) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect().height))

      expect(heights).toEqual([height, height])
    })
  }
})

test.describe('with the theme quantum', () => {
  test('the menu is still 220px with the five skins and the hexagon', async ({ page }) => {
    await open(page, { theme: 'quantum', skin: 'dark-green' })

    await expect(page.locator('.q-skin-btn .q-hex')).toHaveCount(1)
    await expect(page.locator('.q-skin-btn .q-zx-swatch')).toHaveCount(0)
    await skinButton(page).click()
    await menu(page).waitFor()

    expect((await menu(page).boundingBox())!.width).toBe(220)
    await expect(rows(page)).toHaveText(['Destiny', 'Jupiter', 'Deluge', 'Romans', 'Jouhou'])
    await expect(rows(page).filter({ hasText: 'Jupiter' })).toHaveAttribute('aria-current', 'true')
  })
})
