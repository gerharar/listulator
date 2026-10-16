import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

/**
 * Dragging across rows that are not drawn (Phase 25.5, BACKLOG BL-074), with real pointer events in a real browser: one item from the top of
 * a 5,000-item list to its 2,500th place, a whole group over many groups (every group shuts while it is carried), an item inside a
 * 3,000-item group, and the autoscroll with the pointer held at the edge. Each ends where it was dropped and Undo puts it back. Real
 * writes on the dev server, removed in a `finally`.
 */
const ITEM = 46
const GROUP = 47

async function makeList(request: APIRequestContext, title: string, rows: string[]) {
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

const loose = (count: number) => Array.from({ length: count }, (_, n) => `  - { title: "Issue ${n}", minutes: 30 }`)
const name = (k: number) => `Group ${String(k).padStart(2, '0')}`

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
  // The layer's entrance animation scales what `getBoundingClientRect` reports: measure only once it is over.
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
  })
}

/** The items by their place in the list, as the server holds them. */
async function titles(request: APIRequestContext, id: string) {
  const detail = await (await request.get(`/api/lists/${id}`)).json()
  return (detail.items as Array<{ title: string; orderIndex: number }>).sort((a, b) => a.orderIndex - b.orderIndex).map((item) => item.title)
}

async function groupOrder(request: APIRequestContext, id: string) {
  const detail = await (await request.get(`/api/lists/${id}`)).json()
  return (detail.groups as Array<{ name: string; orderIndex: number }>).sort((a, b) => a.orderIndex - b.orderIndex).map((entry) => entry.name)
}

const frames = (page: Page, count = 3) =>
  page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)))
        step(n)
      }),
    count,
  )

const rowOf = (page: Page, text: string): Locator =>
  page.locator('.q-item', { has: page.getByText(text, { exact: true }) })

/** A dropped row (or header) lands at the drop line: its top edge is within about a row of where the pointer was released. */
async function expectLandedAt(row: Locator, dropY: number) {
  const box = (await row.boundingBox())!
  expect(Math.abs(box.y - dropY), `the row's top (${box.y}) is far from the drop point (${dropY})`).toBeLessThanOrEqual(ITEM + 4)
}

const scrollTop = (page: Page) => page.evaluate(() => (document.querySelector('.q-list-body') as HTMLElement).scrollTop)

const setScroll = async (page: Page, top: number) => {
  await page.evaluate((y) => ((document.querySelector('.q-list-body') as HTMLElement).scrollTop = y), top)
  await frames(page, 4)
}

/** Presses on a handle and moves past the drag threshold: where it was pressed (`grab`) and where the pointer is left, a little below. */
async function pickUp(page: Page, handle: Locator) {
  const from = (await handle.boundingBox())!
  const x = from.x + from.width / 2
  const y = from.y + from.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 6, y + 30, { steps: 4 })
  return { x: x + 6, y: y + 30, grab: { x, y } }
}

/** The drop point: a row's lower or upper part, to the right of the handle. */
async function pointOn(row: Locator, part: 'upper' | 'lower') {
  const box = (await row.boundingBox())!
  return { x: box.x + 160, y: part === 'upper' ? box.y + 6 : box.y + box.height - 6 }
}

