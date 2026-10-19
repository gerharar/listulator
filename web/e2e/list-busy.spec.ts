import { expect, test } from '@playwright/test'

/**
 * A whole-list rewrite holds the list (H-012, Phase 28.3): the toolbar, the rail and the rows are inert and aria-busy, refresh and More are disabled,
 * the body dims once the run has lasted 300 ms (a CSS delay, no timer), and X still closes the list. The Reset is slowed by the browser so the
 * hold can be looked at; the server does the real work. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(page: import('@playwright/test').Page, title: string) {
  const yaml = `title: ${title}\ncategory: movie\nitems:\n  - { title: Alpha, group: One }\n  - { title: Beta, group: Two }\n  - { title: Gamma, group: Two }\n`
  const created = await page.request.post('/api/lists/from-file', { data: { yaml } })
  expect(created.ok()).toBe(true)

  return (await created.json()).id as string
}

async function slowReset(page: import('@playwright/test').Page, ms: number) {
  await page.route('**/api/lists/*/reset', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    await route.continue()
  })
}

test('the toolbar, the rail and the rows are held while a Reset runs, the body dims after 300 ms, and it all comes back', async ({ page }) => {
  const title = `e2e list-busy ${Date.now()}`
  const id = await makeList(page, title)

  try {
    await slowReset(page, 1800)
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Reset List' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Reset', exact: true }).click()

    const toolbar = page.locator('.q-hold:not(.q-list-cols)')
    const body = page.locator('.q-list-cols')
    await expect(page.locator('.q-toast')).toHaveText('Resetting the list…')
    await expect(toolbar).toHaveAttribute('inert', '')
    await expect(toolbar).toHaveAttribute('aria-busy', 'true')
    await expect(body).toHaveAttribute('inert', '')
    await expect(page.getByRole('button', { name: 'More' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled()

    // The delay is the CSS rule's: 300 ms before the dim starts, then 160 ms to .45. A quick run never shows it.
    const timing = await body.evaluate((node) => {
      const style = getComputedStyle(node)
      return { delay: style.transitionDelay, duration: style.transitionDuration }
    })
    expect(timing).toEqual({ delay: '0.3s', duration: '0.16s' })
    await expect.poll(() => body.evaluate((node) => getComputedStyle(node).opacity)).toBe('0.45')
    await expect.poll(() => toolbar.evaluate((node) => getComputedStyle(node).opacity)).toBe('0.45')

    // Nothing in the rows reacts: a click on a row, or Space, does not tick it.
    const box = (await page.locator('.q-item').first().boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.click(box.x + 14, box.y + box.height / 2)
    await page.keyboard.press('Space')
    // The Reset has not reached the server yet (the browser holds it back): a tick that got through would be there already.
    const ticked = (await (await page.request.get(`/api/lists/${id}`)).json()).items as Array<{ consumedAt: string | null }>
    expect(ticked.every((entry) => entry.consumedAt === null)).toBe(true)

    await expect(page.locator('.q-toast')).toContainText('List was reset', { timeout: 10_000 })
    await expect(body).not.toHaveAttribute('inert', '')
    await expect(toolbar).not.toHaveAttribute('inert', '')
    await expect.poll(() => body.evaluate((node) => getComputedStyle(node).opacity)).toBe('1')
    await expect(page.getByRole('button', { name: 'More' })).toBeEnabled()
    const items = (await (await page.request.get(`/api/lists/${id}`)).json()).items as Array<{ consumedAt: string | null }>
    expect(items.every((entry) => entry.consumedAt === null)).toBe(true)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the list cannot be left while a Reset or its Undo runs, and after the Undo the list on screen is the one in the database (A11, 2026-10-18)', async ({ page }) => {
  const title = `e2e list-busy leave ${Date.now()}`
  const id = await makeList(page, title)

  try {
    const first = ((await (await page.request.get(`/api/lists/${id}`)).json()).items as Array<{ id: string; title: string }>).find((entry) => entry.title === 'Alpha')!
    await page.request.put(`/api/lists/${id}/items/${first.id}/consumed`, { data: { consumed: true } })
    await slowReset(page, 1200)
    await page.route('**/api/lists/*/items/restore-all', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      await route.continue()
    })
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Reset List' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(page.locator('.q-toast')).toHaveText('Resetting the list…')

    // Not by the X, not by Esc, not by the Home tab: the screen stays, and it is the one that gets the result.
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.locator('.q-layer-tab', { hasText: 'My Lists' }).click({ force: true })
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible()

    await expect(page.locator('.q-toast')).toContainText('List was reset', { timeout: 10_000 })
    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.q-toast')).toHaveText('Undoing the reset…')
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.locator('.q-layer-tab', { hasText: 'My Lists' }).click({ force: true })
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible()
    await expect(page.locator('.q-toast')).toContainText('Reset undone', { timeout: 10_000 })

    // The list on screen is the list in the database: a tick saves, with no "Couldn't save this change".
    await page.getByText('Beta', { exact: true }).click()
    await expect(page.getByText('Couldn\'t save this change')).toHaveCount(0)
    await expect.poll(async () => ((await (await page.request.get(`/api/lists/${id}`)).json()).items as Array<{ title: string; consumedAt: string | null }>).filter((entry) => entry.consumedAt !== null).map((entry) => entry.title).sort()).toEqual(['Alpha', 'Beta'])
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeEnabled()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the controls that wait say why when hovered, disabled as they are, in both engines (H-015)', async ({ page }) => {
  const title = `e2e list-busy tips ${Date.now()}`
  const id = await makeList(page, title)

  try {
    await slowReset(page, 9000)
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Reset List' }).click()
    await page.locator('.q-pop').getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(page.locator('.q-toast')).toHaveText('Resetting the list…')

    // A disabled button gets no mouse events in some engines: the tooltip has to come from the pointer entering it.
    for (const name of ['Close', 'More', 'Settings', 'About']) {
      const button = page.getByRole('button', { name, exact: true })
      await expect(button).toBeDisabled()
      await button.hover()
      await expect(page.locator('.q-tooltip')).toHaveText('Wait until the reset finishes', { timeout: 4000 })
      await page.mouse.move(2, 2)
      await expect(page.locator('.q-tooltip')).toHaveCount(0)
    }
    // Esc during the run changes nothing and says why once.
    await page.keyboard.press('Escape')
    await expect(page.locator('.q-live')).toHaveText('The list is being reset. Please wait until it finishes.')
    await expect(page.getByRole('heading', { name: new RegExp(`^${title}`) })).toBeVisible()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
