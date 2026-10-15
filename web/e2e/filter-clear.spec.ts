import { expect, test, type APIRequestContext } from '@playwright/test'
import { q } from './fixtures.js'

const filter = q.list.filter

/**
 * The ✕ that clears the list filter's text (H-008; owner, 2026-10-15), in a real browser: only while there is text, a real
 * press leaves the cursor in the field, the field and the bar do not move when it appears, and Hide Completed keeps its
 * state. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'movie' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: {
      source: 'manual',
      items: [
        { title: 'Crime Story', timeToConsumeMinutes: 107 },
        { title: 'Heat', timeToConsumeMinutes: 170 },
        { title: 'Ronin', timeToConsumeMinutes: 121 },
      ],
    },
  })
  const { items } = await (await request.get(`/api/lists/${list.id}`)).json()
  const heat = items.find((item: { title: string }) => item.title === 'Heat')
  await request.put(`/api/lists/${list.id}/items/${heat.id}/consumed`, { data: { consumed: true } })
  return list.id as string
}

test.use({ deviceScaleFactor: 2 })

test('a real press on the ✕ clears the text, keeps the cursor in the field and leaves Hide Completed alone', async ({ page }) => {
  const title = `e2e filter-clear press ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    const field = page.getByPlaceholder(filter.placeholder)
    const clear = page.getByRole('button', { name: filter.clearText })

    await expect(clear).toHaveCount(0)
    await page.getByRole('button', { name: filter.hideDone }).click()
    await expect(page.locator('.q-item', { hasText: 'Heat' })).toHaveCount(0)
    await field.fill('ron')
    await expect(page.locator('.q-item')).toHaveCount(1)

    await clear.click()

    await expect(field).toHaveValue('')
    await expect(field).toBeFocused()
    await expect(clear).toHaveCount(0)
    // The two not-done films are back; Heat stays hidden, Hide Completed is still on.
    await expect(page.locator('.q-item')).toHaveCount(2)
    await expect(page.getByRole('button', { name: filter.hideDone })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.q-live')).toHaveText(filter.cleared)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the field and the bar do not move when the ✕ appears: the room for it is always reserved', async ({ page }) => {
  const title = `e2e filter-clear layout ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    const field = page.getByPlaceholder(filter.placeholder)
    const wrapper = page.locator('.q-filter-field')
    const note = page.locator('.q-filter-note')
    const measure = async () => ({
      wrapper: await wrapper.boundingBox(),
      input: await field.boundingBox(),
      noteX: (await note.boundingBox())!.x,
      padding: await field.evaluate((input) => getComputedStyle(input).paddingRight),
    })

    // The list layer slides in (a CSS animation that scales it): measure once every animation has finished, or the layer's own motion
    // looks like the ✕ moving the bar. Waiting on the animations themselves, not on the box to stop changing: a box that has not
    // started to move yet looks the same twice.
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))))
    const without = await measure()
    await field.fill('ron')
    await expect(page.getByRole('button', { name: filter.clearText })).toBeVisible()
    const withText = await measure()

    expect(without.padding).toBe('30px')
    expect(withText.padding).toBe('30px')
    expect(withText.wrapper).toEqual(without.wrapper)
    expect(withText.input).toEqual(without.input)
    // The ✕ is inside the field, at its right edge.
    const button = (await page.getByRole('button', { name: filter.clearText }).boundingBox())!
    const box = without.input!
    expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width)
    expect(button.x).toBeGreaterThan(box.x + box.width - 40)
    // The note (which says "1 of 3 shown") sits where it did: nothing in the bar was pushed.
    expect(Math.abs(withText.noteX - without.noteX)).toBeLessThan(40)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the ✕ is as far from the last typed character as it is from the field’s right border, to within 2px in both engines (owner, 2026-10-15)', async ({ page }) => {
  const title = `e2e filter-clear gap ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    const field = page.getByPlaceholder(filter.placeholder)
    await field.click()
    // Typed, not filled: the field scrolls to the caret as it does for a person (WebKit leaves a little more room than Chromium).
    await page.keyboard.type('a long filter text that overflows the field foiH')
    await page.mouse.move(5, 5)
    const box = (await field.boundingBox())!
    // Poll: the layer is still sliding in when the text is typed.
    await expect
      .poll(async () => {
        const now = (await field.boundingBox())!
        return now.x === box.x && now.y === box.y
      })
      .toBe(true)
    const png = await page.screenshot({ clip: { x: box.x + box.width - 80, y: box.y, width: 80, height: box.height } })
    // The ink columns in the screenshot (2x): the last of the text, the ✕, and the border, read as runs of columns that
    // differ from the field's own colour (its most common one).
    const gaps = await page.evaluate(async (data) => {
      const img = new Image()
      img.src = `data:image/png;base64,${data}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const context = canvas.getContext('2d')!
      context.drawImage(img, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      const counts = new Map<string, number>()
      for (let i = 0; i < pixels.length; i += 4) {
        const key = `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      const background = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0].split(',').map(Number)
      const differs = (x: number, y: number) => {
        const i = (y * canvas.width + x) * 4
        return Math.abs(pixels[i]! - background[0]!) + Math.abs(pixels[i + 1]! - background[1]!) + Math.abs(pixels[i + 2]! - background[2]!) > 50
      }
      const runs: [number, number][] = []
      let start = -1
      for (let x = 0; x < canvas.width; x++) {
        let ink = false
        for (let y = 14; y < canvas.height - 14 && !ink; y++) ink = differs(x, y)
        if (ink && start < 0) start = x
        if ((!ink || x === canvas.width - 1) && start >= 0) {
          runs.push([start, ink ? x : x - 1])
          start = -1
        }
      }
      const [text, cross, border] = runs.slice(-3) as [[number, number], [number, number], [number, number]]
      return { left: (cross[0] - text[1] - 1) / 2, right: (border[0] - cross[1] - 1) / 2 }
    }, png.toString('base64'))

    expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(2)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('Esc with text clears it before the list closes, wherever the cursor is: popover first, then the text, then the list (owner, 2026-10-15)', async ({ page }) => {
  const title = `e2e filter-clear esc ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    const field = page.getByPlaceholder(filter.placeholder)
    await field.click()
    await page.keyboard.type('ron')
    await expect(page.locator('.q-item')).toHaveCount(1)

    // A popover opens (the cursor leaves the field): the first Esc closes it and nothing else.
    await page.getByRole('button', { name: q.list.more, exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(field).toHaveValue('ron')

    // The second clears the text, the list is still open.
    await page.keyboard.press('Escape')
    await expect(field).toHaveValue('')
    await expect(page.locator('.q-item')).toHaveCount(3)
    await expect(page.locator('.q-live')).toHaveText(filter.cleared)

    // Nothing left to undo: Esc does what it did, and the list closes back to Home.
    await page.keyboard.press('Escape')
    await expect(field).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('Esc in the field itself clears the text first too, and a layer over the list is closed before the list’s filter is touched', async ({ page }) => {
  const title = `e2e filter-clear layers ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    const field = page.getByPlaceholder(filter.placeholder)
    await field.click()
    await page.keyboard.type('ron')

    // Settings opens over the list: Esc closes Settings; the list's filter is not Settings' to clear.
    await page.getByRole('button', { name: q.appHeader.settings, exact: true }).click()
    await expect(page.getByRole('heading', { name: q.settings.title })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: q.settings.title })).toHaveCount(0)
    await expect(field).toHaveValue('ron')

    // Back on the list, with the cursor in the field: the first Esc clears the text and the cursor stays.
    await field.click()
    await page.keyboard.press('Escape')
    await expect(field).toHaveValue('')
    await expect(field).toBeFocused()
    await expect(page.locator('.q-item')).toHaveCount(3)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
