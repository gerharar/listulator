import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { q } from './fixtures.js'

/**
 * What the setting "Show time left in My Lists" does to My Lists (canvas H-024, owner 2026-10-31, task 44.4), in a real browser, in both engines:
 * off, no time is on the screen (the tooltip of the cluster has it); on, a column of its own holds each list's time, right-aligned on one edge across
 * categories, the summary line gets its total back and the tooltip would only repeat the column, so it is gone; the box applies at once, both ways,
 * while My Lists is still mounted under Settings. Real writes on the dev server, removed in a `finally`.
 */
async function makeList(request: APIRequestContext, mediaType: string, title: string, count: number): Promise<string> {
  const list = await (await request.post('/api/lists', { data: { title, mediaType, status: 'ongoing' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: { source: 'manual', items: Array.from({ length: count }, (_, n) => ({ title: `Item ${n + 1}`, timeToConsumeMinutes: 61, group: 'S1' })) },
  })

  return list.id as string
}

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: q.settings.title, exact: true }).click()
  await expect(page.getByRole('heading', { name: q.settings.title })).toBeVisible()
}

const closeSettings = async (page: Page) => {
  await page.locator('.q-settings').getByRole('button', { name: q.settings.closeLabel, exact: true }).click()
  await expect(page.getByRole('heading', { name: q.settings.title })).toHaveCount(0)
}

test('on, each list has its time in a column on one edge, the summary has the total, and no tooltip repeats it; off, it is as before', async ({ page }) => {
  const stamp = Date.now()
  const short = await makeList(page.request, 'tv', `Zz time short ${stamp}`, 7)
  const long = await makeList(page.request, 'game', `Zz time a much longer title for the column ${stamp}`, 598)

  try {
    await page.goto('/')
    const rows = page.locator('.q-home-row', { hasText: `${stamp}` })
    await expect(rows).toHaveCount(2)
    await expect(page.locator('.q-home-row > .q-left')).toHaveCount(0)
    await expect(page.locator('.q-home-summary')).not.toContainText('left')

    // On, from Settings, while My Lists is still mounted underneath: it changes before Settings is closed.
    await openSettings(page)
    await page.getByRole('checkbox', { name: q.settings.showTimeLeft }).check()
    await expect(page.locator('.q-home-body.with-time')).toHaveCount(1)
    await closeSettings(page)

    await expect(rows.first().locator('.q-left')).toHaveText('607h 58m left')
    await expect(rows.last().locator('.q-left')).toHaveText('7h 7m left')
    await expect(page.locator('.q-home-summary')).toContainText(/ · \d+h \d+m left$/)
    const edges = await rows.evaluateAll((els) => els.map((el) => {
      const time = el.querySelector('.q-left')!.getBoundingClientRect()
      const count = el.querySelector('.q-home-count')!.getBoundingClientRect()

      return { timeRight: time.right, timeLeft: time.left, countRight: count.right }
    }))
    expect(edges[0]!.timeRight).toBeCloseTo(edges[1]!.timeRight, 0)
    // The column sits clear of the counts, every row's.
    expect(Math.min(...edges.map((edge) => edge.timeLeft)) - Math.max(...edges.map((edge) => edge.countRight))).toBeGreaterThan(8)

    // The tooltip would repeat the column, so it is off.
    await rows.first().locator('.q-home-cluster').hover()
    await page.waitForTimeout(800)
    await expect(page.getByRole('tooltip')).toHaveCount(0)

    // Off again, at once, and the time is back in the tooltip.
    await page.mouse.move(2, 2)
    await openSettings(page)
    await page.getByRole('checkbox', { name: q.settings.showTimeLeft }).uncheck()
    await expect(page.locator('.q-home-body.with-time')).toHaveCount(0)
    await closeSettings(page)
    await expect(page.locator('.q-home-row > .q-left')).toHaveCount(0)
    await expect(page.locator('.q-home-summary')).not.toContainText('left')
    await rows.first().locator('.q-home-cluster').hover()
    await expect(page.getByRole('tooltip')).toHaveText('607h 58m left')
  } finally {
    await page.request.delete(`/api/lists/${short}`)
    await page.request.delete(`/api/lists/${long}`)
  }
})
