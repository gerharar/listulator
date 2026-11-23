import { expect, test, type Page } from '@playwright/test'
import { q } from './fixtures.js'

/**
 * The smaller layers' gutters under eX-Zed (57.7c, design's D57 and D58): Choose Your Fighter's body, Settings' body and the Preview's head, rows' area and footer are 24px in from the
 * window's border on each side (the Window card's `space-3`; Quantum's 26px and 22px are not on the theme's 8px steps), the Choose Your Fighter body 24px above and none below (its
 * scene sits on the window's bottom edge), Settings' 24px all round, the Preview's head 24px above, its footer 12px above and below (a row's own air: D58). The picker's scene takes
 * the body's side padding back, so it still runs the scroll area's full width. In both engines, six skins at 1440 for the picker and Settings; the Preview in Lode and Lotus.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

async function boot(page: Page, skin: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme: 'exzed', exzedSkin: skin }))
}

const paddings = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((element) => {
    const style = getComputedStyle(element)

    return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
  })

for (const skin of SKINS) {
  test(`${skin}: Choose Your Fighter's body is 24px above and at the sides and the scene still runs its full width`, async ({ page }) => {
    await boot(page, skin)
    await page.goto('/')
    await page.getByRole('button', { name: q.home.newList }).click()
    await page.locator('.q-tile').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(500)

    expect(await paddings(page, '.q-picker-body'), 'the body: 24px above and at the sides, none below').toEqual(['24px', '24px', '0px', '24px'])
    const at = await page.evaluate(() => {
      const body = document.querySelector('.q-picker-body')!
      const scene = document.querySelector('.q-scene')!.getBoundingClientRect()
      const box = body.getBoundingClientRect()

      return { bodyLeft: box.left, bodyClient: body.clientWidth, sceneLeft: scene.left, sceneWidth: scene.width }
    })
    expect(at.sceneLeft, 'the scene starts at the body’s left edge').toBe(at.bodyLeft)
    expect(at.sceneWidth, 'and is as wide as the body').toBe(at.bodyClient)
  })

  test(`${skin}: Settings' body is 24px all round`, async ({ page }) => {
    await boot(page, skin)
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.locator('.q-settings').waitFor()
    await page.waitForTimeout(400)

    expect(await paddings(page, '.q-settings-body')).toEqual(['24px', '24px', '24px', '24px'])
  })
}

for (const skin of ['exzed-1d', 'exzed-1l'] as const) {
  test(`${skin}: the Preview's head, rows' area and footer are 24px in from the window's border`, async ({ page }) => {
    const items = Array.from({ length: 12 }, (_, n) => ({ title: `Preview item ${n + 1}`, timeToConsumeMinutes: 30, group: n < 6 ? 'Part one' : 'Part two' }))
    await page.route('**/api/media-types/music/search**', (route) =>
      route.fulfill({ json: { sources: [{ externalRef: 'gutters-1', title: 'Gutters source', detail: 'Group · XX', itemCount: items.length }] } }),
    )
    await page.route('**/api/media-types/music/expansion**', (route) =>
      route.fulfill({ json: route.request().url().includes('items=true') ? { itemCount: items.length, status: 'complete', items } : { itemCount: items.length } }),
    )
    await boot(page, skin)
    await page.goto('/')
    await page.getByRole('button', { name: q.home.newList }).click()
    await page.locator('.q-tile', { hasText: /^Music/ }).click()
    await page.getByLabel(/^Search .* or List Vault$/).fill('gutters')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await page.locator('.q-result').first().waitFor()
    await page.locator('.q-result').first().click()
    await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
    await page.locator('.q-preview-row').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(500)

    expect(await paddings(page, '.q-preview-head'), 'the head: 24px above and at the sides').toEqual(['24px', '24px', '0px', '24px'])
    expect(await paddings(page, '.q-preview-body'), 'the rows’ area: 24px at the sides').toEqual(['0px', '24px', '0px', '24px'])
    expect(await paddings(page, '.q-preview-footer'), 'the footer: 12px above and below, 24px at the sides').toEqual(['12px', '24px', '12px', '24px'])
  })
}