test('one item is dragged from the top of 5,000 to its 2,500th place, and Undo puts it back', async ({ page }) => {
  test.setTimeout(120_000)
  const title = `e2e list-drag item ${Date.now()}`
  const id = await makeList(page.request, title, loose(5000))

  try {
    await openList(page, title)
    const pointer = await pickUp(page, rowOf(page, 'Issue 0').locator('.q-handle'))

    // The reader scrolls while carrying (the wheel; the edge autoscroll does the same to `scrollTop`): the rows follow.
    await setScroll(page, 2495 * ITEM)
    const target = rowOf(page, 'Issue 2500')
    await expect(target).toBeVisible()
    const at = await pointOn(target, 'upper')
    await page.mouse.move(pointer.x, pointer.y + 10)
    await page.mouse.move(at.x, at.y, { steps: 6 })
    await expect(target.locator('.q-dropline')).toBeVisible()
    await page.mouse.up()

    await expect.poll(async () => (await titles(page.request, id)).indexOf('Issue 0')).toBe(2499)
    expect((await titles(page.request, id))[2500]).toBe('Issue 2500')
    // It is in the list where the pointer let go, not snapped to wherever it was picked up.
    await expectLandedAt(rowOf(page, 'Issue 0'), at.y)
    await expect(page.locator('.q-toast')).toBeVisible()

    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await titles(page.request, id)).indexOf('Issue 0')).toBe(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('an item moved a few rows inside a long list lands at the drop line, and the list does not jump', async ({ page }) => {
  test.setTimeout(120_000)
  const title = `e2e list-drag near ${Date.now()}`
  const id = await makeList(page.request, title, loose(300))

  try {
    await openList(page, title)
    // Issue 125 is 150px below the top of the view, so it and the row it goes to are clear of the edge bands (they scroll the list).
    await setScroll(page, 125 * ITEM - 150)
    const before = await scrollTop(page)
    const pointer = await pickUp(page, rowOf(page, 'Issue 125').locator('.q-handle'))
    // The wheel moves the list under a still pointer: the drop line moves to the row that is under it now.
    const lineRow = () => page.locator('.q-item:has(.q-dropline)').textContent()
    const first = await lineRow()
    await page.mouse.wheel(0, 92)
    await expect.poll(lineRow).not.toBe(first)
    await setScroll(page, 125 * ITEM - 150)

    const target = rowOf(page, 'Issue 128')
    await expect(target).toBeVisible()
    const at = await pointOn(target, 'lower')
    await page.mouse.move(pointer.x, pointer.y + 10)
    await page.mouse.move(at.x, at.y, { steps: 6 })
    await page.mouse.up()

    await expect.poll(async () => (await titles(page.request, id)).indexOf('Issue 125')).toBe(128)
    await expectLandedAt(rowOf(page, 'Issue 125'), at.y)
    expect(Math.abs((await scrollTop(page)) - before)).toBeLessThanOrEqual(ITEM)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

const BLOCK = GROUP + 100 * ITEM

const headerTop = (page: Page, title: string) =>
  page.evaluate((text) => {
    const header = [...document.querySelectorAll('.q-group')].find((node) => node.textContent?.includes(text)) as HTMLElement
    return header.getBoundingClientRect().top
  }, title)

test('a group is dragged over 25 open groups: only it folds, its header does not move, and it lands where it is dropped', async ({ page }) => {
  test.setTimeout(120_000)
  const title = `e2e list-drag block ${Date.now()}`
  const rows = Array.from({ length: 5000 }, (_, n) => `  - { title: "Issue ${n}", minutes: 30, group: "${name(Math.floor(n / 100))}" }`)
  const id = await makeList(page.request, title, rows)

  try {
    await openList(page, title)
    // Not at the very top of the view (the top edge scrolls the list while a block is held there): 150px below it.
    await setScroll(page, 20 * BLOCK - 150)
    const header = page.locator('.q-group', { hasText: name(20) })
    const before = await headerTop(page, name(20))
    const pointer = await pickUp(page, header.locator('.q-handle'))
    await frames(page, 4)

    // Group 20 folded (its rows are gone), nothing else did (the next group's rows are there), and its header has not moved.
    expect(Math.abs((await headerTop(page, name(20))) - before)).toBeLessThan(1)
    await expect(page.getByText('Issue 2000', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Issue 2100', { exact: true })).toBeVisible()
    await expect(page.locator('.q-group', { hasText: name(21) })).toBeVisible()
    expect(pointer.grab.y).toBeGreaterThan(0)

    // The reader scrolls on while carrying (the wheel; the edge autoscroll does the same to `scrollTop`) to Group 45: 25 open groups later.
    await setScroll(page, 45 * BLOCK - 100 * ITEM - 150)
    const target = page.locator('.q-group', { hasText: name(45) })
    await expect(target).toBeVisible()
    // Over the header of an open group: its upper half is the group's upper half (H-009), so this is "before Group 45" and the line is on
    // the group's top edge. (Group 20 is removed from the order first, so Group 45 is the 45th left and Group 20 takes its place.)
    const at = await pointOn(target, 'lower')
    await page.mouse.move(pointer.x, pointer.y + 10)
    await page.mouse.move(at.x, at.y, { steps: 8 })
    await expect(target.locator('.q-dropline:not(.after)')).toBeVisible()
    await page.mouse.up()

    await expect.poll(async () => (await groupOrder(page.request, id)).indexOf(name(20))).toBe(44)
    // The group opens again where it landed, at the drop line.
    await expect(page.locator('.q-group', { hasText: name(20) })).toBeVisible()
    await expectLandedAt(page.locator('.q-group', { hasText: name(20) }), at.y)
    await expect(page.locator('.q-item').first()).toBeVisible()

    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await groupOrder(page.request, id)).indexOf(name(20))).toBe(20)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a loose item over the upper half of a 3,000-row group lands before the whole group, though the rows under the pointer are inside it', async ({ page }) => {
  test.setTimeout(120_000)
  const title = `e2e list-drag before ${Date.now()}`
  const rows = [...Array.from({ length: 3000 }, (_, n) => `  - { title: "Vol ${n}", minutes: 30, group: "Big volume" }`), ...Array.from({ length: 2 }, (_, n) => `  - { title: "Loose ${n}", minutes: 30 }`)]
  const id = await makeList(page.request, title, rows)

  try {
    await openList(page, title)
    await setScroll(page, 10_000_000)
    const pointer = await pickUp(page, rowOf(page, 'Loose 1').locator('.q-handle'))
    // Nothing folds: the group is as open as it was.
    await setScroll(page, GROUP + 1000 * ITEM - 150)
    const target = rowOf(page, 'Vol 1000')
    await expect(target).toBeVisible()
    const at = await pointOn(target, 'upper')
    await page.mouse.move(pointer.x, pointer.y + 10)
    await page.mouse.move(at.x, at.y, { steps: 6 })

    // The target group: every drawn row has the hover ground and the header a mix of its own (7.5% ink into the card colour), two shades.
    await expect(page.locator('.q-group.is-target')).toHaveCount(1)
    const drawnRows = await page.locator('.q-item').count()
    await expect(page.locator('.q-item.is-hover')).toHaveCount(drawnRows - 1)
    const colours = await page.evaluate(() => {
      const probe = (value: string) => {
        const node = document.createElement('div')
        node.style.background = value
        document.querySelector('.q-list-body')!.append(node)
        const colour = getComputedStyle(node).backgroundColor
        node.remove()
        return colour
      }
      const bg = (selector: string) => getComputedStyle(document.querySelector(selector) as HTMLElement).backgroundColor
      return {
        header: bg('.q-group.is-target'),
        headerWanted: probe('color-mix(in srgb, var(--ink) 7.5%, var(--card))'),
        row: bg('.q-item.is-hover'),
        rowWanted: probe('var(--hover)'),
      }
    })
    expect(colours.header).toBe(colours.headerWanted)
    expect(colours.row).toBe(colours.rowWanted)
    expect(colours.header).not.toBe(colours.row)

    // The line is on the group's header (its top edge), not on the row under the pointer, and not at the bottom.
    await expect(page.locator('.q-group .q-dropline:not(.after)')).toHaveCount(1)
    await expect(page.locator('.q-item .q-dropline')).toHaveCount(0)
    await expect(page.locator('.q-list-block > .q-dropline.after')).toHaveCount(0)
    await page.mouse.up()

    await expect.poll(async () => (await titles(page.request, id))[0]).toBe('Loose 1')
    await expect(page.locator('.q-item.is-hover, .q-group.is-target')).toHaveCount(0)
    const order = await titles(page.request, id)
    expect(order.at(-1)).toBe('Loose 0')
    expect(order.slice(1, 3001).every((entry) => entry.startsWith('Vol '))).toBe(true)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a loose item over the lower half of a 3,000-row group lands after the whole group: the line is on the group\'s bottom edge', async ({ page }) => {
  test.setTimeout(120_000)
  const title = `e2e list-drag after ${Date.now()}`
  const rows = [...Array.from({ length: 2 }, (_, n) => `  - { title: "Loose ${n}", minutes: 30 }`), ...Array.from({ length: 3000 }, (_, n) => `  - { title: "Vol ${n}", minutes: 30, group: "Big volume" }`)]
  const id = await makeList(page.request, title, rows)

  try {
    await openList(page, title)
    const pointer = await pickUp(page, rowOf(page, 'Loose 0').locator('.q-handle'))
    await setScroll(page, 2 * ITEM + GROUP + 2000 * ITEM - 150)
    const target = rowOf(page, 'Vol 2000')
    await expect(target).toBeVisible()
    const at = await pointOn(target, 'upper')
    await page.mouse.move(pointer.x, pointer.y + 10)
    await page.mouse.move(at.x, at.y, { steps: 6 })

    // The group's bottom edge is far below the view, in rows that are not drawn: the line is there all the same, and no row or header has one.
    await expect(page.locator('.q-list-block > .q-dropline.after')).toHaveCount(1)
    await expect(page.locator('.q-group .q-dropline')).toHaveCount(0)
    await expect(page.locator('.q-item .q-dropline')).toHaveCount(0)
    await page.mouse.up()

    await expect.poll(async () => (await titles(page.request, id)).at(-1)).toBe('Loose 0')
    expect((await titles(page.request, id))[0]).toBe('Loose 1')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a group whose header is stuck at the top of the view can be picked up with a real pointer, and Esc puts everything back', async ({ page }) => {
  test.setTimeout(120_000)
  const title = `e2e list-drag stuck ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const rows = Array.from({ length: 1000 }, (_, n) => `  - { title: "Issue ${n}", minutes: 30, group: "${name(Math.floor(n / 100))}" }`)
  const id = await makeList(page.request, title, rows)

  try {
    await openList(page, title)
    await setScroll(page, 3 * BLOCK + GROUP + 40 * ITEM)
    const header = page.locator('.q-group', { hasText: name(3) })
    expect(Math.abs(await headerTop(page, name(3)) - (await page.locator('.q-list-body').evaluate((node) => node.getBoundingClientRect().top)))).toBeLessThan(1)

    const from = (await header.locator('.q-handle').boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 8, from.y + 140, { steps: 6 })

    // A real drag: the group is dimmed, its rows have gone with it, and the drag is still on a moment later (nothing cancelled it).
    await expect(header).toHaveClass(/dragging/)
    await page.waitForTimeout(300)
    await expect(header).toHaveClass(/dragging/)
    await expect(page.getByText('Issue 340', { exact: true })).toHaveCount(0)
    await expect(page.locator('.q-group', { hasText: name(4) })).toBeVisible()

    await page.keyboard.press('Escape')
    await page.mouse.up()
    // The group opens again with its header at the top of the view, where the fold left it (the rows the reader had scrolled past stay above).
    await expect(page.getByText('Issue 300', { exact: true })).toBeVisible()
    await expect(header).not.toHaveClass(/dragging/)
    expect((await groupOrder(page.request, id)).indexOf(name(3))).toBe(3)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('an item is dragged inside a 3,000-item group to its 1,500th place', async ({ page }) => {
  test.setTimeout(120_000)
  const title = `e2e list-drag member ${Date.now()}`
  const rows = [...loose(3), ...Array.from({ length: 3000 }, (_, n) => `  - { title: "Vol ${n}", minutes: 30, group: "Big volume" }`)]
  const id = await makeList(page.request, title, rows)

  try {
    await openList(page, title)
    const pointer = await pickUp(page, rowOf(page, 'Vol 0').locator('.q-handle'))
    await setScroll(page, 3 * ITEM + GROUP + 1495 * ITEM)
    const target = rowOf(page, 'Vol 1500')
    await expect(target).toBeVisible()
    const at = await pointOn(target, 'upper')
    await page.mouse.move(pointer.x, pointer.y + 10)
    await page.mouse.move(at.x, at.y, { steps: 6 })
    await expect(target.locator('.q-dropline')).toBeVisible()
    await page.mouse.up()

    await expect.poll(async () => (await titles(page.request, id)).indexOf('Vol 0')).toBe(3 + 1499)
    await page.locator('.q-toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await titles(page.request, id)).indexOf('Vol 0')).toBe(3)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('holding the pointer at the bottom edge scrolls on, faster the longer it is held, and a row is under the pointer on every frame', async ({ page }) => {
  test.setTimeout(120_000)
  const title = `e2e list-drag edge ${Date.now()}`
  const id = await makeList(page.request, title, loose(5000))

  try {
    await openList(page, title)
    await pickUp(page, rowOf(page, 'Issue 0').locator('.q-handle'))
    const body = (await page.locator('.q-list-body').boundingBox())!
    const x = body.x + 300
    const y = body.y + body.height - 10
    await page.mouse.move(x, y, { steps: 6 })

    // Counts the frames in which no row (and no spacer's absence of one) is under the held pointer.
    await page.evaluate(
      ([px, py]) => {
        const w = window as unknown as { __miss: number; __run: boolean }
        w.__miss = 0
        w.__run = true
        const tick = () => {
          if (!document.elementFromPoint(px!, py!)?.closest('[data-drag-key]')) w.__miss += 1
          if (w.__run) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      },
      [x, y],
    )
    await page.waitForTimeout(1000)
    const early = await scrollTop(page)
    await page.waitForTimeout(3000)
    const late = await scrollTop(page)
    const miss = await page.evaluate(() => {
      const w = window as unknown as { __miss: number; __run: boolean }
      w.__run = false
      return w.__miss
    })

    expect(early).toBeGreaterThan(500)
    // The second three seconds cover more than three times the first second: it speeds up while held.
    expect(late - early).toBeGreaterThan(3 * early)
    expect(miss).toBeLessThanOrEqual(2)

    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect((await titles(page.request, id))[0]).toBe('Issue 0')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
