import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { en } from '../src/locale/en.js'
import { ru } from '../src/locale/ru.js'
import { de } from '../src/locale/de.js'

/**
 * Task 10.32b in a real browser: the main screens in Russian and in German with
 * no English left over, no page-level sideways scroll from longer words, and a
 * screenshot of each in `test-results/i18n/` for a human to look at (jsdom has
 * no layout, so only a browser can say whether German fits).
 *
 * The leak check is: every plain English string in `en.ts` whose translation is
 * different must not appear on the screen. It cannot see a *function's* output
 * (counts, names) — those are covered by the locale unit tests.
 */
const LANGUAGES = { ru, de } as const

function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(leaves)
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves)
  return []
}

/** English strings worth looking for: long enough to be a phrase, and not the same in the other language. */
function englishOnly(other: unknown): string[] {
  const translated = leaves(other)
  const inTranslation = translated.join('\n')
  return leaves(en).filter(
    (text) =>
      text.length >= 5 &&
      !translated.includes(text) &&
      // A word both languages use (German "Import") is not a leak.
      !wordIn(text, inTranslation),
  )
}

/** Names and file syntax that are meant to be read as they are — not English wording. */
const AS_WRITTEN = /Comic Vine|MusicBrainz|Open Library|\bitems:/g

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const wordIn = (phrase: string, text: string): boolean =>
  new RegExp(`(?<![\\p{L}\\d])${escapeRegExp(phrase)}(?![\\p{L}\\d])`, 'u').test(text)

async function makeList(request: APIRequestContext, title: string): Promise<string> {
  const list = await (await request.post('/api/lists', { data: { title, mediaType: 'tv', status: 'ongoing' } })).json()
  await request.post(`/api/lists/${list.id}/items/import`, {
    data: {
      source: 'manual',
      items: [
        { title: 'Alpha', timeToConsumeMinutes: 30, group: 'Season 1' },
        { title: 'Beta', timeToConsumeMinutes: 30, group: 'Season 1' },
        { title: 'Gamma', timeToConsumeMinutes: 30, group: 'Season 2' },
      ],
    },
  })
  return list.id
}

/** Everything a person can read or hear on the page: its text, and the labels, hints and placeholders. */
function readable(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts = [document.body.innerText]
    for (const el of document.querySelectorAll('[aria-label],[title],[placeholder]')) {
      for (const name of ['aria-label', 'title', 'placeholder']) {
        const value = el.getAttribute(name)
        if (value) parts.push(value)
      }
    }
    return parts.join('\n')
  })
}

for (const [code, locale] of Object.entries(LANGUAGES)) {
  test(`the main screens in ${code}: no English left, nothing pushed off to the side`, async ({ page }) => {
    test.setTimeout(120_000)
    page.setDefaultTimeout(8_000)
    await page.setViewportSize({ width: 1280, height: 820 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript((language) => localStorage.setItem('language', language), code)
    const t = locale.quantum
    const leaky = englishOnly(locale)
    const title = `e2e i18n ${code} ${Date.now()}`
    const id = await makeList(page.request, title)
    const problems: string[] = []

    async function scan(name: string) {
      await page.evaluate(() => document.fonts.ready)
      const text = (await readable(page)).replace(AS_WRITTEN, ' ')
      for (const phrase of leaky) {
        if (wordIn(phrase, text)) problems.push(`${name}: "${phrase}"`)
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (overflow > 0) problems.push(`${name}: page scrolls sideways by ${overflow}px`)
      await page.screenshot({ path: `test-results/i18n/${code}-${name}.png` })
    }

    await page.route('**/api/library/untracked', (route) =>
      route.fulfill({
        json: {
          entries: [{ externalRef: 'canonical:lists/book/lotr.yaml', title: 'The Lord of the Rings', category: 'book', itemCount: 3 }],
          reachable: true,
        },
      }),
    )

    try {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: t.home.title })).toBeVisible({ timeout: 15_000 })
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(code)
      await scan('home')

      // Settings.
      await page.getByRole('button', { name: t.appHeader.settings, exact: true }).click()
      await expect(page.getByRole('heading', { name: t.settings.title })).toBeVisible()
      await scan('settings')
      await page.getByRole('button', { name: t.settings.closeLabel, exact: true }).click()

      // The helper sheets.
      for (const [key, name] of [
        ['tiredBoss', t.home.helpButtons.tiredBoss],
        ['finalizer', t.home.helpButtons.finalizer],
        ['justOneFix', t.home.helpButtons.justOneFix],
        ['surprise', t.home.helpButtons.surpriseMe],
      ] as const) {
        await page.getByRole('button', { name, exact: true }).click()
        await page.locator('.q-sheet').waitFor()
        await page.waitForTimeout(400)
        await scan(`sheet-${key}`)
        await page.getByRole('button', { name, exact: true }).click()
        await expect(page.locator('.q-sheet')).toHaveCount(0)
      }

      // Category picker, then the Create layer's three tabs.
      await page.getByRole('button', { name: t.home.newList, exact: true }).click()
      await expect(page.getByRole('heading', { name: t.categoryPicker.title })).toBeVisible()
      await scan('picker')
      await page.getByRole('button', { name: new RegExp(locale.categories['movie']!.label!) }).first().click()
      await expect(page.getByRole('heading', { name: t.createList.title(locale.categories['movie']!.label!) })).toBeVisible()
      await scan('create-search')
      await page.getByRole('tab', { name: t.createList.handTab }).click()
      await scan('create-hand')
      await page.getByRole('tab', { name: t.createList.importTab }).click()
      await scan('create-import')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('heading', { name: t.home.title })).toBeVisible()

      // A list, its menus and an item's details.
      await page.getByRole('button', { name: new RegExp(title) }).click()
      await expect(page.getByText('Alpha')).toBeVisible()
      await scan('list')
      await page.getByRole('button', { name: t.list.more, exact: true }).click()
      await scan('list-more')
      // Each action of the ⋯ menu opens its own popover.
      for (const [key, name] of [
        ['edit', t.list.moreMenu.edit],
        ['export', t.list.moreMenu.export],
        ['reorder', t.list.moreMenu.reorder],
        ['reset', t.list.moreMenu.reset],
        ['delete', t.list.moreMenu.delete],
      ] as const) {
        const action = page.getByRole('button', { name, exact: true })
        // A hand-made list has no source to reset to, so that action is not offered.
        if ((await action.count()) === 0) continue
        await action.click()
        await page.waitForTimeout(300)
        await scan(`list-${key}`)
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: t.list.more, exact: true }).click()
      }
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: t.list.itemActions.details('Alpha') }).click()
      await scan('list-item-details')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: t.list.itemActions.edit('Alpha') }).click()
      await scan('list-item-edit')
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }

    expect(problems).toEqual([])
  })
}
