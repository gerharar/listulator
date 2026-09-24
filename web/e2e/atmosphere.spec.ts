import { expect, test } from '@playwright/test'

/**
 * Two of 10.8's own acceptance claims that jsdom cannot make (it evaluates
 * neither `position: fixed` nor a `@media` query against the render tree —
 * docs/DECISIONS.md, "Two 10.8 acceptance items are real-browser-only"),
 * carried into 10.9b per the plan.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your lists' })).toBeVisible({ timeout: 15_000 })
})

test('the atmosphere stays fixed when a layer body scrolls', async ({ page }) => {
  const atmosphere = page.locator('.q-atmo')
  const before = await atmosphere.boundingBox()
  if (!before) throw new Error('expected .q-atmo to have a layout box')

  // Home's own content may not overflow on a fresh dataset — inject filler
  // so `.q-layer-body` genuinely has something to scroll, without depending
  // on how many lists happen to exist.
  await page.evaluate(() => {
    const body = document.querySelector('.q-layer-body')
    const filler = document.createElement('div')
    filler.style.height = '3000px'
    filler.dataset['e2eFiller'] = 'atmosphere-scroll-test'
    body?.appendChild(filler)
    body?.scrollTo(0, 1500)
  })

  const after = await atmosphere.boundingBox()
  expect(after).toEqual(before)
})

test('reduced transparency drops the atmosphere to its plain treatment', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CDP-only emulation, no cross-engine API for this feature')

  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your lists' })).toBeVisible({ timeout: 15_000 })

  await expect(page.locator('.q-atmo .hatch')).toBeHidden()
  await expect(page.locator('.q-atmo .ring1')).toBeHidden()
  await expect(page.locator('.q-atmo .wash')).toBeVisible() // the plain treatment keeps the wash, per Atmosphere.css's `.plain`/media rule
})

// A WebKit `matchMedia(...).media` proxy for whether WKWebView recognizes
// `prefers-reduced-transparency` was tried and dropped: `MediaQueryList.media`
// echoes back whatever query text you pass it, syntactically-valid or not
// (`matchMedia('(totally-bogus-feature: reduce)').media` returns that same
// string, unconditionally, in both Chromium and WebKit — confirmed by
// direct probe, not assumed). It cannot distinguish "recognized" from
// "made up," so it isn't in this file. The WKWebView question stays
// genuinely open — docs/DECISIONS.md, 10.9b's manual-pass checklist.
