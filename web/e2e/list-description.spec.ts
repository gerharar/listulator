import { expect, test } from '@playwright/test'

/**
 * A list's description in the header (owner, 2026-10-25): it is not held to a narrow column. A long one runs the width the header has, up to the
 * list's action buttons, so it takes fewer lines.
 */
const LONG = Array.from({ length: 40 }, (_, n) => `word${n}`).join(' ')

test('a long description runs the width of the header, up to the buttons at its right', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const title = `e2e description ${Date.now()}`
  const made = await page.request.post('/api/lists/from-file', {
    data: { yaml: `title: ${title}\ncategory: movie\ndescription: ${LONG}\nitems:\n  - { title: "One", minutes: 30 }\n  - { title: "Two", minutes: 30 }\n` },
  })
  expect(made.status()).toBe(201)
  const id = (await made.json()).id as string

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.locator('.q-item').first().waitFor()
    await page.waitForFunction(() => document.getAnimations().length === 0)

    const read = await page.evaluate(() => {
      const description = document.querySelector('.q-list-description')!.getBoundingClientRect()
      const actions = document.querySelector('.q-list-actions')!.getBoundingClientRect()
      const head = document.querySelector('.q-list-top')!.getBoundingClientRect()

      return { width: description.width, gapToActions: actions.left - description.right, headWidth: head.width }
    })

    // Wider than the old 640px column, and ending at the buttons (their 16px gap), not short of them.
    expect(read.width).toBeGreaterThan(700)
    expect(read.gapToActions).toBeLessThanOrEqual(20)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the Create layer’s category description runs the width of its header, up to the close button', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/media-types', async (route) => {
    const response = await route.fetch()
    const types = (await response.json()) as Array<{ key: string; description?: string }>
    for (const type of types) if (type.key === 'movie') type.description = LONG

    await route.fulfill({ json: types })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.locator('.q-tile', { hasText: 'Movies' }).click()
  await page.locator('.q-create-sub').waitFor()
  await page.waitForFunction(() => document.getAnimations().length === 0)

  const read = await page.evaluate(() => {
    const sub = document.querySelector('.q-create-sub')!.getBoundingClientRect()
    const close = document.querySelector('.q-create-top .q-icon-btn')!.getBoundingClientRect()

    return { width: sub.width, gapToClose: close.left - sub.right }
  })

  expect(read.width).toBeGreaterThan(700)
  expect(read.gapToClose).toBeLessThanOrEqual(20)
})
