import { expect, test } from '@playwright/test'

/**
 * H-011 in a real browser, in both engines: the rename pencil sits right after the group's name and year span, the way it does after an item's title,
 * and the free space comes after it so the progress stays on the right. Measured with the browser's own layout. Real writes, removed in a `finally`.
 */
const LONG = 'An exceptionally long group name that cannot possibly fit in this row next to its progress and its pencil'

test('the rename pencil sits right after the group name and its year span, and the progress stays on the right', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 })
  const title = `e2e group-pencil ${Date.now()}`
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  await page.request.post(`/api/lists/${list.id}/items/import`, {
    data: {
      source: 'manual',
      items: [
        { title: 'Pilot', timeToConsumeMinutes: 40, group: 'Season 1', year: 2021 },
        { title: 'Finale', timeToConsumeMinutes: 40, group: 'Season 1', year: 2023 },
        { title: 'Special', timeToConsumeMinutes: 40, group: 'Extras' },
        { title: 'Odd one', timeToConsumeMinutes: 40, group: LONG },
      ],
    },
  })
  const gaps = (name: string) =>
    page.evaluate((groupName) => {
      const header = Array.from(document.querySelectorAll<HTMLElement>('.q-group')).find((node) => (node.querySelector('.name b')?.textContent ?? '').trim() === groupName)!
      const edge = (header.querySelector('.q-year') ?? header.querySelector('.name b')!).getBoundingClientRect().right
      const pencil = header.querySelector('.q-group-rename')!.getBoundingClientRect()
      const progress = header.querySelector('.q-progress')!.getBoundingClientRect()
      const row = header.getBoundingClientRect()

      return { gap: pencil.left - edge, pencilRight: pencil.right, progressLeft: progress.left, progressRight: progress.right, rowRight: row.right }
    }, name)

  try {
    await page.goto('/')
    await page.locator('.q-home-row', { hasText: title }).click()
    await expect(page.locator('.q-item', { hasText: 'Pilot' })).toBeVisible()

    // With a year span: the pencil's left edge is within 12px of the span's right edge.
    const withYear = await gaps('Season 1')
    expect(Math.abs(withYear.gap)).toBeLessThanOrEqual(12)
    // Without one: within 12px of the name's.
    const noYear = await gaps('Extras')
    expect(Math.abs(noYear.gap)).toBeLessThanOrEqual(12)
    // The progress is still at the right edge, with free space between it and the pencil. (The bar is always 20 cells wide, H-024, so in this
    // 1000px window that space is about 50px, not the 100px it was while a short list drew a short bar.)
    expect(withYear.progressLeft - withYear.pencilRight).toBeGreaterThan(24)
    expect(withYear.rowRight - withYear.progressRight).toBeLessThan(80)

    // A very long name is cut with an ellipsis and the pencil still follows it, inside the row.
    const long = await gaps(LONG)
    expect(Math.abs(long.gap)).toBeLessThanOrEqual(12)
    expect(long.pencilRight).toBeLessThanOrEqual(long.progressLeft)

    // Renaming: the field takes the free width again.
    await page.getByRole('button', { name: 'Rename group Season 1', exact: true }).click()
    const field = await page.getByLabel('Group name', { exact: true }).boundingBox()
    // About 230px here, not the 300px+ it was before the bar was always 20 cells wide (H-024): still a usable field.
    expect(field!.width).toBeGreaterThan(150)
  } finally {
    await page.request.delete(`/api/lists/${list.id}`)
  }
})
