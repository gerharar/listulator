import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Where a long list scrolls to, and that the right rows are there at once (Phase 25.4, BACKLOG BL-074), in a real browser: the jump rail, a
 * group folded deep inside, Collapse / Expand all, a filter, and a row added to a far group. 5,000 items in 50 groups of 100. A probe runs
 * on every frame and counts the frames in which the middle of the list shows no row, so "no flash of the wrong rows" is measured, not
 * assumed. Real writes on the dev server, removed in a `finally`.
 */
const ITEM = 46
const GROUP = 47
const BLOCK = GROUP + 100 * ITEM
const name = (k: number) => `Group ${String(k).padStart(2, '0')}`

async function makeList(request: APIRequestContext, title: string) {
  const rows = Array.from({ length: 5000 }, (_, n) => `  - { title: "Issue ${n}", minutes: 30, group: "${name(Math.floor(n / 100))}" }`)
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
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

const scrollTo = async (page: Page, top: number) => {
  await page.evaluate((y) => ((document.querySelector('.q-list-body') as HTMLElement).scrollTop = y), top)
  await frames(page)
}

/**
 * Counts the frames whose middle shows nothing of the list (a spacer, or a gap), from the next click or key press until `blankFrames` is
 * read: what was already on screen before the action (a list narrowed to one row has an empty middle by right) is not counted.
 */
const startProbe = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __blank: number; __probe: boolean }
    w.__blank = 0
    w.__probe = true
    for (const type of ['click', 'keydown']) document.addEventListener(type, () => (w.__blank = 0), { capture: true, once: true })
    const tick = () => {
      const body = document.querySelector('.q-list-body') as HTMLElement
      const box = body.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      if (!hit?.closest('.q-item, .q-group')) w.__blank += 1
      if (w.__probe) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

const blankFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __blank: number; __probe: boolean }
    w.__probe = false
    return w.__blank
  })

/** The ▼ of a group's header: a click on the name starts renaming, so folding is clicked at the chevron. */
const chevron = (page: Page, title: string) => page.locator('.q-group', { hasText: title }).locator('.q-chev')

/** How far below the top of the scroller a header's top edge is: 0 when it is at the top (stuck, or in place). */
const headerOffset = (page: Page, title: string) =>
  page.evaluate((text) => {
    const header = [...document.querySelectorAll('.q-group')].find((node) => node.textContent?.includes(text)) as HTMLElement | undefined
    if (!header) return null
    return Math.round(header.getBoundingClientRect().top - (document.querySelector('.q-list-body') as HTMLElement).getBoundingClientRect().top)
  }, title)

test('the jump rail, folding, Collapse / Expand all and a filter keep the right rows in view, frame after frame', async ({ page }) => {
  test.setTimeout(180_000)
  const title = `e2e list-place ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await openList(page, title)

    await test.step('a jump to a far group puts its header at the top, rows drawn on every frame', async () => {
      await startProbe(page)
      await page.locator('.q-rail button', { hasText: name(30) }).click()
      await frames(page, 4)
      expect(await blankFrames(page)).toBe(0)
      expect(await headerOffset(page, name(30))).toBe(0)
      await expect(page.getByText('Issue 3000', { exact: true })).toBeVisible()
    })

    await test.step('folding the group the reader is deep inside leaves its header at the top', async () => {
      await scrollTo(page, 3 * BLOCK + GROUP + 50 * ITEM)
      await startProbe(page)
      await chevron(page, name(3)).click()
      await frames(page, 4)
      expect(await blankFrames(page)).toBe(0)
      expect(await headerOffset(page, name(3))).toBe(0)
      await expect(page.locator('.q-group', { hasText: name(4) })).toBeVisible()
    })

    await test.step('Collapse all, then Expand all, from the middle of the list: the same group stays at the top', async () => {
      await chevron(page, name(3)).click()
      await scrollTo(page, 20 * BLOCK + GROUP + 30 * ITEM)
      await startProbe(page)
      await page.locator('.q-fold').click()
      await frames(page, 4)
      expect(await blankFrames(page)).toBe(0)
      expect(await headerOffset(page, name(20))).toBe(0)

      await page.locator('.q-fold').click()
      await frames(page, 4)
      expect(await blankFrames(page)).toBe(0)
      expect(await headerOffset(page, name(20))).toBe(0)
      await expect(page.getByText('Issue 2000', { exact: true })).toBeVisible()
    })

    await test.step('a filter that leaves one row shows it, and clearing the filter returns to its group', async () => {
      await scrollTo(page, 10 * BLOCK + GROUP + 10 * ITEM)
      // One row is not a screenful: the middle of the list is empty by right, so the probe runs only once the list is long again.
      await page.getByLabel('Filter items').fill('Issue 4999')
      await frames(page, 4)
      await expect(page.getByText('Issue 4999', { exact: true })).toBeVisible()

      await startProbe(page)
      await page.getByRole('button', { name: 'Clear filter' }).click()
      await frames(page, 4)
      expect(await blankFrames(page)).toBe(0)
      expect(await headerOffset(page, name(49))).toBe(0)
    })
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('an item added to a far group is scrolled to, drawn and pulsing', async ({ page }) => {
  test.setTimeout(120_000)
  const title = `e2e list-place add ${Date.now()}`
  const id = await makeList(page.request, title)

  try {
    await openList(page, title)
    const form = page.locator('.q-add-item')
    // The Group list closes on the next click, so the group goes first and Enter in the title is what adds.
    await form.getByLabel('Group').fill(name(40))
    await form.getByLabel('Title').fill('Newcomer')
    // Filling brought the Add row into view by the browser's own scroll; let the window catch up with that before the action under test.
    await frames(page, 4)
    await startProbe(page)
    await form.getByLabel('Title').press('Enter')

    const added = page.locator('.q-item', { hasText: 'Newcomer' })
    await expect(added).toBeVisible()
    await expect(added).toHaveClass(/pulse/)
    await frames(page, 4)
    expect(await blankFrames(page)).toBe(0)
    const inView = await added.evaluate((node) => {
      const area = (document.querySelector('.q-list-body') as HTMLElement).getBoundingClientRect()
      const box = node.getBoundingClientRect()
      return box.top >= area.top && box.bottom <= area.bottom
    })
    expect(inView).toBe(true)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a short list is opened again at the row it remembers, like a long one', async ({ page }) => {
  const title = `e2e list-place short ${Date.now()}`
  const rows = Array.from({ length: 150 }, (_, n) => `  - { title: "Issue ${n}", minutes: 30 }`)
  const made = await page.request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  const id = (await made.json()).id as string

  try {
    await openList(page, title)
    await page.locator('.q-item', { hasText: 'Issue 100' }).focus()
    await page.waitForTimeout(200)

    await openList(page, title)
    await frames(page, 2)
    const inView = await page.locator('.q-item', { hasText: 'Issue 100' }).evaluate((node) => {
      const area = (document.querySelector('.q-list-body') as HTMLElement).getBoundingClientRect()
      const box = node.getBoundingClientRect()
      return box.top >= area.top && box.bottom <= area.bottom
    })
    expect(inView).toBe(true)
    expect(await page.locator('.q-item').count()).toBe(150)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})
