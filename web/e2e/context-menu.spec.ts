import { expect, test } from '@playwright/test'

/**
 * The browser's own right-click menu (Back, Reload, Inspect Element…) is not the app's to show: it is
 * blocked on the app's buttons and content and left on for typing fields. A headless browser cannot show
 * the native menu, so this reads whether the app cancelled the event.
 */
test('a right-click on the app’s UI is cancelled, and on a typing field it is not', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await page.evaluate(() => {
    const seen: boolean[] = []
    ;(window as unknown as { __menus: boolean[] }).__menus = seen
    window.addEventListener('contextmenu', (event) => seen.push(event.defaultPrevented))
  })
  const menus = () => page.evaluate(() => (window as unknown as { __menus: boolean[] }).__menus)

  await page.getByRole('button', { name: 'Settings' }).click({ button: 'right' })
  await page.locator('.q-home-title').click({ button: 'right' })
  expect(await menus()).toEqual([true, true])

  await page.getByRole('button', { name: 'Settings' }).click()
  const field = page.getByRole('textbox').first()
  if (await field.count()) {
    await field.click({ button: 'right' })
    expect((await menus()).at(-1)).toBe(false)
  }
})
