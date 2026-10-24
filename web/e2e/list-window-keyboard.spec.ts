import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Keyboard and focus on a list that draws only a window of its rows (Phase 25.3, BACKLOG BL-074), in a real browser: ↓ walks from the top to
 * row 3,000 without losing focus, a keyboard move at the edge of the window keeps the row in view and Undo restores it, a key held down moves one
 * item 150 places with focus and view following on every frame, and a list that
 * is opened again lands on the row it remembers. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, title: string, count: number) {
  const rows = Array.from({ length: count }, (_, n) => `  - { title: "Issue ${n}", minutes: 30 }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
}

const focusedTitle = (page: Page) => page.evaluate(() => document.activeElement?.closest('.q-item')?.textContent ?? null)

const inView = (page: Page, title: string) =>
  page.evaluate((text) => {
    const body = document.querySelector('.q-list-body') as HTMLElement
    const row = [...document.querySelectorAll('.q-item')].find((node) => node.textContent?.includes(text)) as HTMLElement | undefined
    if (!row) return false
    const box = row.getBoundingClientRect()
    const area = body.getBoundingClientRect()
    return box.top >= area.top - 1 && box.bottom <= area.bottom + 1
  }, title)

test('↓ walks from the top to row 3,000 of a 5,000-item list and focus is never lost', async ({ page }) => {
  test.setTimeout(180_000)
  const title = `e2e list-keys walk ${Date.now()}`
  const id = await makeList(page.request, title, 5000)

  try {
    await openList(page, title)
    await page.locator('.q-item').first().focus()

    for (let step = 1; step <= 3000; step += 1) {
      await page.keyboard.press('ArrowDown')
      if (step % 250 === 0) {
        expect(await focusedTitle(page), `after ${step} steps`).toContain(`Issue ${step}`)
      }
    }

    expect(await focusedTitle(page)).toContain('Issue 3000')
    expect(await inView(page, 'Issue 3000')).toBe(true)
    expect(await page.locator('.q-item').count()).toBeLessThan(120)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('Shift+↓ at the edge of the window keeps the row in view, and Undo puts it back', async ({ page }) => {
  const title = `e2e list-keys move ${Date.now()}`
  const id = await makeList(page.request, title, 2000)

  try {
    await openList(page, title)
    await page.locator('.q-item').first().focus()
    for (let step = 1; step <= 40; step += 1) await page.keyboard.press('ArrowDown')
    expect(await focusedTitle(page)).toContain('Issue 40')

    // The focused row sits at the bottom of what is drawn after a walk; pushing it down must not leave it behind.
    for (let step = 0; step < 6; step += 1) await page.keyboard.press('Shift+ArrowDown')
    expect(await focusedTitle(page)).toContain('Issue 40')
    expect(await inView(page, 'Issue 40')).toBe(true)

    await expect(page.locator('.q-toast')).toContainText('Item moved', { timeout: 5000 })
    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect(async () => {
      const detail = await (await page.request.get(`/api/lists/${id}`)).json()
      const order = detail.items.sort((a: { orderIndex: number }, b: { orderIndex: number }) => a.orderIndex - b.orderIndex).map((item: { title: string }) => item.title)
      expect(order.slice(38, 43)).toEqual(['Issue 38', 'Issue 39', 'Issue 40', 'Issue 41', 'Issue 42'])
    }).toPass()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('Shift+↓ held for 150 repeats: on every frame focus is on the moved row, which is drawn and in view (BL-110)', async ({ page }) => {
  const title = `e2e list-keys held ${Date.now()}`
  const id = await makeList(page.request, title, 2000)

  try {
    await openList(page, title)
    await page.locator('.q-item').first().focus()
    for (let step = 1; step <= 40; step += 1) await page.keyboard.press('ArrowDown')
    expect(await focusedTitle(page)).toContain('Issue 40')

    // Watched in the page, frame by frame: a key held down repeats faster than a frame, which no `press` loop shows.
    await page.evaluate(() => {
      const seen: string[] = []
      ;(window as unknown as { __seen: string[] }).__seen = seen
      const watch = () => {
        const onRow = document.activeElement?.closest('.q-item')
        const body = document.querySelector('.q-list-body') as HTMLElement
        const row = [...document.querySelectorAll('.q-item')].find((node) => node.textContent?.includes('Issue 4030m'))
        if (!onRow || !onRow.textContent?.includes('Issue 4030m')) seen.push('focus is not on the moved row')
        if (!row) seen.push('the moved row is not drawn')
        else {
          const box = row.getBoundingClientRect()
          const area = body.getBoundingClientRect()
          if (box.top < area.top - 1 || box.bottom > area.bottom + 1) seen.push('the moved row is out of view')
        }
        requestAnimationFrame(watch)
      }
      requestAnimationFrame(watch)
    })
    await page.keyboard.down('Shift')
    for (let step = 0; step < 150; step += 1) await page.keyboard.down('ArrowDown')
    await page.keyboard.up('ArrowDown')
    await page.keyboard.up('Shift')

    await expect(page.locator('.q-toast')).toContainText('Item moved', { timeout: 5000 })
    expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual([])
    expect(await focusedTitle(page)).toContain('Issue 40')
    expect(await inView(page, 'Issue 40')).toBe(true)
    await expect(async () => {
      const detail = await (await page.request.get(`/api/lists/${id}`)).json()
      const order = detail.items.sort((a: { orderIndex: number }, b: { orderIndex: number }) => a.orderIndex - b.orderIndex).map((item: { title: string }) => item.title)
      expect(order.indexOf('Issue 40')).toBe(190)
    }).toPass()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a view that starts a pixel into a folded group keeps its place when an item is ticked (BL-110)', async ({ page }) => {
  const title = `e2e list-keys folded ${Date.now()}`
  const rows = [
    ...Array.from({ length: 3 }, (_, n) => `  - { title: "Shut ${n}", minutes: 30, group: "Folded" }`),
    ...Array.from({ length: 300 }, (_, n) => `  - { title: "Open ${n}", minutes: 30, group: "Open" }`),
  ]
  const made = await page.request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  const id = (await made.json()).id as string

  try {
    await openList(page, title)
    await page.locator('.q-group', { hasText: 'Folded' }).locator('.q-chev').click()
    await expect(page.locator('.q-item', { hasText: 'Shut 0' })).toHaveCount(0)
    // The owner's Windows list: Volume 11 folded above the open Volume 12, the view a pixel inside the folded header. Any change to the rows
    // (a tick here) used to snap the view to that header, a line away from where the reader was, and a keyboard move's scroll with it.
    const scrollTop = () => page.evaluate(() => (document.querySelector('.q-list-body') as HTMLElement).scrollTop)
    await page.evaluate(() => { (document.querySelector('.q-list-body') as HTMLElement).scrollTop = 1 })
    await expect.poll(scrollTop).toBe(1)

    await page.locator('.q-item', { hasText: 'Open 2' }).first().getByRole('checkbox').click()
    await page.waitForTimeout(300)
    expect(await scrollTop()).toBe(1)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('after a jump to a group, moving its top item one step does not move the view (the browser\'s scroll anchoring is off, BL-110)', async ({ page }) => {
  const title = `e2e list-keys anchor ${Date.now()}`
  const group = (name: string, count: number) => Array.from({ length: count }, (_, n) => `  - { title: "${name} ${n}", minutes: 30, group: "${name}" }`)
  const rows = [...group('Alpha', 40), ...group('Beta', 40), ...group('Gamma', 300), ...group('Delta', 40)]
  const made = await page.request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  const id = (await made.json()).id as string

  try {
    await openList(page, title)
    await page.locator('.q-rail button', { hasText: 'Gamma' }).first().click()
    const scrollTop = () => page.evaluate(() => (document.querySelector('.q-list-body') as HTMLElement).scrollTop)
    await expect.poll(async () => scrollTop()).toBeGreaterThan(1000)
    await page.waitForTimeout(500)
    const before = await scrollTop()

    // The jump puts the group's header at the top of the view. Reordering rows under it made the browser's scroll anchoring move the view by a
    // line (the group above showed at the top), in Chromium and in WebKit; the screen keeps the reader's place itself.
    await page.locator('.q-item', { hasText: 'Gamma 0' }).first().focus()
    await page.keyboard.press('Shift+ArrowDown')
    await expect(page.locator('.q-toast')).toContainText('Item moved', { timeout: 5000 })
    await page.waitForTimeout(300)
    expect(await scrollTop()).toBe(before)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a long list that is opened again scrolls to the row it remembers, and that row is its tab stop', async ({ page }) => {
  const title = `e2e list-keys reopen ${Date.now()}`
  const id = await makeList(page.request, title, 3000)

  try {
    await openList(page, title)
    await page.locator('.q-item', { hasText: 'Issue 0' }).first().focus()
    for (let step = 1; step <= 1500; step += 1) await page.keyboard.press('ArrowDown')
    expect(await focusedTitle(page)).toContain('Issue 1500')

    await openList(page, title)

    await expect(page.getByText('Issue 1500', { exact: true })).toBeVisible()
    expect(await inView(page, 'Issue 1500')).toBe(true)
    await expect(page.locator('.q-item[tabindex="0"]')).toHaveCount(1)
    await expect(page.locator('.q-item[tabindex="0"]')).toContainText('Issue 1500')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('End goes to the last row of a 50,000-item list and Home back to the first: drawn, in view, with focus', async ({ page }) => {
  test.setTimeout(180_000)
  const title = `e2e list-keys ends ${Date.now()}`
  const id = await makeList(page.request, title, 50_000)

  try {
    await openList(page, title)
    await page.locator('.q-item').first().focus()

    await page.keyboard.press('End')
    await expect.poll(() => focusedTitle(page)).toContain('Issue 49999')
    expect(await inView(page, 'Issue 49999')).toBe(true)
    expect(await page.locator('.q-item').count()).toBeLessThan(120)
    await expect(page.locator('.q-live')).toHaveText('Bottom of the list')

    await page.keyboard.press('Home')
    await expect.poll(() => focusedTitle(page)).toContain('Issue 0')
    expect(await inView(page, 'Issue 0')).toBe(true)
    expect(await page.locator('.q-list-body').evaluate((node) => node.scrollTop)).toBe(0)
    await expect(page.locator('.q-live')).toHaveText('Top of the list')

    // From the middle of the list, too: the key does not depend on where the reader was.
    for (let step = 0; step < 30; step += 1) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('End')
    await expect.poll(() => focusedTitle(page)).toContain('Issue 49999')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

