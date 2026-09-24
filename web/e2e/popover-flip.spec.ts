import { expect, test } from '@playwright/test'

/**
 * The real flip/shift decision `Popover.test.tsx` can't make under jsdom
 * (docs/DECISIONS.md, "jsdom + `@testing-library/react` added; floating-ui's
 * flip is untestable under jsdom") — asserted here against a real Chromium
 * layout instead, through the app's actual skin-button popover rather than a
 * purpose-built harness.
 */
test.beforeEach(async ({ page }) => {
  // Narrow enough that the top-right skin button has no room to open
  // 'right-start' (its default placement, `Popover.tsx`) — makes the flip
  // deterministic rather than viewport-size-dependent.
  await page.setViewportSize({ width: 800, height: 600 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Lists' })).toBeVisible({ timeout: 15_000 })
})

test('flips to the left when the anchor has no room to open right', async ({ page }) => {
  const anchor = page.getByRole('button', { name: 'Skin' })
  await anchor.click()

  const popover = page.getByRole('dialog')
  await expect(popover).toBeVisible()
  // `@floating-ui/react` positions asynchronously (autoUpdate) — the card
  // sits at (0, 0) for a frame before that resolves, which would satisfy
  // the geometry assertions below vacuously. The `.right` tail class only
  // appears once the resolved placement is actually 'left-*', so waiting
  // on it first (auto-retrying) guarantees positioning has actually landed.
  await expect(page.locator('.q-pop-tail.right')).toBeVisible()

  const anchorBox = await anchor.boundingBox()
  const popoverBox = await popover.boundingBox()
  if (!anchorBox || !popoverBox) throw new Error('expected both elements to have a layout box')

  // The flipped ('left-start') card sits to the anchor's left, not its right.
  expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(anchorBox.x + 1)
  // And it stays fully inside the viewport — the point of flip + shift together.
  expect(popoverBox.x).toBeGreaterThanOrEqual(0)
})

test('Esc closes the popover first, and leaves a pushed layer in place — a second Esc then pops it', async ({
  page,
}) => {
  // The "sharpest acceptance check" from task 10.9's own write-up
  // (tasks/plan.md), re-verified here under a real engine now that a real
  // popover exists to click through.
  await page.getByRole('button', { name: 'New List' }).click()
  await expect(page.getByRole('heading', { name: 'New list' })).toBeVisible()

  await page.getByRole('button', { name: 'Skin' }).click()
  const popover = page.getByRole('dialog')
  await expect(popover).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(page.getByRole('heading', { name: 'New list' })).toBeVisible()

  await page.keyboard.press('Escape')
  // The layer fully unmounts on pop (unlike Home, which never leaves the
  // stack) — and with nothing left covering Home, its veil is gone too.
  await expect(page.getByRole('heading', { name: 'New list' })).toBeHidden()
  await expect(page.locator('.q-veil')).toHaveCount(0)
})
