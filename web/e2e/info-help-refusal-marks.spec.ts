import { expect, test, type Page } from '@playwright/test'
import { q, useHomeFixture } from './fixtures.js'

/**
 * (i) is about content, (?) is about the app, (!) marks a refusal (canvas H-031, `DESIGN.md` section 5 rule 6), in a real browser under Quantum: the header's About is a
 * 17px (?) in its 40 by 36 button; the Import tab's refusal line starts with a 15px (!) in the sentence's colour, 8px before it, centred on the line, never red. The
 * jsdom tests say which glyph each place draws; this says what a browser makes of it (the old (i) was drawn too small to see).
 */
async function open(page: Page) {
  await useHomeFixture(page)
  await page.addInitScript(() => localStorage.setItem('reducedMotion', 'true'))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: q.home.title })).toBeVisible({ timeout: 15_000 })
}

test('the header’s About is a 17px (?) in its button', async ({ page }) => {
  await open(page)

  const button = page.getByRole('button', { name: q.appHeader.about, exact: true })
  const icon = button.locator('svg')
  await expect(icon).toHaveClass(/lucide-circle-(help|question-mark)/)
  const [box, mark] = [(await button.boundingBox())!, (await icon.boundingBox())!]
  expect([mark.width, mark.height]).toEqual([17, 17])
  // Centred in the button.
  expect(Math.abs(mark.x + mark.width / 2 - (box.x + box.width / 2))).toBeLessThan(1)
  expect(Math.abs(mark.y + mark.height / 2 - (box.y + box.height / 2))).toBeLessThan(1)
})

test('an Import refusal starts with a 15px (!) in the sentence’s colour, 8px before it and centred on the line, and is not red', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: q.home.newList }).click()
  await page.locator('.q-tile', { hasText: /^Movies/ }).click()
  await page.getByRole('tab', { name: q.createList.importTab }).click()
  await page.getByLabel(q.importFile.boxLabel).fill('title: X\ncategory: board games\nitems:\n  - { title: A }\n')
  await page.getByRole('button', { name: q.importFile.import, exact: true }).click()

  const line = page.locator('.q-import-refusal')
  await expect(line).toBeVisible()
  const icon = line.locator('svg')
  await expect(icon).toHaveClass(/lucide-circle-alert/)
  const [row, mark] = [(await line.boundingBox())!, (await icon.boundingBox())!]
  expect([mark.width, mark.height], 'the icon is its full size, not squeezed by the sentence').toEqual([15, 15])
  expect(Math.abs(mark.y + mark.height / 2 - (row.y + row.height / 2)), 'centred on the line').toBeLessThan(1)
  const sentence = await line.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node.lastChild!)
    return range.getBoundingClientRect().left
  })
  expect(sentence - (mark.x + mark.width), 'eight pixels before the text').toBeCloseTo(8, 0)
  const [iconColour, lineColour] = await Promise.all([icon.evaluate((node) => getComputedStyle(node).color), line.evaluate((node) => getComputedStyle(node).color)])
  expect(iconColour, 'the sentence’s own colour (ink2), never red').toBe(lineColour)
})
