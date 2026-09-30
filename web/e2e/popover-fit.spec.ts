import { expect, test } from '@playwright/test'

/**
 * Task 11.3, in a real browser (jsdom cannot lay anything out): a popover taller than the room stays on
 * screen and scrolls inside, and the platform panel beside the Edit window is never drawn at the left edge
 * before it jumps into place. Real writes, removed in a `finally`.
 */
async function gamesList(page: import('@playwright/test').Page, title: string) {
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'game' } })).json()
  await page.request.post(`/api/lists/${list.id}/items/import`, {
    data: {
      source: 'manual',
      items: [
        { title: 'Halo', timeToConsumeMinutes: 600, tags: ['Xbox'] },
        { title: 'Gran Turismo', timeToConsumeMinutes: 600, tags: ['PS3'] },
        { title: 'Unity', timeToConsumeMinutes: 900 },
      ],
    },
  })
  return list as { id: string; title: string }
}

test('the add row’s platform picker fits a short window: all of it on screen, scrolling inside if it must', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 520 })
  const list = await gamesList(page, `e2e popover-fit add ${Date.now()}`)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: list.title }).click({ timeout: 5000 })
    const picker = page.getByRole('button', { name: /^Default platforms for manually added items:/ })
    await picker.scrollIntoViewIfNeeded({ timeout: 5000 })
    await picker.click({ timeout: 5000 })

    const card = page.locator('.q-pop', { has: page.getByPlaceholder('Search 186 platforms') })
    await expect(card).toBeVisible()
    await page.waitForTimeout(300) // floating-ui's placement settles
    const box = (await card.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(520)
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})

test('the [+] platform editor is never drawn at the left edge before it jumps beside the Edit window', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  const list = await gamesList(page, `e2e popover-fit plus ${Date.now()}`)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: list.title }).click()
    const plus = page.getByRole('button', { name: 'Set platforms for Unity' })
    await expect(plus).toBeVisible()

    // Every frame from the click on: where the panel is, and whether it can be seen.
    await page.evaluate(() => {
      const seen: { left: number; opacity: number }[] = []
      ;(window as unknown as { __panelFrames: typeof seen }).__panelFrames = seen
      const tick = () => {
        const panel = document.querySelector<HTMLElement>('.q-platpanel')
        if (panel) seen.push({ left: panel.getBoundingClientRect().left, opacity: Number(getComputedStyle(panel).opacity) })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await plus.click()
    await expect(page.getByRole('dialog', { name: 'Choose platforms' })).toBeVisible()
    await page.waitForTimeout(400)

    const frames = await page.evaluate(() => (window as unknown as { __panelFrames: { left: number; opacity: number }[] }).__panelFrames)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.filter((frame) => frame.opacity > 0 && frame.left < 100)).toEqual([])
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})

test('the Edit window’s Group suggestions are not clipped by the window: every group can be seen and hit', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  const title = `e2e popover-fit groups ${Date.now()}`
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'comic' } })).json()
  const names = ['Better Call Saul Employee Training: Los Pollos Hermanos Employee Training', 'Season 2', 'Season 3', 'Season 4', 'Season 5', 'Specials']
  await page.request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'manual', items: names.map((group, index) => ({ title: `Issue ${index}`, timeToConsumeMinutes: 20, group })) },
  })

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await page.getByRole('button', { name: 'Edit Issue 0', exact: true }).click()
    const card = page.locator('.q-pop', { has: page.getByLabel('Title') })
    await card.getByLabel('Group').click()

    const options = card.getByRole('option')
    await expect(options.last()).toBeAttached()
    expect(await options.count()).toBeGreaterThanOrEqual(names.length)

    // The card fits, so it does not scroll (a scrolling card would clip the list hanging below it).
    await expect(card.locator('.q-pop-scroll')).toHaveCSS('overflow-y', 'visible')
    // Every option in view in the list itself answers a hit-test: none is clipped by the Edit window.
    const { tested, hidden } = await card.getByRole('listbox').evaluate((list) => {
      const box = list.getBoundingClientRect()
      const tested: string[] = []
      const hidden: string[] = []
      for (const node of list.querySelectorAll('[role=option]')) {
        const at = node.getBoundingClientRect()
        const [x, y] = [at.x + at.width / 2, at.y + at.height / 2]
        if (y < box.y || y > box.y + box.height) continue
        tested.push(node.textContent ?? '')
        const hit = document.elementFromPoint(x, y)
        if (!hit || !node.contains(hit)) hidden.push(node.textContent ?? '')
      }
      return { tested, hidden }
    })
    expect(tested.length).toBeGreaterThanOrEqual(5)
    expect(hidden).toEqual([])
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})

