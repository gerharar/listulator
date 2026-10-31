import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { settled } from './groupLineMarks.js'

/**
 * Canvas H-024 (owner, 2026-10-31) in a real browser, in both engines: every bar is 20 cells of 5% whatever the list's size, the percentage sits
 * beside it, the count is the count alone, and My Lists reads "41% (25/60)" in columns that line up across categories, with the time left in a
 * tooltip above the cluster. The unit tests have the rules; this has what only a browser's layout and a real list can say. (The header bar
 * is no button, the box and the column have their own specs: `list-screen`, `time-left-setting`, `time-left-column`.) Real writes on the dev
 * server, removed in a `finally`.
 */
interface Made {
  id: string
  title: string
}

async function makeList(request: APIRequestContext, mediaType: string, title: string, count: number, done: number, status = 'ongoing'): Promise<Made> {
  const list = await (await request.post('/api/lists', { data: { title, mediaType, status } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'manual', items: Array.from({ length: count }, (_, n) => ({ title: `Item ${n + 1}`, timeToConsumeMinutes: 61, group: 'S1' })) },
  })
  const items = ((await (await request.get(`/api/lists/${list.id}`)).json()).items as Array<{ id: string }>).slice(0, done)
  for (let from = 0; from < items.length; from += 25) {
    await Promise.all(items.slice(from, from + 25).map((item) => request.put(`/api/lists/${list.id}/items/${item.id}/consumed`, { data: { consumed: true } })))
  }

  return { id: list.id as string, title }
}

