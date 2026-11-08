import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The font role of the eX-Zed theme (Phase 48.1), in both engines: a stored `theme` preference puts `theme-exzed` on `<html>`, and body, a
 * button, a kicker, a number column and an input all take the ZX Spectrum family through the two font tokens, with no bold made up for a font
 * that has none. Without the preference nothing changes (Inter and JetBrains Mono) and the file is never fetched. Real write on the dev server,
 * removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string) {
  const rows = ['One', 'Two', 'Three'].map((name) => `  - { title: "Item ${name}", minutes: 30, group: "Season 1" }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

/** Opens the list with the stored preferences and returns what the page asked the network for, by the font file's name (Resource Timing does not list fonts). */
async function openList(page: Page, title: string, preferences: Record<string, string>) {
  const fontRequests: string[] = []
  page.on('request', (request) => {
    if (/ZXSpectrum/.test(request.url())) fontRequests.push(request.url())
  })
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', ...preferences }))
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
  return fontRequests
}

/** One element of each kind the plan names: the page, a button, a kicker, a number column, an input. */
const KINDS = { body: 'body', button: '.q-hide-done', kicker: '.q-kicker', number: '.q-mins', input: '.q-filter-input' } as const

const read = (page: Page) =>
  page.evaluate((kinds) => {
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
    const entries = Object.entries(kinds).map(([name, selector]) => [name, { family: style(selector).fontFamily, synthesis: style(selector).fontSynthesis }] as const)
    const image = document.createElement('img')
    document.body.append(image)
    const imageRendering = getComputedStyle(image).imageRendering
    image.remove()
    const root = getComputedStyle(document.documentElement)
    return {
      themed: document.documentElement.classList.contains('theme-exzed'),
      kinds: Object.fromEntries(entries),
      sans: root.getPropertyValue('--font-sans').trim(),
      mono: root.getPropertyValue('--font-mono').trim(),
      imageRendering,
    }
  }, KINDS)

test('with the stored theme exzed, every kind of text is ZX Spectrum, nothing is made bold, and the file loads', async ({ page }) => {
  const title = `e2e theme exzed ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    const fontRequests = await openList(page, title, { theme: 'exzed' })
    const seen = await read(page)

    expect(seen.themed).toBe(true)
    for (const [kind, { family, synthesis }] of Object.entries(seen.kinds)) {
      expect(family, `${kind}'s family`).toMatch(/^"?ZX Spectrum"?(,|$)/)
      expect(synthesis, `${kind}'s font-synthesis`).toBe('none')
    }
    expect(seen.sans).toMatch(/ZX Spectrum/)
    expect(seen.mono).toMatch(/ZX Spectrum/)
    expect(seen.imageRendering).toBe('pixelated')

    // The browser fetched the file because text uses it, and it is a font the engine accepts.
    const loaded = await page.evaluate(async () => (await document.fonts.load('16px "ZX Spectrum"')).map((face) => face.status))
    expect(loaded).toEqual(['loaded'])
    expect(fontRequests, 'the font file was requested').toHaveLength(1)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('with no stored theme, or one it does not know, the app is Quantum: no class, Inter and JetBrains Mono, and the font file is never fetched', async ({ page }) => {
  const title = `e2e theme quantum ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    const fontRequests = await openList(page, title, { theme: 'not-a-theme' })
    const seen = await read(page)

    expect(seen.themed).toBe(false)
    expect(seen.kinds.body!.family).toMatch(/Inter/)
    expect(seen.kinds.number!.family).toMatch(/JetBrains Mono/)
    expect(seen.kinds.input!.family).toMatch(/Inter/)
    expect(seen.sans).not.toMatch(/ZX Spectrum/)
    expect(seen.imageRendering).toBe('auto')
    expect(fontRequests).toEqual([])
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
