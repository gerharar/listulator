import { expect, test, type Page } from '@playwright/test'

/**
 * The API-keys rows in Settings under eX-Zed (found by the owner on the Mac, 2026-11-11: in Russian the status pill fell to a line of its own and "Comic Vine" broke in two,
 * with free space to the right). A row is the name and its info button, the key field (IGDB: two), How?, Test and the status pill, all on one line; the Spectrum font is about
 * 2.1 times as wide as Quantum’s, so the 112px name block and the 880px column Quantum measured were too small for it. Measured in the browser because jsdom lays nothing out:
 * at the narrowest window (1128, a 1080px layer), at a common one and at a wide one, in every language, in both engines.
 */
const SETTINGS: Record<string, string> = { en: 'Settings', ru: 'Настройки', de: 'Einstellungen' }

async function openSettings(page: Page, language: string, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript(
    (entries) => {
      try {
        if (sessionStorage.getItem('__seeded')) return
        sessionStorage.setItem('__seeded', '1')
      } catch {
        return
      }
      for (const [key, value] of entries) localStorage.setItem(key, value)
    },
    Object.entries({ reducedMotion: 'true', theme: 'exzed', exzedSkin: 'exzed-1d', language }),
  )
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
  // The keys live in the desktop app only (`isDesktop()` is whether Tauri's internals exist), and the browser build draws no such section. The page has started as a
  // browser, so the stand-in goes in now, before Settings is drawn: the store plugin answers every key with a made-up 32-character one, and nothing else is asked.
  await page.evaluate(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          if (command === 'plugin:store|load') return 1
          if (command === 'plugin:store|get') return ['x'.repeat(32), true]
          return null
        },
        transformCallback: () => 0,
        metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      },
    })
  })
  await page.getByRole('button', { name: SETTINGS[language]!, exact: true }).click()
  await page.locator('.q-key-row').first().waitFor()
  // The Spectrum font decides every width here: measure after it has loaded, not with the fallback.
  await page.evaluate(() => document.fonts.ready)
}

interface Measured {
  source: string
  nameLines: number
  /** Largest gap between the vertical centres of the row’s own parts except its status chip: 0 on one line, a whole line when something else wrapped. */
  centreSpread: number
  fieldsSpread: number
  /** KeyRow found the row wider than its column (D63): the chip wraps under [Test]. */
  wrapped: boolean
  row: { top: number; height: number }
  test: { right: number; top: number; bottom: number; centre: number }
  pill: { right: number; top: number; height: number; centre: number }
  columnRight: number
}

const measure = (page: Page): Promise<Measured[]> =>
  page.locator('.q-key-row').evaluateAll((rows) =>
    rows.map((row) => {
      const centre = (element: Element) => {
        const box = element.getBoundingClientRect()
        return box.top + box.height / 2
      }
      const spread = (elements: Element[]) => Math.max(...elements.map(centre)) - Math.min(...elements.map(centre))
      const name = row.querySelector('.q-key-name')!
      const pill = row.querySelector('.q-key-pill')!
      const test = row.querySelector(':scope > button.q-btn')!
      const parts = Array.from(row.children).filter((child) => !child.classList.contains('q-field-msg') && child !== pill)
      const inputs = Array.from(row.querySelectorAll('.q-key-fields input'))
      const lineHeight = parseFloat(getComputedStyle(name).lineHeight)
      const column = row.closest('.q-settings-sections')!.getBoundingClientRect()
      const [t, p, r] = [test.getBoundingClientRect(), pill.getBoundingClientRect(), row.getBoundingClientRect()]

      return {
        source: name.textContent ?? '',
        nameLines: Math.round(name.getBoundingClientRect().height / lineHeight),
        centreSpread: spread(parts),
        fieldsSpread: spread(inputs),
        wrapped: row.hasAttribute('data-wrapped'),
        row: { top: r.top, height: r.height },
        test: { right: t.right, top: t.top, bottom: t.bottom, centre: centre(test) },
        pill: { right: p.right, top: p.top, height: p.height, centre: centre(pill) },
        columnRight: column.right,
      }
    }),
  )

