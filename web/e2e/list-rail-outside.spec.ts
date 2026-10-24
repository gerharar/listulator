import { chromium, expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The jump rail outside the card (H-019, task 32.1), measured in a real browser: with the room beside the card the rail leaves it and
 * is laid over the card's edge, starting level with the inside rail (its 2px top border over the toolbar's line), ending at the card's
 * bottom, and the card and the list body are as wide as without it; in a window without the room it stays inside; the switch happens on
 * resize. Real writes on the dev server, removed in a `finally`.
 */
async function makeGroupedList(request: APIRequestContext, title: string) {
  const rows = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map(
    (name, n) => `  - { title: "Item ${name}", minutes: 30, group: "${n < 3 ? 'Season 1' : 'Season 2'}" }`,
  )
  const made = await request.post('/api/lists/from-file', { data: { yaml: `title: ${title}\ncategory: movie\nitems:\n${rows.join('\n')}\n` } })
  expect(made.status()).toBe(201)
  return (await made.json()).id as string
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-item').first().waitFor()
  await settled(page)
}

/** The layer drums in over 380ms and moves over 300ms: measure after that, never during it. */
const settled = (page: Page) => page.waitForFunction(() => document.getAnimations().length === 0)

interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
}

/** Every box is read in one evaluation, so they all belong to the same frame. */
const boxes = (page: Page) =>
  page.evaluate(() => {
    const read = (node: Element) => {
      const r = node.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width }
    }
    const find = (selector: string) => document.querySelector(selector)!
    // The card is the list's own layer: Home's is under it in the stack.
    return { rail: read(find('.q-rail')), cols: read(find('.q-list-cols')), body: read(find('.q-list-body')), card: read(find('.q-list').closest('.q-layer')!) } satisfies Record<string, Box>
  })

for (const width of [1728, 1729, 1920, 1921]) {
  test(`at ${width}px the rail leaves the card and lies over its edge`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const title = `e2e rail outside ${width} ${Date.now()}`
    const id = await makeGroupedList(page.request, title)

    try {
      await openList(page, title)
      await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'outside')

      const { rail, cols, body, card } = await boxes(page)

      // The rail ends at the card's outer left edge, so the card's own 2px border stays between it and the list (the separator); it starts 1px above
      // the list (its border over the toolbar's line) and ends at the card's bottom.
      expect(rail.right).toBeCloseTo(card.left, 1)
      expect(cols.left - card.left).toBeCloseTo(2, 1)
      expect(rail.top).toBeCloseTo(cols.top - 1, 1)
      expect(rail.bottom).toBeCloseTo(card.bottom, 1)
      // Whole pixels: the card is centred on a whole pixel, so no 1px step and no seam.
      expect(Number.isInteger(card.left)).toBe(true)
      expect(Number.isInteger(card.right)).toBe(true)
      // The card keeps its width (1080, or 1079 at an odd window) and the list body takes all of its room: the rail takes none.
      expect(card.width).toBe(width % 2 === 0 ? 1080 : 1079)
      expect(body.width).toBeCloseTo(cols.width, 1)
      expect(body.left).toBeCloseTo(cols.left, 1)
      // It stays in the window with air to spare (the cap: margin - 16px).
      expect(rail.left).toBeGreaterThanOrEqual(36)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })
}

