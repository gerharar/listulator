import { expect, test, type Locator, type Page } from '@playwright/test'
import { q } from './fixtures.js'

/**
 * eX-Zed's toggle chips, tabs and facet toggles (51.3, X-007; design's ToggleChip and Tabs cards), on the real screens, in both engines and all six skins: **a chip is a 40px box with a 2px
 * `frame` border, `ink2` at rest; hover (unpicked) is the `acc-dim` block with `acc-ink`; picked is the `acc` block with `acc-ink`; chips wrap with 8px gaps** (the joined segmented bar is
 * retired: the filter popover's options are chips like the rest). Read on Settings (Theme, Skin, Interface language), the Create layer's status chips, and the Games filter popover; **a tab
 * is the same 40px box without its bottom border, 8px apart, the active one the `acc` block, hover on an inactive one `acc-dim`, no hover underline**.
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

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
const style = (locator: Locator, props: string[]) => locator.evaluate((element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element).getPropertyValue(name)])), props)
const SIDES = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color']

async function roles(page: Page) {
  const [frame, ink2, acc, accDim, accInk] = await Promise.all(['--zx-frame', '--zx-ink2', '--zx-acc', '--zx-acc-dim', '--zx-acc-ink'].map((n) => token(page, n)))
  const clear = 'rgba(0, 0, 0, 0)'

  return { frame: rgb(frame!), ink2: rgb(ink2!), acc: rgb(acc!), accDim: rgb(accDim!), accInk: rgb(accInk!), clear }
}

type Roles = Awaited<ReturnType<typeof roles>>

/** One chip at rest (unpicked), hovered, and picked: the card's three looks, and the 40px box. */
async function readChips(page: Page, unpicked: Locator, picked: Locator, r: Roles, label: string) {
  const box = (await unpicked.boundingBox())!
  expect(box.height, `${label}: 40px high`).toBe(40)

  const rest = await style(unpicked, [...SIDES, 'color', 'background-color', 'padding-left', 'padding-right', 'box-shadow', 'font-size', 'font-weight'])
  for (const side of ['top', 'right', 'bottom', 'left']) {
    expect([rest[`border-${side}-width`], rest[`border-${side}-color`]], `${label}: ${side} border at rest`).toEqual(['2px', r.frame])
  }
  expect([rest.color, rest['background-color'], rest['box-shadow'], rest['font-size'], rest['font-weight']], `${label} at rest`).toEqual([r.ink2, r.clear, 'none', '16px', '400'])

  await unpicked.hover()
  const hover = await style(unpicked, ['color', 'background-color', 'border-top-color', 'border-left-color'])
  expect(hover, `${label}: hover`).toEqual({ color: r.accInk, 'background-color': r.accDim, 'border-top-color': r.accDim, 'border-left-color': r.accDim })
  await page.mouse.move(0, 0)

  const on = await style(picked, ['color', 'background-color', 'border-top-color', 'border-bottom-color', 'border-top-width'])
  expect(on, `${label}: picked`).toEqual({ color: r.accInk, 'background-color': r.acc, 'border-top-color': r.acc, 'border-bottom-color': r.acc, 'border-top-width': '2px' })
}

/** Neighbours on one line are 8px apart, and a wrapped line is 8px below the one above. */
async function readGaps(chips: Locator, label: string) {
  const boxes = await chips.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((b) => ({ x: b.x, y: b.y, right: b.right, bottom: b.bottom })))
  expect(boxes.length, label).toBeGreaterThan(1)
  for (let n = 1; n < boxes.length; n++) {
    const [a, b] = [boxes[n - 1]!, boxes[n]!]
    if (Math.abs(a.y - b.y) < 1) expect(b.x - a.right, `${label}: gap ${n}`).toBeCloseTo(8, 0)
    else expect(b.y - a.bottom, `${label}: row gap ${n}`).toBeCloseTo(8, 0)
  }
}

