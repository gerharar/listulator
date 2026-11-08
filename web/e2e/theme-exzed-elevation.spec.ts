import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * eX-Zed's elevation (Phase 48.2, the sheet as design's answer 5 has it), computed in both engines: with the theme on, a full layer is three 4px rings
 * outside its border (paper, frame, paper); everything that opens over a layer (popovers, menus, the dropdown list, the platform panel, the toast and
 * the helper sheet) is one 4px paper ring; the tooltip and a covered layer have no shadow, and nothing on a settled screen has a blurred shadow. The ring colours are role names (`--paper`,
 * `--frame`) with Quantum fallbacks until X-003 brings eX-Zed's skins. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string, category = 'movie') {
  const rows = ['One', 'Two', 'Three'].map((name) => `  - { title: "Item ${name}", minutes: 30, group: "Season 1" }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: ${category}\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

async function boot(page: Page, theme: string) {
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ theme, skin: 'dark-orange', reducedMotion: 'true' }))
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
}

interface Shadow {
  x: number
  y: number
  blur: number
  spread: number
  color: string
  inset: boolean
}

/** A computed `box-shadow`, split on its top-level commas: the engines print `rgb(…) 0px 0px 0px 4px`, the colour first. */
function parse(computed: string): Shadow[] {
  if (computed === 'none') return []
  return computed.split(/,\s*(?![^(]*\))/).map((entry) => {
    const [x = 0, y = 0, blur = 0, spread = 0] = [...entry.matchAll(/(-?[\d.]+)px/g)].map((match) => Number(match[1]))
    return { x, y, blur, spread, color: entry.replace(/(-?[\d.]+)px/g, '').replace('inset', '').replace(/\s+/g, ' ').trim(), inset: entry.includes('inset') }
  })
}

const shadowOf = async (page: Page, selector: string) => parse(await page.locator(selector).first().evaluate((el) => getComputedStyle(el).boxShadow))

/** Every shadow drawn by any element on the page right now, with where it is: the sweep for a blur. */
const allShadows = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('*'))
      .map((el) => ({ where: `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(' ').join('.')}`, shadow: getComputedStyle(el).boxShadow }))
      .filter((entry) => entry.shadow !== 'none'),
  )

const rings = (shadows: Shadow[]) => shadows.map((shadow) => shadow.spread)

async function noBlur(page: Page) {
  const blurred = (await allShadows(page)).filter((entry) => parse(entry.shadow).some((shadow) => shadow.blur > 0))
  expect(blurred, 'elements with a blurred shadow').toEqual([])
}

test.describe('with the theme exzed', () => {
  test('a layer is three rings (paper, frame, paper) at 4, 8 and 12px with no blur, and a covered layer has none', async ({ page }) => {
    const title = `e2e exzed layer ${Date.now()}`
    const id = await makeList(page.request, title)

    try {
      await boot(page, 'exzed')
      await openList(page, title)

      const layer = await shadowOf(page, '.q-layer:not(.covered)')
      expect(rings(layer)).toEqual([4, 8, 12])
      for (const ring of layer) expect({ x: ring.x, y: ring.y, blur: ring.blur, inset: ring.inset }).toEqual({ x: 0, y: 0, blur: 0, inset: false })
      expect(layer[0]!.color, 'the outer and inner rings are the same paper').toBe(layer[2]!.color)
      expect(layer[1]!.color, 'the middle ring is the frame').not.toBe(layer[0]!.color)
      expect(await shadowOf(page, '.q-layer.covered')).toEqual([])
      await noBlur(page)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })

  test('the rings take the colours the theme’s skin gives its roles, `--paper` and `--frame`', async ({ page }) => {
    const title = `e2e exzed roles ${Date.now()}`
    const id = await makeList(page.request, title)

    try {
      await boot(page, 'exzed')
      await openList(page, title)
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--paper', 'rgb(1, 2, 3)')
        document.documentElement.style.setProperty('--frame', 'rgb(4, 5, 6)')
      })

      const layer = await shadowOf(page, '.q-layer:not(.covered)')
      expect(layer.map((ring) => ring.color)).toEqual(['rgb(1, 2, 3)', 'rgb(4, 5, 6)', 'rgb(1, 2, 3)'])
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })

  test('the ⋯ menu, the dropdown list and the platform panel are one 4px ring', async ({ page }) => {
    const title = `e2e exzed pops ${Date.now()}`
    const id = await makeList(page.request, title)
    const gamesTitle = `e2e exzed platforms ${Date.now()}`
    const games = await makeList(page.request, gamesTitle, 'game')

    try {
      await boot(page, 'exzed')
      await openList(page, title)
      await page.getByRole('button', { name: 'More', exact: true }).click()
      await page.locator('.q-pop').first().waitFor()
      expect(rings(await shadowOf(page, '.q-pop'))).toEqual([4])
      expect((await shadowOf(page, '.q-pop'))[0]!.blur).toBe(0)
      await noBlur(page)
      await page.keyboard.press('Escape')

      await page.locator('.q-add-item').getByLabel('Group').click()
      await page.locator('.q-combo-list').waitFor()
      expect(rings(await shadowOf(page, '.q-combo-list'))).toEqual([4])

      await page.goto('/')
      await page.locator('.q-home-row', { hasText: gamesTitle }).click()
      await page.locator('.q-item').first().waitFor()
      // The panel is the side panel of an item's Edit window (the add row's picker is an ordinary popover).
      await page.getByRole('button', { name: 'Edit Item One' }).click()
      await page.locator('.q-platfield').click()
      await page.locator('.q-platpanel').waitFor()
      expect(rings(await shadowOf(page, '.q-platpanel'))).toEqual([4])
      await noBlur(page)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
      await page.request.delete(`/api/lists/${games}`)
    }
  })

  test('the toast is one 4px ring, and the tooltip has no shadow at all', async ({ page }) => {
    const title = `e2e exzed toast ${Date.now()}`
    const id = await makeList(page.request, title)

    try {
      await boot(page, 'exzed')
      await openList(page, title)
      await page.locator('.q-item', { hasText: 'Item One' }).first().focus()
      await page.keyboard.press('Shift+ArrowDown')
      await page.locator('.q-toast').waitFor()
      expect(rings(await shadowOf(page, '.q-toast'))).toEqual([4])
      await noBlur(page)

      await page.getByRole('button', { name: 'Settings' }).hover()
      await page.locator('.q-tooltip').waitFor()
      expect(await shadowOf(page, '.q-tooltip')).toEqual([])
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })

  test('the helper sheet is the single frame, like everything that opens over a layer: one ring, no blur', async ({ page }) => {
    await boot(page, 'exzed')
    await page.goto('/')
    await page.getByRole('button', { name: 'Surprise Me' }).click()
    await page.locator('.q-sheet').waitFor()

    expect(rings(await shadowOf(page, '.q-sheet'))).toEqual([4])
    await noBlur(page)
  })
})

test('without the theme, Quantum keeps its blurred shadows: a layer, a menu and a tooltip', async ({ page }) => {
  const title = `e2e quantum shadows ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await boot(page, 'quantum')
    await openList(page, title)
    expect((await shadowOf(page, '.q-layer:not(.covered)')).map((shadow) => shadow.blur)).toEqual([48, 10])
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.locator('.q-pop').first().waitFor()
    expect((await shadowOf(page, '.q-pop'))[0]!.blur).toBe(30)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Settings' }).hover()
    await page.locator('.q-tooltip').waitFor()
    expect((await shadowOf(page, '.q-tooltip'))[0]!.blur).toBe(14)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
