import { expect, test, type Page } from '@playwright/test'

/**
 * eX-Zed's component foundation (51.1, X-007), in both engines and all six skins, read from computed styles: the highlight and dim-highlight properties, the dotted, scrim and
 * dither backgrounds; kickers in `lab`; a disabled control's `not-allowed` cursor; no letter-spacing at the root; the focus ring (2px `acc`, 2px off, inset on a group row) on
 * every element a keyboard reaches on Home and in a list; and **no radius, no shadow but the opaque frame rings, no alpha, no opacity and no filter** in any element of the
 * screens below (design, X-004). The foundation is almost invisible by design: its first visible change is the kickers' colour.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

async function boot(page: Page, { skin = 'exzed-1d', theme = 'exzed', width = 1280, height = 900 } = {}) {
  await page.setViewportSize({ width, height })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme, exzedSkin: skin }))
}

const hex = (value: string) => value.trim().toLowerCase()
const rgb = (colour: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex(colour))
  if (!m) throw new Error(`not a colour: ${colour}`)

  return `rgb(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)})`
}
const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n), name)

async function makeList(page: Page, title: string) {
  const list = await (await page.request.post('/api/lists', { data: { title, mediaType: 'tv' } })).json()
  const items = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name, n) => ({ title: name, timeToConsumeMinutes: 30, group: n < 2 ? 'Season 1' : 'Season 2' }))
  await page.request.post(`/api/lists/${list.id}/items/import`, { data: { source: 'manual', items } })

  return list.id as string
}

test.describe('the foundation’s properties and rules', () => {
  for (const skin of SKINS) {
    test(`${skin}: the highlight, the dim highlight, the dotted outline, the scrim and the dither come from the skin’s roles`, async ({ page }) => {
      await boot(page, { skin })
      await page.goto('/')
      await page.locator('.q-home-row, .q-picker').first().waitFor()

      expect(hex(await token(page, '--zx-hl-bg'))).toBe(hex(await token(page, '--zx-acc')))
      expect(hex(await token(page, '--zx-hl-ink'))).toBe(hex(await token(page, '--zx-acc-ink')))
      expect(hex(await token(page, '--zx-dim-bg'))).toBe(hex(await token(page, '--zx-acc-dim')))
      expect(hex(await token(page, '--zx-dim-ink'))).toBe(hex(await token(page, '--zx-acc-ink')))
      const dotted = await token(page, '--zx-dotted')
      expect(dotted.match(/repeating-linear-gradient/g)?.length, 'four dotted edges').toBe(4)
      expect(dotted.toLowerCase()).toContain(hex(await token(page, '--zx-ink2')))
      expect((await token(page, '--zx-scrim')).toLowerCase()).toContain(hex(await token(page, '--zx-chip-ink')))
      const dither = (await token(page, '--zx-dither-lab')).toLowerCase()
      expect([dither.includes(hex(await token(page, '--zx-lab'))), dither.includes(hex(await token(page, '--zx-paper')))]).toEqual([true, true])
    })

    test(`${skin}: a kicker is the skin’s \`lab\`, in capitals; the root has no letter-spacing`, async ({ page }) => {
      await boot(page, { skin })
      await page.goto('/')
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.locator('.q-settings').waitFor()
      const kicker = await page.locator('.q-settings .q-kicker').first().evaluate((element) => ({ colour: getComputedStyle(element).color, transform: getComputedStyle(element).textTransform }))
      expect(kicker.colour).toBe(rgb(await token(page, '--zx-lab')))
      expect(kicker.transform).toBe('uppercase')
      // The root's `font-weight: 400` and `letter-spacing: 0` (no bold, no spacing: nothing inherits one) are pinned in the stylesheet guard: a browser reports both as `400` and
      // `normal` whether declared or not, and Quantum's base sets neither on the root, so a computed style cannot tell them apart.
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontWeight)).toBe('400')
    })
  }

  test('a disabled control shows `not-allowed` (a button, an icon button, a chip, an input, a role=button), and a busy one keeps its own cursor', async ({ page }) => {
    await boot(page)
    await page.goto('/')
    await page.locator('.q-home-row, .q-picker').first().waitFor()
    const cursors = await page.evaluate(() => {
      const make = (html: string) => {
        const holder = document.createElement('div')
        holder.innerHTML = html
        document.body.append(holder)

        return getComputedStyle(holder.firstElementChild!).cursor
      }

      return {
        button: make('<button class="q-btn" disabled>x</button>'),
        icon: make('<button class="q-icon-btn" disabled>x</button>'),
        chip: make('<button class="q-chip" disabled>x</button>'),
        input: make('<input class="q-input" disabled />'),
        aria: make('<div role="button" class="q-btn" aria-disabled="true">x</div>'),
        busy: make('<button class="q-btn primary" disabled aria-busy="true" style="cursor: progress">x</button>'),
        enabled: make('<button class="q-btn">x</button>'),
      }
    })
    expect([cursors.button, cursors.icon, cursors.chip, cursors.input, cursors.aria]).toEqual(['not-allowed', 'not-allowed', 'not-allowed', 'not-allowed', 'not-allowed'])
    expect(cursors.busy, 'a busy control keeps the progress cursor').toBe('progress')
    expect(cursors.enabled, 'an enabled button is not marked').not.toBe('not-allowed')
  })

  test('Quantum has none of it: its disabled button has no `not-allowed`, it has no foundation properties', async ({ page }) => {
    await boot(page, { theme: 'quantum' })
    await page.goto('/')
    await page.locator('.q-home-row, .q-picker').first().waitFor()
    expect(await page.evaluate(() => {
      const button = document.createElement('button')
      button.className = 'q-btn'
      button.disabled = true
      document.body.append(button)

      return getComputedStyle(button).cursor
    })).not.toBe('not-allowed')
    expect(await token(page, '--zx-hl-bg')).toBe('')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('.q-settings').waitFor()
    expect(await page.locator('.q-settings .q-kicker').first().evaluate((element) => getComputedStyle(element).color)).not.toBe(rgb(await token(page, '--zx-lab') || '#000000'))
  })
})

test.describe('the focus ring', () => {
  /** Where an element deliberately departs from the ring, and whose task draws it (the test fails when an exception stops being needed). */
  const EXCEPTIONS = {
    'input.q-filter-input': { offset: '1px', why: 'a field: its focus is the border turning `acc` (51.4)' },
    'span.q-rail-grip': { outline: 'none', why: 'the rail’s own resize handle draws its focus (51.8, X-010)' },
  } as const

  test('every element a keyboard reaches on Home and in a list has the 2px `acc` outline, 2px off (a group row 2px in); the exceptions are the filter input and the rail grip', async ({ page }) => {
    test.setTimeout(240_000)
    const title = `Focus ring ${test.info().project.name} ${Date.now()}`
    const id = await makeList(page, title)
    const seenException = new Set<string>()
    try {
      for (const skin of SKINS) {
        await boot(page, { skin })
        for (const where of ['home', 'list'] as const) {
          await page.goto('/')
          await page.locator('.q-home-row').first().waitFor()
          if (where === 'list') {
            await page.locator('.q-home-row', { hasText: title }).click()
            await page.locator('.q-group').first().waitFor()
          }
          const acc = rgb(await token(page, '--zx-acc'))
          await page.mouse.move(0, 0)
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
          for (let step = 0; step < 55; step++) {
            await page.keyboard.press('Tab')
            const focused = await page.evaluate(() => {
              const element = document.activeElement as HTMLElement | null
              if (!element || element === document.body) return null
              const css = getComputedStyle(element)
              const name = element.tagName.toLowerCase() + (element.classList.length ? `.${element.classList[0]}` : '')

              return { name, width: css.outlineWidth, style: css.outlineStyle, colour: css.outlineColor, offset: css.outlineOffset, row: element.matches('.q-group, .q-item'), visible: element.matches(':focus-visible') }
            })
            if (!focused || !focused.visible) continue
            const exception = EXCEPTIONS[focused.name as keyof typeof EXCEPTIONS] as { offset?: string; outline?: string } | undefined
            if (exception?.outline) {
              expect(focused.style, `${skin} ${where} ${focused.name}: the exception is still needed`).toBe(exception.outline)
              seenException.add(focused.name)
              continue
            }
            expect([focused.width, focused.style, focused.colour], `${skin} ${where} ${focused.name}: the ring`).toEqual(['2px', 'solid', acc])
            const wanted = exception?.offset ?? (focused.row ? '-2px' : '2px')
            expect(focused.offset, `${skin} ${where} ${focused.name}: the ring's offset`).toBe(wanted)
            if (exception) seenException.add(focused.name)
          }
        }
      }
    } finally {
      await page.request.delete(`/api/lists/${id}`)
    }
    // The exceptions are still real: a deviation nobody needs any more is removed from the list, not left behind.
    expect([...seenException].sort(), 'both exceptions were reached and still depart from the ring').toEqual(['input.q-filter-input', 'span.q-rail-grip'])
  })
})