/** Unique to this test and this engine: both engines and every test here run at once on one database, and a row is found by its title. */
const stampFor = (browserName: string) => `${browserName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

const remove = (page: Page, ...lists: Made[]) => Promise.all(lists.map((list) => page.request.delete(`/api/lists/${list.id}`)))

/** What a row's cluster shows: the lit cells, the percentage text, its colour, the count text, and where each sits. */
const cluster = (page: Page, title: string) =>
  page
    .locator('.q-home-row', { hasText: title })
    .first()
    .evaluate((row) => {
      const box = (selector: string) => row.querySelector(selector)!.getBoundingClientRect()
      const meter = row.querySelector<HTMLElement>('.q-meter')!
      const pct = row.querySelector<HTMLElement>('.q-pct')!
      const probe = document.createElement('span')
      probe.style.color = 'var(--gold)'
      document.body.appendChild(probe)
      const gold = getComputedStyle(probe).color
      probe.remove()

      return {
        cells: meter.style.getPropertyValue('--n').trim(),
        lit: meter.style.getPropertyValue('--f').trim(),
        full: meter.classList.contains('full'),
        percent: pct.textContent,
        percentIsGold: getComputedStyle(pct).color === gold,
        count: row.querySelector('.q-home-count')!.textContent,
        meterLeft: box('.q-meter').left,
        meterWidth: box('.q-meter').width,
        pctRight: box('.q-pct').right,
        countLeft: box('.q-home-count').left,
      }
    })

test('a 7-item and a 150-item list draw the same 20-cell bar, on My Lists and in the list header, with floor-rounded cells and percentage', async ({ page, browserName }) => {
  const stamp = stampFor(browserName)
  const small = await makeList(page.request, 'tv', `Zz bar small ${stamp}`, 7, 3)
  const large = await makeList(page.request, 'game', `Zz bar large ${stamp}`, 150, 75)

  try {
    await page.goto('/')
    await expect(page.locator('.q-home-row', { hasText: `${stamp}` })).toHaveCount(2)
    const a = await cluster(page, small.title)
    const b = await cluster(page, large.title)

    // 20 cells for both, the same width; 3 of 7 is 42% and floor(3/7 x 20) = 8 cells (rounding would give 43% and 9), 75 of 150 is 50% and 10.
    expect([a.cells, b.cells]).toEqual(['20', '20'])
    expect(a.meterWidth).toBeCloseTo(b.meterWidth, 1)
    expect([a.percent, a.lit, a.count]).toEqual(['42%', '8', '(3/7)'])
    expect([b.percent, b.lit, b.count]).toEqual(['50%', '10', '(75/150)'])

    // Opened, the header bar is the same width again, and a group head's bar is 20 cells with its own percentage.
    const headerWidths: number[] = []
    for (const [list, percent] of [[small, '42%'], [large, '50%']] as const) {
      await page.locator('.q-home-row', { hasText: list.title }).click()
      await expect(page.getByRole('heading', { name: new RegExp(list.title) })).toBeVisible()
      const header = page.locator('.q-progress.header .q-meter')
      // The layer drums in: a measurement made while it moves is of a scaled bar.
      await settled(page)
      headerWidths.push((await header.boundingBox())!.width)
      await expect(header).toHaveAttribute('style', /--n:\s*20\b/)
      await expect(page.locator('.q-progress.header .q-pct')).toHaveText(percent)
      await expect(header).not.toHaveAttribute('tabindex', /.*/)
      await expect(page.locator('.q-group').first().locator('.q-meter')).toHaveAttribute('style', /--n:\s*20\b/)
      await expect(page.locator('.q-group').first().locator('.q-pct')).toHaveText(percent)
      await page.locator('.q-layer-tab').first().click()
      await expect(page.locator('.q-home-row', { hasText: list.title })).toBeVisible()
    }
    expect(headerWidths[0]).toBeCloseTo(headerWidths[1]!, 1)

    // The old "(n%)" is nowhere on the screen: not in a count on My Lists, and (above) not in the header's or a group's.
    expect(await page.locator('.q-home').innerText()).not.toMatch(/\(\d+%\)/)
  } finally {
    await remove(page, small, large)
  }
})

test('the edges: one done reads <1% and lights one cell, one short of all lights 19 and reads 99%, all done is 20 gold cells and a gold 100%', async ({ page, browserName }) => {
  const stamp = stampFor(browserName)
  const started = await makeList(page.request, 'game', `Zz edge started ${stamp}`, 150, 1)
  const almost = await makeList(page.request, 'game', `Zz edge almost ${stamp}`, 150, 149)
  const done = await makeList(page.request, 'game', `Zz edge done ${stamp}`, 7, 7, 'complete')
  const empty = await makeList(page.request, 'game', `Zz edge empty ${stamp}`, 0, 0)

  try {
    await page.goto('/')
    await expect(page.locator('.q-home-row', { hasText: `${stamp}` })).toHaveCount(4)

    const one = await cluster(page, started.title)
    expect([one.lit, one.percent, one.full, one.percentIsGold]).toEqual(['1', '<1%', false, false])

    const nearly = await cluster(page, almost.title)
    expect([nearly.lit, nearly.percent, nearly.full, nearly.percentIsGold]).toEqual(['19', '99%', false, false])

    const all = await cluster(page, done.title)
    expect([all.lit, all.cells, all.percent, all.full, all.percentIsGold]).toEqual(['20', '20', '100%', true, true])

    const none = await cluster(page, empty.title)
    expect([none.lit, none.cells, none.percent, none.count, none.full]).toEqual(['0', '20', '0%', '(0/0)', false])
  } finally {
    await remove(page, started, almost, done, empty)
  }
})

test('bars, percentages and counts start at one x across categories, the count one character after the percentage', async ({ page, browserName }) => {
  const stamp = stampFor(browserName)
  const tv = await makeList(page.request, 'tv', `Zz align tv ${stamp}`, 7, 2)
  const game = await makeList(page.request, 'game', `Zz align game with a much longer name for this check ${stamp}`, 150, 40)

  try {
    await page.goto('/')
    await expect(page.locator('.q-home-row', { hasText: `${stamp}` })).toHaveCount(2)
    const a = await cluster(page, tv.title)
    const b = await cluster(page, game.title)

    expect(a.meterLeft).toBeCloseTo(b.meterLeft, 0)
    expect(a.pctRight).toBeCloseTo(b.pctRight, 0)
    expect(a.countLeft).toBeCloseTo(b.countLeft, 0)
    // One 13px mono character (8px) between the percentage and the count.
    expect(a.countLeft - a.pctRight).toBeGreaterThan(6)
    expect(a.countLeft - a.pctRight).toBeLessThan(10)
  } finally {
    await remove(page, tv, game)
  }
})

test('the time left is the tooltip of the cluster, above it with the right edges aligned; the title has none', async ({ page, browserName }) => {
  const stamp = stampFor(browserName)
  const list = await makeList(page.request, 'game', `Zz tip ${stamp}`, 150, 50)

  try {
    await page.goto('/')
    const row = page.locator('.q-home-row', { hasText: list.title })
    await expect(row).toBeVisible()

    await row.locator('.q-home-cluster').hover()
    const tip = page.getByRole('tooltip')
    await expect(tip).toBeVisible()
    await expect(tip).toHaveText(/^\d+h( \d+m)? left$/)
    const t = (await tip.boundingBox())!
    const c = (await row.locator('.q-home-cluster').boundingBox())!
    expect(t.x + t.width).toBeCloseTo(c.x + c.width, 0)
    // Above it, 8px clear (a pixel or two of play for rounding).
    expect(c.y - (t.y + t.height)).toBeGreaterThan(5)
    expect(c.y - (t.y + t.height)).toBeLessThan(11)

    await page.mouse.move(2, 2)
    await expect(tip).toHaveCount(0)
    await row.locator('.name').hover()
    await page.waitForTimeout(800)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  } finally {
    await remove(page, list)
  }
})

test('keyboard focus on the row shows the same time at once, and leaving it hides it', async ({ page, browserName }) => {
  // WebKit's default is that Tab skips buttons (a system setting), so only Chromium can walk to the row.
  test.skip(browserName !== 'chromium', 'Tab does not reach a button in WebKit by default')
  const stamp = stampFor(browserName)
  const list = await makeList(page.request, 'game', `Zz tab ${stamp}`, 10, 4)

  try {
    await page.goto('/')
    const row = page.locator('.q-home-row', { hasText: list.title })
    await expect(row).toBeVisible()

    await page.mouse.move(0, 0)
    for (let step = 0; step < 40; step += 1) {
      if (await row.evaluate((node) => node === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(row).toBeFocused()
    await expect(page.getByRole('tooltip')).toHaveText(/^\d+h( \d+m)? left$/)

    // Leaving the row ends it (a Tab would land on the next row, which has its own).
    await row.evaluate((node) => (node as HTMLElement).blur())
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  } finally {
    await remove(page, list)
  }
})
