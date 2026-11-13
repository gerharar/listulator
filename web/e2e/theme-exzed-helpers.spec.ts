import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * eX-Zed's helper text (D21a, X-007; found by the owner at Checkpoint G2: placeholders and empty values lost their italic and read as real text), on the real screens, in both engines and
 * all six skins. **Every place Quantum sets in italics (a placeholder, the empty values "No group", "None" and "Not set") is the `helper` style: the ZX Spectrum Italic face, 16px, `ink2`.**
 * The face is proved by pixels, not by a style: the same text drawn with the italic switched off must look different (the font has no italic of its own, and the browser may not make one).
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

const SUMMARY = {
  id: 'L1',
  title: 'Helpers',
  description: null as string | null,
  mediaType: 'game',
  source: 'manual',
  externalRef: null,
  status: null as string | null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  stats: { totalItems: 2, consumedItems: 0, newItems: 0, completionPercent: 0, timeRemainingMinutes: 180, lastConsumedAt: null },
}
const item = (n: number, tags: string[] | null) => ({
  id: `i${n}`,
  listId: 'L1',
  title: `Game ${n}`,
  orderIndex: n,
  timeToConsumeMinutes: 90,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'manual',
  year: null,
  yearUnk: 0,
  group: null,
  tags,
  notes: null,
  isNew: false,
})

async function open(page: Page, skin: string) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
  await page.route('**/api/lists', (route) => route.fulfill({ json: [SUMMARY] }))
  await page.route('**/api/lists/L1', (route) => route.fulfill({ json: { ...SUMMARY, items: [item(1, ['PS3']), item(2, null)], groups: [] } }))
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
  await page.locator('.q-home-row').first().click()
  await page.locator('.q-item').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const css = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

/** The helper's style: for a placeholder, its `::placeholder` pseudo-element; for a span, the element. */
const styleOf = (target: Locator, pseudo: string | null) =>
  target.evaluate((element, which) => {
    const style = getComputedStyle(element, which)

    return { style: style.fontStyle, size: style.fontSize, weight: style.fontWeight, color: style.color, family: style.fontFamily }
  }, pseudo)

/** What a box looks like, as a picture; `off` is the CSS that switches the italic off for the same text. */
async function picture(page: Page, target: Locator) {
  await page.mouse.move(0, 0)
  const box = (await target.boundingBox())!

  return (await page.screenshot({ clip: box })).toString('base64')
}
const NO_ITALIC = 'input::placeholder, textarea::placeholder, .q-add-plat-value, .q-platfield-value, .q-tagchoice-value { font-style: normal !important }'

for (const skin of SKINS) {
  test(`${skin}: the placeholders and the empty values are the helper style, in the italic face (pixels differ from the same text upright)`, async ({ page }) => {
    await open(page, skin)
    const ink2 = css(await token(page, '--zx-ink2'))

    // The italic face is in the page's fonts and loaded once such text is drawn.
    const faces = await page.evaluate(async () => {
      await document.fonts.load('italic 16px "ZX Spectrum"')

      return [...document.fonts].filter((face) => face.family.replace(/["']/g, '') === 'ZX Spectrum').map((face) => `${face.style} ${face.status}`)
    })
    expect(faces, 'the italic face is declared and loaded').toContain('italic loaded')

    const targets: [string, Locator, string | null][] = [
      ['the add row’s title placeholder', page.getByPlaceholder('Add an item…'), '::placeholder'],
      ['the Group field’s "No group"', page.getByPlaceholder('No group'), '::placeholder'],
      ['the add row’s empty platform', page.locator('.q-add-plat-value.empty'), null],
    ]
    for (const [label, target, pseudo] of targets) {
      await expect(target, label).toHaveCount(1)
      const seen = await styleOf(target, pseudo)
      expect(seen, label).toMatchObject({ style: 'italic', size: '16px', weight: '400', color: ink2 })
      expect(seen.family, `${label}: the Spectrum family`).toMatch(/ZX Spectrum/)
      const italic = await picture(page, target)
      await page.addStyleTag({ content: NO_ITALIC })
      const upright = await picture(page, target)
      expect(italic, `${label}: drawn in the italic face, not the upright one`).not.toBe(upright)
      // Back to the italic for the next one: reload is not needed, the override is the only difference.
      await page.evaluate(() => document.querySelectorAll('style').forEach((tag) => tag.textContent?.includes('font-style: normal !important') && tag.remove()))
    }

    // The Edit window's "Not set" (an item with no platform).
    await page.locator('.q-item', { hasText: 'Game 2' }).locator('.q-icon-btn.edit').click()
    const empty = page.locator('.q-platfield-value.empty')
    await expect(empty).toHaveCount(1)
    expect(await styleOf(empty, null), 'the Edit window’s empty platform').toMatchObject({ style: 'italic', size: '16px', weight: '400', color: ink2 })
    const italic = await picture(page, empty)
    await page.addStyleTag({ content: NO_ITALIC })
    expect(await picture(page, empty), 'the Edit window’s "Not set": drawn in the italic face').not.toBe(italic)
  })
}
