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
    Object.entries({ reducedMotion: 'true', theme: 'exzed', language }),
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
  /** Largest gap between the vertical centres of the row’s own parts (not its sentence): 0 on one line, a whole line when something wrapped. */
  centreSpread: number
  fieldsSpread: number
  rowRight: number
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
      const parts = Array.from(row.children).filter((child) => !child.classList.contains('q-field-msg'))
      const inputs = Array.from(row.querySelectorAll('.q-key-fields input'))
      const lineHeight = parseFloat(getComputedStyle(name).lineHeight)
      const column = row.closest('.q-settings-sections')!.getBoundingClientRect()
      const last = parts[parts.length - 1]!.getBoundingClientRect()

      return {
        source: name.textContent ?? '',
        nameLines: Math.round(name.getBoundingClientRect().height / lineHeight),
        centreSpread: spread(parts),
        fieldsSpread: spread(inputs),
        rowRight: last.right,
        columnRight: column.right,
      }
    }),
  )

for (const language of ['en', 'ru', 'de']) {
  for (const width of [1128, 1440, 1920]) {
    test(`every key row stays on one line, name and pill included (${language}, window ${width})`, async ({ page }) => {
      await openSettings(page, language, width)

      const rows = await measure(page)

      expect(rows.length).toBeGreaterThanOrEqual(4)
      for (const row of rows) {
        expect(row.nameLines, `${row.source}: the name is one line`).toBe(1)
        expect(row.centreSpread, `${row.source}: the name, field, buttons and pill share one line`).toBeLessThan(2)
        expect(row.fieldsSpread, `${row.source}: its fields share one line`).toBeLessThan(2)
        expect(row.rowRight, `${row.source}: the pill ends inside the column`).toBeLessThanOrEqual(row.columnRight)
      }
    })
  }
}
