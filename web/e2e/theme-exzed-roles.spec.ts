import { expect, test, type Page } from '@playwright/test'

/**
 * eX-Zed's colour roles per skin (Phase 49.1), computed in both engines: the six skin keys each give the `--zx-` roles design's values (spot-checked
 * here by the roles that tell the skins apart; every value of every skin is pinned by the unit test against design's file), an alias resolves, a
 * nested element carrying its own `data-theme` draws another skin (a swatch), and nothing leaks into Quantum. Reads only; no write.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

/** acc, paper, skin, prog, t2 (an alias of acc, except on Lotus) per skin, from design's tokens. */
const EXPECTED = {
  'exzed-1d': { acc: '#ffff00', paper: '#000000', skin: '#ff0000', prog: '#ff0000', t2: '#ffff00' },
  'exzed-1a': { acc: '#ffff00', paper: '#000000', skin: '#0000ff', prog: '#00ffff', t2: '#ffff00' },
  'exzed-1b': { acc: '#ffffff', paper: '#000000', skin: '#ffffff', prog: '#ffffff', t2: '#ffffff' },
  'exzed-1c': { acc: '#ffff00', paper: '#000000', skin: '#00ff00', prog: '#00ff00', t2: '#ffff00' },
  'exzed-1e': { acc: '#ffff00', paper: '#000000', skin: '#00ffff', prog: '#00ffff', t2: '#ffff00' },
  'exzed-1l': { acc: '#000000', paper: '#d7d7d7', skin: '#0000d7', prog: '#0000d7', t2: '#0000ff' },
} as const

async function boot(page: Page, theme: string) {
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ theme, skin: 'dark-orange', reducedMotion: 'true' }))
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
}

const roles = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const style = getComputedStyle(document.querySelector(sel)!)
    const read = (name: string) => style.getPropertyValue(`--zx-${name}`).trim()
    return { acc: read('acc'), paper: read('paper'), skin: read('skin'), prog: read('prog'), t2: read('t2'), infoLine: read('info-line') }
  }, selector)

test.describe('with the theme exzed', () => {
  for (const key of SKINS) {
    test(`the skin ${key} gives the roles design’s values`, async ({ page }) => {
      await boot(page, 'exzed')
      await page.evaluate((skin) => document.documentElement.setAttribute('data-theme', skin), key)

      const seen = await roles(page, 'html')
      const want = EXPECTED[key]
      expect([seen.acc, seen.paper, seen.skin, seen.prog, seen.t2]).toEqual([want.acc, want.paper, want.skin, want.prog, want.t2])
      // `info-line` is listed for the first skin and Lotus only: the others take the default's bright cyan.
      expect(seen.infoLine).toBe(key === 'exzed-1l' ? '#0000d7' : '#00ffff')
    })
  }

  test('an eX-Zed page with no skin of its own yet is the default skin (Lode)', async ({ page }) => {
    await boot(page, 'exzed')
    // Quantum’s skin key is on `<html>` (the skin preference is 49.2’s): no `exzed-…` block matches, the bare `theme-exzed` default does.
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark-orange')
    expect((await roles(page, 'html')).acc).toBe('#ffff00')
    expect((await roles(page, 'html')).paper).toBe('#000000')
  })

  test('an element that carries its own skin draws that skin, whatever the page’s (the swatch)', async ({ page }) => {
    await boot(page, 'exzed')
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'exzed-1d')
      document.body.insertAdjacentHTML('beforeend', '<span id="zz-lotus" data-theme="exzed-1l">x</span>')
    })

    expect((await roles(page, '#zz-lotus')).paper).toBe('#d7d7d7')
    expect((await roles(page, 'html')).paper).toBe('#000000')
  })
})

test.describe('with the theme quantum', () => {
  test('the roles are not on the page: Quantum draws nothing from them', async ({ page }) => {
    await boot(page, 'quantum')

    expect((await roles(page, 'html')).acc).toBe('')
    expect((await roles(page, 'body')).paper).toBe('')
  })
})
