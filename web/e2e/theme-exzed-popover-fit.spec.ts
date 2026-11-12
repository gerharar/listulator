import { expect, test, type Page } from '@playwright/test'

/**
 * The popovers' widths and the buttons in them (51.2c, X-007; found by the owner at Checkpoint G1: with the bracketed buttons at 16px, [Don't Save] filled its popover and Copy To
 * Clipboard ran out of the export one). The Popover card's widths (240 the list menu, 560 list edit, item edit, delete, reorder, export and reset) and, in every popover
 * opened here, in both engines and all six skins, **every button, chip and field lies inside the popover's content box**.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

async function boot(page: Page, skin: string, width = 1440) {
  await page.setViewportSize({ width, height: 900 })
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

async function makeList(page: Page) {
  const title = `Fit ${test.info().project.name} ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  const items = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name, n) => ({ title: name, timeToConsumeMinutes: 30, group: n < 2 ? 'Season 1' : 'Season 2' }))
  await page.request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return { id: list.id as string, title }
}

/** The popovers on the page: their width and what in them leaves the content box (by more than a pixel). */
const popovers = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.q-pop')].map((pop) => {
      const box = pop.getBoundingClientRect()
      const css = getComputedStyle(pop)
      const left = box.left + parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth)
      const right = box.right - parseFloat(css.paddingRight) - parseFloat(css.borderRightWidth)
      const out: string[] = []
      for (const part of pop.querySelectorAll('.q-btn, .q-icon-btn, .q-chip, input, .q-input')) {
        const r = part.getBoundingClientRect()
        if (r.width === 0) continue
        if (r.right - right > 1 || left - r.left > 1) out.push(`${(part.textContent ?? part.getAttribute('aria-label') ?? '').trim().slice(0, 20)}: ${Math.round(r.left - left)} to ${Math.round(r.right - right)}`)
      }

      return { width: Math.round(box.width), out, viewport: box.right <= window.innerWidth && box.left >= 0 }
    }),
  )

const more = (page: Page) => page.locator('.q-list-actions').getByRole('button', { name: 'More', exact: true })
/** Escape closes the popover; if it is still there (a confirm asked from a row), a click outside does, which is its own contract (a second Escape would close the list layer under it). */
const closeAll = async (page: Page) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  if ((await page.locator('.q-pop').count()) > 0) await page.locator('.q-catcher').click({ position: { x: 3, y: 3 } })
  await expect(page.locator('.q-pop')).toHaveCount(0)
}
/** The popover is placed (floating-ui keeps it unseen until then) and has settled at its width. */
const placed = async (page: Page) => {
  await expect(page.locator('.q-pop').first()).toHaveCSS('opacity', '1')
  await page.waitForTimeout(250)
}

for (const skin of SKINS) {
  test(`${skin}: the list menu is 240px and its answers are 560 (list edit, export, reorder, delete) wide, every button inside its popover`, async ({ page }) => {
    const list = await makeList(page)
    try {
      await boot(page, skin)
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: list.title }).click()
      await page.locator('.q-group').first().waitFor()

      await more(page).click()
      await placed(page)
      let seen = await popovers(page)
      expect([seen[0]!.width, seen[0]!.out], 'list menu').toEqual([240, []])
      await closeAll(page)

      for (const [name, width] of [['Edit List', 560], ['Export List', 560], ['Reorder List', 560], ['Delete List', 560]] as const) {
        await more(page).click()
        await page.locator('.q-pop .q-btn', { hasText: name }).click()
        await page.locator('.q-pop').first().waitFor()
        await placed(page)
        seen = await popovers(page)
        expect([seen[0]!.width, seen[0]!.out, seen[0]!.viewport], name).toEqual([width, [], true])
        await closeAll(page)
      }
    } finally {
      await page.request.delete(`/api/lists/${list.id}`)
    }
  })

  test(`${skin}: Delete group's confirm and the item edit popover are 560px wide with every button inside`, async ({ page }) => {
    const list = await makeList(page)
    try {
      await boot(page, skin)
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: list.title }).click()
      await page.locator('.q-group').first().waitFor()

      await page.locator('.q-group').first().hover()
      await page.locator('.q-group').first().locator('.q-group-remove').click()
      await page.locator('.q-pop').first().waitFor()
      await placed(page)
      let seen = await popovers(page)
      expect([seen[0]!.width, seen[0]!.out], 'delete group').toEqual([560, []])
      await closeAll(page)

      await page.locator('.q-item').first().hover()
      await page.locator('.q-item').first().locator('.q-icon-btn.edit').first().click({ force: true })
      await page.locator('.q-pop').first().waitFor()
      await placed(page)
      seen = await popovers(page)
      expect([seen[0]!.width, seen[0]!.out], 'item edit').toEqual([560, []])
    } finally {
      await page.request.delete(`/api/lists/${list.id}`)
    }
  })
}

test('at the narrowest window the wide popovers are still inside it, and the buttons inside them', async ({ page }) => {
  const list = await makeList(page)
  try {
    await boot(page, 'exzed-1d', 1128)
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: list.title }).click()
    await page.locator('.q-group').first().waitFor()
    await more(page).click()
    await page.locator('.q-pop .q-btn', { hasText: 'Export List' }).click()
    await page.locator('.q-pop').first().waitFor()
    await placed(page)
    const seen = await popovers(page)
    expect([seen[0]!.out, seen[0]!.viewport]).toEqual([[], true])
    expect(seen[0]!.width).toBeLessThanOrEqual(1128 - 32)
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})
