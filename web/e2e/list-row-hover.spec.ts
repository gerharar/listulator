import { expect, test } from '@playwright/test'

/**
 * BL-105 in a real browser, in both engines: the row under the mouse takes the hover tint (from the pointer's own events, `data-pointer`, not the
 * engine's `:hover`), and after an item is dragged across other rows none of them is left tinted: the Mac app's webview kept the rows the
 * pointer had passed over tinted until the mouse came back to them. Real writes on the dev server, removed in a `finally`.
 */
test('the row under the mouse is tinted, and an item dragged across rows leaves none tinted', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 })
  const title = `e2e row-hover ${Date.now()}`
  const rows = Array.from({ length: 60 }, (_, n) => `  - { title: "Garden ${n}", minutes: 30 }`).join('\n')
  const made = await page.request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows}\n` } })
  expect(made.status()).toBe(201)
  const id = (await made.json()).id as string
  const row = (name: string) => page.locator('.q-item', { has: page.getByText(name, { exact: true }) })
  const marked = () => page.locator('.q-item[data-pointer]')
  const background = (name: string) => row(name).evaluate((node) => getComputedStyle(node).backgroundColor)
  const hoverColour = () =>
    page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.background = 'var(--hover)'
      document.querySelector('.q-list-body')!.append(probe)
      const colour = getComputedStyle(probe).backgroundColor
      probe.remove()
      return colour
    })

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.locator('.q-item').first().waitFor()
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
    })

    // A resting mouse: the row under it is tinted in the hover colour, and only that one.
    const target = (await row('Garden 5').boundingBox())!
    await page.mouse.move(target.x + 300, target.y + target.height / 2)
    await expect(marked()).toHaveCount(1)
    await expect(row('Garden 5')).toHaveAttribute('data-pointer', '')
    expect(await background('Garden 5')).toBe(await hoverColour())

    // Carry another item down across several rows and let go.
    const handle = (await row('Garden 2').locator('.q-handle').boundingBox())!
    const x = handle.x + handle.width / 2
    const y = handle.y + handle.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 6, y + 30, { steps: 4 })
    await expect(marked()).toHaveCount(0)
    for (const name of ['Garden 4', 'Garden 5', 'Garden 6']) {
      const box = (await row(name).boundingBox())!
      await page.mouse.move(x + 200, box.y + box.height / 2, { steps: 3 })
      await expect(marked()).toHaveCount(0)
    }
    const last = (await row('Garden 6').boundingBox())!
    await page.mouse.move(x + 200, last.y + last.height - 6, { steps: 2 })
    await page.mouse.up()
    await expect(page.locator('.q-toast')).toContainText('Item moved')

    // Nothing the pointer passed over is left tinted, and the drop did not tint the row it is on.
    await expect(marked()).toHaveCount(0)
    for (const name of ['Garden 4', 'Garden 5', 'Garden 6']) expect(await background(name)).not.toBe(await hoverColour())

    // The next real move over a row tints that row, and only it; moving off the list clears it.
    const next = (await row('Garden 3').boundingBox())!
    await page.mouse.move(next.x + 300, next.y + next.height / 2)
    await expect(row('Garden 3')).toHaveAttribute('data-pointer', '')
    await expect(marked()).toHaveCount(1)
    await page.mouse.move(5, 5)
    await expect(marked()).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
