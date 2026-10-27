import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { en } from '../src/locale/en.js'
import { useHomeFixture } from './fixtures.js'

/**
 * Canvas H-021 (Phase 37): text inside a card runs to the edge of the box it sits in; the card's own 1080px is the measure. What a real browser
 * lays out is measured here, because the CSS guard (`web/src/widthCaps.guard.test.ts`) can say a cap is gone but not what the text then does.
 * (The list description and the Create layer's subline are measured in `list-description.spec.ts`.)
 */
test('an error explanation runs to its block\'s padding, not to a 600px column (H-021)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await useHomeFixture(page)
  // Home's own error block: the paragraph is the server's reason.
  await page.route('**/api/**', (route) => route.abort())
  await page.goto('/')

  const block = page.locator('.q-error-block')
  await expect(block).toBeVisible({ timeout: 15_000 })
  await page.waitForFunction(() => document.getAnimations().length === 0)

  const read = await page.evaluate(() => {
    const box = document.querySelector('.q-error-block')!
    const paragraph = document.querySelector('.q-error-block p')!
    const padding = parseFloat(getComputedStyle(box).paddingLeft) + parseFloat(getComputedStyle(box).paddingRight)
    const border = parseFloat(getComputedStyle(box).borderLeftWidth) + parseFloat(getComputedStyle(box).borderRightWidth)

    return { block: box.getBoundingClientRect().width, paragraph: paragraph.getBoundingClientRect().width, padding, border }
  })

  // The paragraph fills the block inside its padding (it was 600px wide in a block of about a thousand).
  expect(read.block).toBeGreaterThan(900)
  expect(Math.abs(read.paragraph - (read.block - read.padding - read.border))).toBeLessThanOrEqual(1)
})

/** A run with no place to break: a long address in a description, say. */
const UNBREAKABLE = 'x'.repeat(200)

/**
 * Puts the unbreakable run into the text box and says what it did: the box's contents stay inside it, the button beside it stays where it was
 * (the text did not push it) and the text does not reach it (it did not overlap it).
 */
async function pushesNothing(page: Page, textSelector: string, buttonSelector: string) {
  await page.waitForFunction(() => document.getAnimations().length === 0)
  const before = await page.evaluate((selector) => document.querySelector(selector)!.getBoundingClientRect().left, buttonSelector)

  const read = await page.evaluate(
    ([text, button, run]) => {
      const box = document.querySelector(text!)! as HTMLElement
      box.textContent = run!
      const boxRect = box.getBoundingClientRect()
      const buttonRect = document.querySelector(button!)!.getBoundingClientRect()

      return { buttonLeft: buttonRect.left, textRight: boxRect.right, overflow: box.scrollWidth - box.clientWidth }
    },
    [textSelector, buttonSelector, UNBREAKABLE],
  )

  expect(Math.abs(read.buttonLeft - before), 'the button did not move').toBeLessThanOrEqual(1)
  expect(read.textRight, 'the text stops before the button').toBeLessThanOrEqual(read.buttonLeft + 0.5)
  expect(read.overflow, 'the text stays inside its box').toBeLessThanOrEqual(1)
}

test.describe('long text in a header (H-021: it wraps, and pushes or overlaps no button)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test('a short description stays on one line at 1440px', async ({ page }) => {
    const title = `e2e short description ${Date.now()}`
    const made = await page.request.post('/api/lists/from-file', {
      data: { yaml: `title: ${title}\ncategory: movie\ndescription: Every film, in release order.\nitems:\n  - { title: "One", minutes: 30 }\n` },
    })
    expect(made.status()).toBe(201)
    const id = (await made.json()).id as string

    try {
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-item').first().waitFor()
      await page.waitForFunction(() => document.getAnimations().length === 0)

      const read = await page.evaluate(() => {
        const description = document.querySelector('.q-list-description')! as HTMLElement

        return { height: description.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(description).lineHeight) }
      })

      expect(read.height).toBeLessThan(read.lineHeight * 1.5)
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })

  test('the list description', async ({ page }) => {
    const title = `e2e long word ${Date.now()}`
    const made = await page.request.post('/api/lists/from-file', {
      data: { yaml: `title: ${title}\ncategory: movie\ndescription: A description.\nitems:\n  - { title: "One", minutes: 30 }\n` },
    })
    const id = (await made.json()).id as string

    try {
      await page.goto('/')
      await page.locator('.q-home-row', { hasText: title }).click()
      await page.locator('.q-item').first().waitFor()
      await pushesNothing(page, '.q-list-description', '.q-list-actions')
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
  })

  test('the Create layer\'s subline', async ({ page }) => {
    await page.route('**/api/media-types', async (route) => {
      const response = await route.fetch()
      const types = (await response.json()) as Array<{ key: string; description?: string }>
      for (const type of types) if (type.key === 'movie') type.description = 'A description.'

      await route.fulfill({ json: types })
    })
    await useHomeFixture(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'New List' }).click()
    await page.locator('.q-tile', { hasText: 'Movies' }).click()
    await page.locator('.q-create-sub').waitFor()
    await pushesNothing(page, '.q-create-sub', '.q-create-top .q-icon-btn')
  })

  test('the category picker\'s subline (New List)', async ({ page }) => {
    await useHomeFixture(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'New List' }).click()
    await page.locator('.q-picker-sub').waitFor()
    await pushesNothing(page, '.q-picker-sub', '.q-picker-head .q-icon-btn')
  })

  test('the List Vault browser\'s subline', async ({ page }) => {
    await useHomeFixture(page)
    await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [{ externalRef: 'canonical:lists/movie/a.yaml', title: 'A', category: 'movie' }], reachable: true } }))
    await page.route('**/api/library', (route) => route.fulfill({ json: { entries: [], reachable: true } }))
    await page.goto('/')
    await page.getByRole('button', { name: 'New List' }).click()
    await page.getByRole('button', { name: en.quantum.vaultShelf.browse }).click()
    await page.locator('.q-vb-sub').waitFor()
    await pushesNothing(page, '.q-vb-sub', '.q-vb-head .q-icon-btn')
  })
})

