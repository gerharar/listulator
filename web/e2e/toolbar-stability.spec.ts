import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { q } from './fixtures.js'

/**
 * The list toolbar holds still (H-019 revision, H-023, task 38.4), in a real browser, on a long list of each
 * category that has value facets (Music, Games, Books, Mega) at three window widths: every value facet is one
 * dropdown button; picking values changes only that button's width (the label's, 180px at most) and the facets
 * after it; Hide Completed, fold-all, the text filter and the split button's state move nothing at all.
 * Real writes on the dev server, removed in a `finally`.
 */
interface Kind {
  mediaType: string
  /** The bar's facets, in order (their kicker labels). */
  facets: string[]
  /** The tags the items cycle through, so every facet has at least two options. */
  tags: string[][]
}

const KINDS: Kind[] = [
  { mediaType: 'music', facets: ['Type', 'Recording'], tags: [['Album'], ['Mini'], ['Compilation'], ['Album', 'Live']] },
  { mediaType: 'game', facets: ['Platform'], tags: [['PS3'], ['X360'], ['PC'], ['NDS']] },
  { mediaType: 'book', facets: ['Language'], tags: [['English'], ['German'], ['Russian']] },
  { mediaType: 'mega', facets: ['Medium'], tags: [['movie'], ['tv'], ['game'], ['book']] },
]
const WIDTHS = [1280, 1440, 1728]
const COUNT = 80

async function makeList(request: APIRequestContext, title: string, kind: Kind) {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: kind.mediaType } })).json()
  const items = Array.from({ length: COUNT }, (_, n) => ({
    title: `Entry ${n}`,
    timeToConsumeMinutes: 30,
    group: `Part ${n < COUNT / 2 ? 1 : 2}`,
    tags: kind.tags[n % kind.tags.length],
  }))
  const imported = await request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })
  expect(imported.ok()).toBe(true)

  return list.id as string
}

async function openList(page: Page, title: string) {
  await page.goto('/')
  await page.locator('.q-home-row', { hasText: title }).click()
  await page.locator('.q-filterbar').waitFor()
  // A long list opens with its groups shut: open them, so there are rows to tick.
  const expand = page.locator('.q-fold', { hasText: q.list.filter.expandAll })
  if (await expand.count()) await expand.click()
  await page.locator('.q-item').first().waitFor()
  // The layer drums in over 380ms, scaled: measure after that, never during it.
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

const bar = (page: Page) => page.locator('.q-filterbar')
const facetButtons = (page: Page) => bar(page).locator(':scope > .q-facet > .q-facet-summary')

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Every direct child of the bar, by name (the facets by position), as the layout puts it. */
async function layout(page: Page): Promise<Record<string, Box>> {
  await page.waitForFunction(() => document.getAnimations().length === 0)

  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 10) / 10
    const parts: Record<string, Box> = {}
    let facet = 0
    for (const child of Array.from(document.querySelector('.q-filterbar')!.children)) {
      const rect = child.getBoundingClientRect()
      const name = child.classList.contains('q-facet') ? `facet${facet++}` : child.classList[0]!
      parts[name] = { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) }
    }

    return parts
  })
}