test.describe('no radius, no shadow but the frame rings, no alpha, no opacity, no filter', () => {
  /** What the sweep reports for the page as drawn now: a flat list of `property: value (element)`. */
  const sweep = (page: Page) =>
    page.evaluate(() => {
      const found: string[] = []
      const alpha = (value: string) => {
        const m = /^rgba?\(([^)]+)\)$/.exec(value)
        if (!m) return null
        const parts = m[1]!.split(/[ ,/]+/).filter(Boolean)

        return parts.length >= 4 ? parseFloat(parts[3]!) : 1
      }
      for (const element of document.querySelectorAll('body, body *')) {
        const css = getComputedStyle(element)
        const name = element.tagName.toLowerCase() + (element.classList.length ? `.${element.classList[0]}` : '')
        for (const side of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'] as const) if (css[side] !== '0px') found.push(`radius ${css[side]} (${name})`)
        // A ring is `0 0 0 Npx` in an opaque colour (design's frames); a blur or an offset or a translucent colour is a shadow.
        if (css.boxShadow !== 'none' && !/^(rgb\([^)]*\) 0px 0px 0px \d+px(, )?)+$/.test(css.boxShadow)) found.push(`shadow ${css.boxShadow} (${name})`)
        if (css.textShadow !== 'none') found.push(`text-shadow ${css.textShadow} (${name})`)
        if (css.opacity !== '1') found.push(`opacity ${css.opacity} (${name})`)
        if (css.filter !== 'none') found.push(`filter ${css.filter} (${name})`)
        for (const property of ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor'] as const) {
          const a = alpha(css[property])
          if (a !== null && a > 0 && a < 1) found.push(`alpha ${property} ${css[property]} (${name})`)
        }
      }

      return [...new Set(found)]
    })

  for (const skin of SKINS) {
    test(`${skin}: Home, Settings, a list and its ⋯ menu draw none of them`, async ({ page }) => {
      const title = `Sweep ${skin} ${test.info().project.name} ${Date.now()}`
      const id = await makeList(page, title)
      try {
        await boot(page, { skin })
        await page.goto('/')
        await page.locator('.q-home-row').first().waitFor()
        expect(await sweep(page), 'Home').toEqual([])
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await page.locator('.q-settings').waitFor()
        expect(await sweep(page), 'Settings').toEqual([])
        await page.goto('/')
        await page.locator('.q-home-row', { hasText: title }).click()
        await page.locator('.q-group').first().waitFor()
        expect(await sweep(page), 'a list').toEqual([])
        await page.getByRole('button', { name: 'More', exact: true }).click()
        await page.locator('.q-pop').first().waitFor()
        expect(await sweep(page), 'a list with its ⋯ menu open').toEqual([])
      } finally {
        await page.request.delete(`/api/lists/${id}`)
      }
    })
  }

  test('the sweep sees what it is for: Quantum, with its shadows and translucent lines, is not clean', async ({ page }) => {
    await boot(page, { theme: 'quantum', skin: 'exzed-1d' })
    await page.goto('/')
    await page.locator('.q-home-row, .q-picker').first().waitFor()
    expect((await sweep(page)).length).toBeGreaterThan(3)
  })
})