/**
 * D63 (57.10b): each key's mark is design's pixel (?) in its own 32px block that overlaps nothing, in a 200px name column: the name, 8px, the block. The block stays inside the column, 8px
 * before the field, and is centred on the name's line.
 */
{
  test('the keys’ marks are the pixel help icon in their own 32px blocks, 8px after the name, inside a 200px column, clear of the field', async ({ page }) => {
    await openSettings(page, 'en', 1128)

    const marks = page.getByRole('button', { name: 'What this key is used for' })
    await expect(marks).toHaveCount(4)
    for (let n = 0; n < 4; n++) {
      const mark = marks.nth(n)
      await expect(mark.locator('svg[data-pixel-icon="help"]')).toHaveCount(1)
      await expect(mark.locator('svg.lucide')).toHaveCount(0)
      const [box, name, head, fields] = await Promise.all([
        mark.boundingBox(),
        mark.locator('xpath=preceding-sibling::*[1]').boundingBox(),
        mark.locator('xpath=..').boundingBox(),
        mark.locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " q-key-row ")]//*[contains(concat(" ", @class, " "), " q-key-fields ")]').boundingBox(),
      ])
      expect([box!.width, box!.height], 'a 32px block').toEqual([32, 32])
      expect(head!.width, 'the name column is 200px').toBe(200)
      expect(box!.x - (name!.x + name!.width), '8px after the name').toBeGreaterThanOrEqual(8)
      expect(box!.x + box!.width, 'inside the name column').toBeLessThanOrEqual(head!.x + head!.width)
      expect(fields!.x - (box!.x + box!.width), 'clear of the field by at least the row’s 8px').toBeGreaterThanOrEqual(8)
      expect(Math.abs(box!.y + box!.height / 2 - (name!.y + name!.height / 2)), 'on the name\'s line').toBeLessThan(2)
    }
  })
}

for (const language of ['en', 'ru', 'de']) {
  for (const width of [1128, 1440, 1920]) {
    // D63: only Russian and German at the narrowest window are wider than the column; there the status chip wraps under [Test], right-aligned with it, and the row grows by the chip and its gap (48px). Nothing else wraps.
    const wraps = language !== 'en' && width === 1128
    test(`every key row stays on one line except the status chip, which wraps under [Test] only when the row is wider than its column (${language}, window ${width}: ${wraps ? 'wraps' : 'one line'})`, async ({ page }) => {
      await openSettings(page, language, width)

      const rows = await measure(page)

      expect(rows.length).toBeGreaterThanOrEqual(4)
      for (const row of rows) {
        expect(row.nameLines, `${row.source}: the name is one line`).toBe(1)
        expect(row.centreSpread, `${row.source}: the name, field and buttons share one line`).toBeLessThan(2)
        expect(row.fieldsSpread, `${row.source}: its fields share one line`).toBeLessThan(2)
        expect(row.pill.right, `${row.source}: the chip ends inside the column`).toBeLessThanOrEqual(row.columnRight)
        expect(row.wrapped, `${row.source}: marked as wider than its column`).toBe(wraps)
        if (wraps) {
          expect(row.pill.top - row.test.bottom, `${row.source}: the chip is under [Test], one 8px gap down`).toBeCloseTo(8, 0)
          expect(Math.abs(row.pill.right - row.test.right), `${row.source}: right-aligned with [Test]`).toBeLessThan(1)
          expect(row.row.height, `${row.source}: the row grew by the chip and its gap`).toBeCloseTo(row.test.bottom - row.row.top + 8 + row.pill.height, 0)
        } else {
          expect(Math.abs(row.pill.centre - row.test.centre), `${row.source}: the chip shares [Test]'s line`).toBeLessThan(2)
        }
      }
    })
  }
}