for (const kind of KINDS) {
  for (const width of WIDTHS) {
    test(`${kind.mediaType} list at ${width}px: one dropdown per facet, and the toolbar holds still`, async ({ page }) => {
      const title = `e2e toolbar-stability ${kind.mediaType} ${width} ${Date.now()}`
      const id = await makeList(page.request, title, kind)

      try {
        await page.setViewportSize({ width, height: 900 })
        await openList(page, title)

        await test.step('exactly one button per value facet, no chips in the bar', async () => {
          await expect(bar(page).locator(':scope > .q-facet')).toHaveCount(kind.facets.length)
          await expect(facetButtons(page)).toHaveCount(kind.facets.length)
          await expect(bar(page).locator('.q-facet-seg')).toHaveCount(0)
          await expect(bar(page).locator(':scope > .q-facet .q-kicker')).toHaveText(kind.facets.map((label) => q.list.filter.facetLabels[label] ?? label))
          await expect(page.getByRole('group', { name: 'Jump to an end of the list' })).toBeVisible()
        })

        await test.step('Hide Completed, fold-all, the text filter and the split button move nothing', async () => {
          const before = await layout(page)

          await page.locator('.q-item', { hasText: 'Entry 0' }).locator('.title').click()
          await expect(page.locator('.q-item', { hasText: 'Entry 0' })).toHaveClass(/is-done/)
          await bar(page).locator('.q-hide-done').click()
          await expect(bar(page).locator('.q-hide-done')).toHaveAttribute('aria-pressed', 'true')
          await expect(bar(page).getByText(`${COUNT - 1} of ${COUNT} shown`)).toBeVisible()
          expect(await layout(page)).toEqual(before)

          await bar(page).locator('.q-fold').click()
          expect(await layout(page)).toEqual(before)
          await bar(page).locator('.q-fold').click()

          await page.getByPlaceholder('Filter items…').fill('Entry 1')
          await expect(bar(page).getByText(`11 of ${COUNT} shown`)).toBeVisible()
          expect(await layout(page)).toEqual(before)
          await page.getByPlaceholder('Filter items…').fill('zzz')
          await expect(bar(page).getByText(`0 of ${COUNT} shown`)).toBeVisible()
          expect(await layout(page)).toEqual(before)
          await page.getByPlaceholder('Filter items…').fill('')

          // The split button: its halves go from "top" to "bottom" and back; the group stays where it is.
          await page.getByRole('button', { name: 'Scroll to the bottom of the list' }).click()
          await expect(page.getByRole('button', { name: 'Scroll to the bottom of the list' })).toBeDisabled()
          expect(await layout(page)).toEqual(before)
          await page.getByRole('button', { name: 'Scroll to the top of the list' }).click()
          await expect(page.getByRole('button', { name: 'Scroll to the top of the list' })).toBeDisabled()
          expect(await layout(page)).toEqual(before)

          await bar(page).locator('.q-hide-done').click()
        })

        await test.step('picking values changes only that button and the facets after it', async () => {
          for (let facet = 0; facet < kind.facets.length; facet += 1) {
            const before = await layout(page)
            const button = facetButtons(page).nth(facet)

            // One value, then two (a facet of two options has no second pick: both is All): a name, then names, each inside the 180px cap.
            await button.click()
            const options = (await page.getByRole('dialog').locator('.q-facet button').count()) - 1
            await page.keyboard.press('Escape')
            await expect(page.getByRole('dialog')).toHaveCount(0)
            for (const picks of options > 2 ? [1, 2] : [1]) {
              await button.click()
              const pop = page.getByRole('dialog')
              await pop.locator('.q-facet button').nth(picks).click()
              await page.keyboard.press('Escape')
              await expect(pop).toHaveCount(0)

              const after = await layout(page)
              const names = Object.keys(before)
              for (const name of names) {
                const index = /^facet(\d+)$/.exec(name)?.[1]
                if (index !== undefined && Number(index) === facet) {
                  expect(after[name]!.x, `${name} keeps its left edge`).toBe(before[name]!.x)
                  expect(after[name]!.y).toBe(before[name]!.y)
                  expect(after[name]!.height).toBe(before[name]!.height)
                } else if (index !== undefined && Number(index) > facet) {
                  // A facet that follows may slide sideways; it never leaves the row.
                  expect(after[name]!.y, `${name} stays on the row`).toBe(before[name]!.y)
                  expect(after[name]!.height).toBe(before[name]!.height)
                } else {
                  expect(after[name], `${name} does not move`).toEqual(before[name])
                }
              }
              const summary = (await button.boundingBox())!
              expect(summary.width, 'the button never passes 180px').toBeLessThanOrEqual(180)
              await expect(button).toHaveAttribute('data-on', 'true')
            }

            // Back to All.
            await button.click()
            await page.getByRole('dialog').getByRole('button', { name: 'All', exact: true }).click()
            await page.keyboard.press('Escape')
            await expect(button).toHaveAttribute('data-on', 'false')
            expect(await layout(page)).toEqual(before)
          }
        })
      } finally {
        await page.request.delete(`/api/lists/${id}`)
      }
    })
  }
}