test('the outside rail starts at the height the inside rail does', async ({ page }) => {
  const title = `e2e rail heights ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openList(page, title)
    await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'inside')
    await settled(page)
    const { rail: inside, cols: insideCols } = await boxes(page)
    expect(inside.top).toBeCloseTo(insideCols.top, 1)

    await page.setViewportSize({ width: 1728, height: 900 })
    await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'outside')
    await settled(page)
    const { rail: outside, cols: outsideCols } = await boxes(page)
    // Its 2px border covers the 1px line above the list body and 1px of the body's first line.
    expect(outsideCols.top - outside.top).toBeCloseTo(1, 1)
    expect(outside.bottom).toBeGreaterThan(outsideCols.bottom)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the filter bar ends in a 1px line (the prototype\'s), and the outside rail\'s top border lies over it', async ({ page }) => {
  const title = `e2e filterbar line ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await page.setViewportSize({ width: 1728, height: 900 })
    await openList(page, title)
    await expect(page.locator('.q-rail')).toHaveAttribute('data-placement', 'outside')
    await settled(page)

    const read = await page.evaluate(() => {
      const bar = document.querySelector('.q-list .q-filterbar')!
      const style = getComputedStyle(bar)
      return {
        width: style.borderBottomWidth,
        style: style.borderBottomStyle,
        barBottom: bar.getBoundingClientRect().bottom,
        colsTop: document.querySelector('.q-list-cols')!.getBoundingClientRect().top,
        railTop: document.querySelector('.q-rail')!.getBoundingClientRect().top,
      }
    })

    expect([read.width, read.style]).toEqual(['1px', 'solid'])
    // The line is the last pixel of the bar, right above the list body; the rail's 2px border starts on it.
    expect(read.barBottom).toBeCloseTo(read.colsTop, 1)
    expect(read.railTop).toBeCloseTo(read.barBottom - 1, 1)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the switch follows the window, with 16px of hysteresis', async ({ page }) => {
  const title = `e2e rail switch ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await page.setViewportSize({ width: 1512, height: 900 })
    await openList(page, title)
    const placement = () => page.locator('.q-rail').getAttribute('data-placement')

    expect(await placement()).toBe('inside')
    await page.setViewportSize({ width: 1552, height: 900 })
    await expect.poll(placement).toBe('outside')
    await page.setViewportSize({ width: 1530, height: 900 })
    await page.waitForTimeout(150)
    expect(await placement()).toBe('outside')
    await page.setViewportSize({ width: 1519, height: 900 })
    await expect.poll(placement).toBe('inside')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the card’s own border is the vertical line between the outside rail and the list', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 900 })
  const title = `e2e rail separator ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await openList(page, title)
    // Just inside the card's left edge, beside the rail's middle: what is drawn there is the card's border, not the rail's ground.
    const drawn = await page.evaluate(() => {
      const card = document.querySelector('.q-list')!.closest('.q-layer')!
      const rail = document.querySelector('.q-rail')!.getBoundingClientRect()
      const hit = document.elementFromPoint(card.getBoundingClientRect().left + 1, (rail.top + rail.bottom) / 2)

      return hit === card
    })
    expect(drawn).toBe(true)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the rail folds to a 38px strip, animating its width over 220ms, and the grip is gone', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 900 })
  const title = `e2e rail fold ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await openList(page, title)
    const width = () => page.locator('.q-rail').evaluate((node) => node.getBoundingClientRect().width)
    expect(await width()).toBeCloseTo(200, 0)

    await page.getByRole('button', { name: 'Collapse group jumper' }).click()
    // While it narrows it is animating a width over 220ms; afterwards it is 38px and attached to the card.
    await expect(page.locator('.q-rail.is-folding')).toHaveCount(1)
    expect(await page.locator('.q-rail').evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0.22s')
    await settled(page)
    expect(await width()).toBeCloseTo(38, 0)
    await expect(page.getByRole('separator')).toHaveCount(0)
    const { rail, card } = await boxes(page)
    expect(rail.right).toBeCloseTo(card.left, 1)

    // A press anywhere on the strip brings the rail back.
    await page.locator('.q-rail .label').click()
    await settled(page)
    expect(await width()).toBeCloseTo(200, 0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the rail is revealed from the card\'s edge when it shows, and not under reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 900 })
  const title = `e2e rail reveal ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.waitForFunction(() => document.getAnimations().some((a) => (a as CSSAnimation).animationName === 'q-railReveal'), undefined, { polling: 'raf' })
    await settled(page)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.reload()
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.locator('.q-rail').waitFor()
    expect(await page.locator('.q-rail').evaluate((node) => getComputedStyle(node).animationName)).toBe('none')
    await page.getByRole('button', { name: 'Collapse group jumper' }).click()
    expect(await page.locator('.q-rail').evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0s')
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('the grip is on the outer edge: dragging it left widens the rail, and the card does not move', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 })
  const title = `e2e rail grip ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await openList(page, title)
    const before = await boxes(page)
    const grip = await page.getByRole('separator').evaluate((node) => {
      const r = node.getBoundingClientRect()
      return { left: r.left, width: r.width, top: r.top, height: r.height }
    })
    // Six pixels wide, just inside the rail's 2px left border.
    expect(grip.width).toBeCloseTo(6, 0)
    expect(grip.left - before.rail.left).toBeGreaterThanOrEqual(0)
    expect(grip.left - before.rail.left).toBeLessThanOrEqual(2.5)

    const x = grip.left + 3
    const y = grip.top + grip.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 60, y, { steps: 4 })
    await page.mouse.up()
    const after = await boxes(page)

    expect(after.rail.width).toBeCloseTo(before.rail.width + 60, 0)
    expect(after.rail.right).toBeCloseTo(before.rail.right, 1)
    expect(after.card.left).toBeCloseTo(before.card.left, 1)
    expect(after.cols.width).toBeCloseTo(before.cols.width, 1)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('a press on the outside rail jumps to the group and does not close the layer', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 900 })
  const title = `e2e rail press ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await openList(page, title)
    await page.locator('.q-rail-entry', { hasText: 'Season 2' }).click()
    await expect(page.locator('.q-list')).toBeVisible()
    await expect(page.locator('.q-rail')).toBeVisible()
    await page.locator('.q-rail').click({ position: { x: 20, y: 300 } })
    await expect(page.locator('.q-list')).toBeVisible()
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

test('with another layer on top, the covered list shows no outside rail', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 900 })
  const title = `e2e rail covered ${Date.now()}`
  const id = await makeGroupedList(page.request, title)

  try {
    await openList(page, title)
    await expect(page.locator('.q-rail')).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.locator('.q-rail')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/lists/${id}`)
  }
})

/**
 * A screen scale that is not a whole number (Windows at 125%, 3440x1440): the browser draws a border as a whole number of device pixels, so the
 * card's 2px border is 1.6px thick. A rail offset by a plain 2px then stands 0.4px (half a device pixel) past the card's edge: its bottom line
 * lay a pixel lower, and a gap opened beside the card's line (the owner's screenshot, 2026-10-24). The page cannot be given such a scale by
 * emulation (it does not change layout), so Chromium is started with the real flag, and only Chromium.
 */
for (const ratio of [1.25, 1.5625]) {
  for (const folded of [false, true]) {
    test(`at a screen scale of ${ratio} the ${folded ? 'folded strip' : 'rail'} ends on the card's bottom line and meets its border`, async ({ browserName, baseURL }) => {
      test.skip(browserName !== 'chromium', 'the flag is Chromium’s')
      const browser = await chromium.launch({ args: [`--force-device-scale-factor=${ratio}`] })
      const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: Math.round(3440 / ratio), height: 1000 }, deviceScaleFactor: ratio })
      const page = await context.newPage()
      const title = `e2e rail scale ${ratio} ${folded} ${Date.now()}`
      const id = await makeGroupedList(page.request, title)

      try {
        await openList(page, title)
        if (folded) {
          await page.getByRole('button', { name: 'Collapse group jumper' }).click()
          await page.locator('.q-rail.is-folded').waitFor()
          await settled(page)
        }
        const edges = await page.evaluate((selector) => {
          const r = (node: Element) => node.getBoundingClientRect()
          const card = r(document.querySelector('.q-list')!.closest('.q-layer')!)
          const part = r(document.querySelector(selector)!)

          return { cardBottom: card.bottom, cardLeft: card.left, partBottom: part.bottom, partRight: part.right }
        }, '.q-rail')

        expect(edges.partBottom).toBeCloseTo(edges.cardBottom, 1)
        expect(edges.partRight).toBeCloseTo(edges.cardLeft, 1)
      } finally {
        await page.request.delete(`/api/lists/${id}`)
        await browser.close()
      }
    })
  }
}
