import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Alpha (Phase 48.3), computed in both engines and both themes: what fades in Quantum is drawn at full strength in eX-Zed (disabled and dragging
 * opacity 1, no veil on a covered layer), and Quantum keeps its exact values. This asserts only the properties the task
 * hooks: Quantum's colour tokens (`--hover`, `--line`, …) are themselves rgba until X-003 brings eX-Zed's solid colours, so "no alpha anywhere"
 * belongs to X-004's test. Real writes on the dev server, removed in a `finally`.
 */
const QUANTUM = { disabled: '0.45', dragging: '0.4', soft: '0.5' } as const
const EXZED = { disabled: '1', dragging: '1', soft: '1' } as const
const THEMES = { exzed: EXZED, quantum: QUANTUM } as const

async function makeList(request: APIRequestContext, title: string) {
  const rows = ['One', 'Two', 'Three'].map((name) => `  - { title: "Item ${name}", minutes: 30, group: "Season 1" }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

async function boot(page: Page, theme: string) {
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ theme, skin: 'dark-orange', reducedMotion: 'true' }))
  await page.route('**/api/library/untracked', (route) =>
    route.fulfill({ json: { entries: [{ externalRef: 'canonical:lists/book/lotr.yaml', title: 'The Lord of the Rings', category: 'book', itemCount: 3, status: 'complete' }], reachable: true } }),
  )
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
}

const style = (page: Page, selector: string, property: 'opacity' | 'filter' | 'backgroundColor') =>
  page.locator(selector).first().evaluate((el, name) => getComputedStyle(el)[name], property)

/** The alpha channel of a computed colour, whichever way the engine prints it. */
function alphaOf(color: string): number {
  if (color === 'transparent') return 0
  const slash = /\/\s*([\d.]+%?)\s*\)$/.exec(color)
  if (slash) return slash[1]!.endsWith('%') ? parseFloat(slash[1]!) / 100 : Number(slash[1])
  const rgba = /^rgba\(.*,\s*([\d.]+)\)$/.exec(color)
  return rgba ? Number(rgba[1]) : 1
}

for (const [theme, expected] of Object.entries(THEMES)) {
  test.describe(`with the theme ${theme}`, () => {
    test('a disabled button, chip and icon button, and the disabled-soft ends button and shelf chip', async ({ page }) => {
      const title = `e2e alpha disabled ${theme} ${Date.now()}`
      const id = await makeList(page.request, title)

      try {
        await boot(page, theme)
        await page.goto('/')
        await page.getByRole('button', { name: 'About', exact: true }).click()
        await expect.poll(() => style(page, '.q-about-update-block .q-btn.primary:disabled', 'opacity')).toBe(expected.disabled)
        // The rule, on elements the app only shows while it works (a chip while a list is being built, an icon button while one saves).
        await page.evaluate(() => {
          for (const html of ['<button class="q-chip" disabled>chip</button>', '<button class="q-icon-btn" disabled>x</button>']) document.body.insertAdjacentHTML('beforeend', html)
        })
        expect(await style(page, 'body > .q-chip:disabled', 'opacity')).toBe(expected.disabled)
        expect(await style(page, 'body > .q-icon-btn:disabled', 'opacity')).toBe(expected.disabled)
        expect(await style(page, 'body > .q-chip:disabled', 'filter')).toBe('none')

        await page.getByRole('button', { name: 'Close', exact: true }).click()
        await page.locator('.q-home-row', { hasText: title }).click()
        await page.locator('.q-item').first().waitFor()
        // A list starts scrolled to the top, so its upper "ends" half is the disabled one.
        await expect.poll(() => style(page, '.q-ends-half:disabled', 'opacity')).toBe(expected.soft)

        await page.goto('/')
        await page.getByRole('button', { name: 'Surprise Me' }).click()
        await page.locator('.q-sheet').waitFor()
        // A category with nothing in it (the stubbed library holds one book) is dimmed.
        await expect.poll(() => style(page, '.q-shelves .q-chip.none', 'opacity')).toBe(expected.soft)
      } finally {
        await page.request.delete(`/api/lists/${id}`)
      }
    })

    test('a row being dragged', async ({ page }) => {
      const title = `e2e alpha drag ${theme} ${Date.now()}`
      const id = await makeList(page.request, title)

      try {
        await boot(page, theme)
        await openList(page, title)
        const handle = page.locator('.q-item', { hasText: 'Item Two' }).locator('.q-handle')
        const from = (await handle.boundingBox())!
        const x = from.x + from.width / 2
        const y = from.y + from.height / 2
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x, y + 12, { steps: 4 })
        await page.mouse.move(x, y + 60, { steps: 6 })
        await page.locator('.q-item.dragging').waitFor()
        await expect.poll(() => style(page, '.q-item.dragging', 'opacity')).toBe(expected.dragging)
        await page.keyboard.press('Escape')
        await page.mouse.up()
      } finally {
        await page.request.delete(`/api/lists/${id}`)
      }
    })

    test('the covered layer’s veil', async ({ page }) => {
      const title = `e2e alpha veil ${theme} ${Date.now()}`
      const id = await makeList(page.request, title)

      try {
        await boot(page, theme)
        await openList(page, title)
        // Home is under the list: its veil is the covered layer’s.
        const alpha = alphaOf(await style(page, '.q-veil', 'backgroundColor'))
        if (theme === 'exzed') expect(alpha, 'no veil').toBe(0)
        else expect(alpha, 'Quantum’s 94% veil').toBeCloseTo(0.94, 2)
      } finally {
        await page.request.delete(`/api/lists/${id}`)
      }
    })

  })
}