for (const skin of SKINS) {
  test(`${skin}: Settings' chips (Theme, Skin, Interface language) are 40px frame boxes, hover acc-dim, picked acc, 8px apart`, async ({ page }) => {
    await boot(page, skin)
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('.q-chip.choice').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const r = await roles(page)

    // The language chips (not the skin ones, whose own look 49.8 keeps: the picked skin is lit the same way).
    const lang = page.locator('.q-chip.choice:not(.skin)')
    const unpicked = lang.and(page.locator('[aria-pressed="false"]')).first()
    const picked = lang.and(page.locator('[aria-pressed="true"]')).first()
    await readChips(page, unpicked, picked, r, 'a Settings chip')
    await readGaps(lang.first().locator('xpath=..').locator('.q-chip'), 'Settings chips')
  })

  test(`${skin}: the Create layer's tabs are 40px frame boxes without a bottom border, 8px apart, the active one acc, hover acc-dim, no underline; its status chips are chips`, async ({ page }) => {
    await boot(page, skin)
    await page.goto('/')
    await page.getByRole('button', { name: q.home.newList }).click()
    await page.locator('.q-tile').first().click()
    await page.getByRole('tab', { name: q.createList.handTab }).click()
    await page.locator('.q-status-picker button').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const r = await roles(page)

    const tabs = page.locator('.q-tabs button')
    const active = tabs.and(page.locator('[aria-selected="true"]'))
    const inactive = tabs.and(page.locator('[aria-selected="false"]')).first()
    expect((await inactive.boundingBox())!.height, 'a tab is 40px high').toBe(40)
    const rest = await style(inactive, [...SIDES, 'color', 'background-color'])
    for (const side of ['top', 'right', 'left']) expect([rest[`border-${side}-width`], rest[`border-${side}-color`]], `inactive tab ${side}`).toEqual(['2px', r.frame])
    expect(rest['border-bottom-width'], 'no bottom border').toBe('0px')
    expect([rest.color, rest['background-color']], 'inactive tab at rest').toEqual([r.ink2, r.clear])
    expect(await style(page.locator('.q-tabs'), ['column-gap'])).toEqual({ 'column-gap': '8px' })

    await inactive.hover()
    expect(await style(inactive, ['color', 'background-color', 'border-top-color', 'box-shadow']), 'hover').toEqual({
      color: r.accInk,
      'background-color': r.accDim,
      'border-top-color': r.accDim,
      'box-shadow': 'none',
    })
    await page.mouse.move(0, 0)
    expect(await style(active, ['color', 'background-color', 'border-top-color']), 'the active tab').toEqual({ color: r.accInk, 'background-color': r.acc, 'border-top-color': r.acc })

    // The status chips of Add by hand (StatusPicker).
    const status = page.locator('.q-status-picker button')
    await status.first().click()
    await page.mouse.move(0, 0)
    await readChips(page, status.and(page.locator('[aria-pressed="false"]')).first(), status.and(page.locator('[aria-pressed="true"]')).first(), r, 'a status chip')
    await readGaps(status, 'status chips')
  })

  test(`${skin}: the filter popover's All and options are chips, 8px apart, no joined bar`, async ({ page }) => {
    const title = `Chips ${test.info().project.name} ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`
    const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'game' } })).json()
    const items = ['PS3', 'X360', 'PC', 'NDS', 'PSP', 'PS4', 'PS5', 'WII', 'SWITCH'].map((tag, n) => ({ title: `Game ${n}`, timeToConsumeMinutes: 60, group: 'Main', tags: [tag] }))
    await page.request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })
    try {
      await boot(page, skin)
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-item').first().waitFor()
      await page.locator('.q-filterbar').getByRole('button', { name: 'Platform: All' }).click()
      const pop = page.getByRole('dialog')
      await expect(pop.locator('.q-facet button').first()).toBeVisible()
      await expect(page.locator('.q-pop')).toHaveCSS('opacity', '1')
      await page.evaluate(() => document.fonts.ready)
      const r = await roles(page)

      const chips = pop.locator('.q-facet button')
      await pop.getByRole('button', { name: 'DS', exact: true }).click()
      await page.mouse.move(0, 0)
      await readChips(page, chips.and(page.locator('[aria-pressed="false"]')).first(), chips.and(page.locator('[aria-pressed="true"]')).first(), r, 'a facet chip')
      await readGaps(chips, 'facet chips')
    } finally {
      await page.request.delete(`/api/lists/${list.id}`)
    }
  })
}
