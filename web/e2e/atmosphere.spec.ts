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

test('the atmosphere stays fixed when the page scrolls', async ({ page }) => {
  // `.q-atmo` is App.tsx's direct child of QRoot, a sibling of the layer
  // stage — not nested inside `.q-layer-body`, so scrolling that nested
  // scroller (an earlier version of this test did) would never move it
  // either way, a false-positive fixed check. The *document* is what
  // `position: fixed` is actually relative to here.
  const atmosphere = page.locator('.q-atmo')
  const before = await atmosphere.boundingBox()
  if (!before) throw new Error('expected .q-atmo to have a layout box')

  await page.evaluate(() => {
    const filler = document.createElement('div')
    filler.style.height = '3000px'
    filler.dataset['e2eFiller'] = 'atmosphere-scroll-test'
    document.body.appendChild(filler)
    window.scrollTo(0, 1500)
  })
  // Prove the scroll actually happened — an assertion that always passes
  // regardless of whether the page moved is worth nothing.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  const after = await atmosphere.boundingBox()
  expect(after).toEqual(before)
  await expect(atmosphere).toHaveCSS('position', 'fixed')
})

test('reduced transparency drops the atmosphere to its plain treatment', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CDP-only emulation, no cross-engine API for this feature')

  // Control: visible before emulation, so "hidden" below is a real effect
  // of the media query, not a vacuous check against an already-hidden node.
  await expect(page.locator('.q-atmo .hatch')).toBeVisible()

  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your lists' })).toBeVisible({ timeout: 15_000 })

  // Confirm the emulation actually survived the reload before trusting
  // anything that follows from it.
  await expect
    .poll(() => page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches))
    .toBe(true)

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
