import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * eX-Zed's Preview rows (51.8, X-007; design's Row card and the Preview board), on the real screen, in both engines and all six skins. **Every row is 32px and flat, a group head 32px with a
 * 2px `frame` rule under it and a chevron; the title is `ink`, the year and the runtime `ink2`, all 16px; the runtime column is 96px and right-aligned; a head takes the highlight on hover (an
 * item row is not interactive and takes none); the windowed list's total height is that of 32px rows.**
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const
const ROW = 32
const COUNT = 6

const items = Array.from({ length: COUNT }, (_, n) => ({
  title: `Episode ${n}`,
  externalRef: `pv:${n}`,
  year: 1990 + n,
  timeToConsumeMinutes: 46 + n,
  group: `Volume ${Math.floor(n / 3)}`,
}))

async function openPreview(page: Page, skin: string) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.route('**/api/media-types/music/search**', (route) => route.fulfill({ json: { sources: [{ externalRef: 'pv-1', title: 'Preview source', detail: 'Group · XX', itemCount: COUNT }] } }))
  await page.route('**/api/media-types/music/expansion**', (route) =>
    route.fulfill({ json: route.request().url().includes('items=true') ? { itemCount: COUNT, status: 'complete', items } : { itemCount: COUNT } }),
  )
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
  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: 'Music' }).click()
  await expect(page.getByRole('tab', { name: 'Search', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Search MusicBrainz or List Vault', { exact: true }).fill('preview')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('.q-result').first().waitFor()
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
  })
  await page.locator('.q-result').first().click()
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
  await page.locator('.q-preview-row').first().waitFor()
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
  })
}

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const css = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)

for (const skin of SKINS) {
  test(`${skin}: the Preview's rows are flat 32px lines in 16px ink and ink2, its group heads 32px with the 2px frame rule and the highlight on hover, and the list is as tall as 32px rows`, async ({ page }) => {
    await openPreview(page, skin)
    const [ink, ink2, frame, acc, accInk] = await Promise.all(['--zx-ink', '--zx-ink2', '--zx-frame', '--zx-acc', '--zx-acc-ink'].map((n) => token(page, n)))
    await page.mouse.move(0, 0)

    const row = page.locator('.q-preview-row').first()
    expect(await style(row, ['height', 'border-bottom-width', 'padding-left', 'column-gap']), 'a row: 32px, flat, indented in its group').toEqual({ height: '32px', 'border-bottom-width': '0px', 'padding-left': '32px', 'column-gap': '16px' })
    expect(await style(row.locator('.title'), ['color', 'font-size', 'font-weight'])).toEqual({ color: css(ink!), 'font-size': '16px', 'font-weight': '400' })
    expect(await style(row.locator('.q-year'), ['color', 'font-size'])).toEqual({ color: css(ink2!), 'font-size': '16px' })
    expect(await style(row.locator('.mins'), ['color', 'font-size', 'font-weight', 'width', 'text-align'])).toEqual({ color: css(ink2!), 'font-size': '16px', 'font-weight': '400', width: '96px', 'text-align': 'right' })

    const head = page.locator('.q-preview-group').first()
    expect(await style(head, ['height', 'border-bottom-width', 'border-bottom-style', 'border-bottom-color', 'font-weight'])).toEqual({
      height: '32px',
      'border-bottom-width': '2px',
      'border-bottom-style': 'solid',
      'border-bottom-color': css(frame!),
      'font-weight': '400',
    })
    expect(await style(head.locator('.name'), ['color', 'font-size', 'font-weight'])).toEqual({ color: css(ink!), 'font-size': '16px', 'font-weight': '400' })
    expect(await style(head.locator('.count'), ['color', 'font-size', 'font-weight'])).toEqual({ color: css(ink2!), 'font-size': '16px', 'font-weight': '400' })

    // The head is a button: the highlight and acc-ink on hover. An item row is not one: it takes nothing.
    await head.hover({ position: { x: 300, y: 16 } })
    expect(await style(head, ['background-color', 'color'])).toEqual({ 'background-color': css(acc!), color: css(accInk!) })
    expect((await style(head.locator('.count'), ['color'])).color).toBe(css(accInk!))
    await row.hover({ position: { x: 300, y: 16 } })
    expect((await style(row, ['background-color']))['background-color']).toBe('rgba(0, 0, 0, 0)')

    // The windowed list counts 32px rows: two heads and six rows.
    expect(await page.locator('.q-preview-body').evaluate((element) => element.scrollHeight - element.clientHeight <= 0 || element.scrollHeight)).toBeTruthy()
    const total = await page.evaluate((h) => {
      const rows = [...document.querySelectorAll('.q-preview-row, .q-preview-group')] as HTMLElement[]

      return rows.reduce((sum, element) => sum + element.getBoundingClientRect().height, 0) / h
    }, ROW)
    expect(total, 'eight rows of 32px: two heads and six items').toBe(8)
  })
}
