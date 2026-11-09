import { expect, test, type Page } from '@playwright/test'

/**
 * eX-Zed's colours (Phase 49.3), computed in both engines for each of the six skins: every one of Quantum's 32 colour tokens is a solid colour (alpha 1)
 * and the very colour of the skin's role the mapping names, the page and its text draw in the skin's stage and ink, the focus ring and the primary button
 * take the accent, a full layer's rings draw in the skin's paper and frame, and `color-scheme` is dark except for Lotus. The mapping itself is pinned by
 * `colours.guard.test.ts`; this shows what the browser makes of it. Quantum is shown to keep its own values (the identity tool shows its pixels). Reads only.
 */
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

/** Quantum token to eX-Zed role, as in the accepted table of 49.0. */
const MAPPING: Record<string, string> = {
  bg: 'stage', card: 'paper', ink: 'ink', ink2: 'ink2', ink3: 'ink2', line: 'frame', rule: 'frame', fill: 'paper', field: 'paper', hover: 'paper', done: 'paper',
  barEmpty: 'prog-dim', accent: 'acc', accentInk: 'acc-ink', pulseTint: 'paper', info: 'info', statusGold: 'ok', star: 'star', goldDeep: 'ok', gold: 'ok',
  goldLite: 'ok', danger: 'danger', warn: 'warn', ok: 'ok', sec: 'skin', deep: 'prog-dim', cyan: 'info', washA: 'stage', washB: 'stage', washC: 'stage',
  scrim: 'stage', headSub: 'ink',
}

/** stage, ink, acc, frame, paper per skin, from design's tokens. */
const EXPECTED = {
  'exzed-1d': { stage: '#000000', ink: '#ffffff', acc: '#ffff00', frame: '#d7d700', paper: '#000000' },
  'exzed-1a': { stage: '#000000', ink: '#ffffff', acc: '#ffff00', frame: '#d7d7d7', paper: '#000000' },
  'exzed-1b': { stage: '#000000', ink: '#ffffff', acc: '#ffffff', frame: '#d7d7d7', paper: '#000000' },
  'exzed-1c': { stage: '#000000', ink: '#ffffff', acc: '#ffff00', frame: '#d7d7d7', paper: '#000000' },
  'exzed-1e': { stage: '#000000', ink: '#ffffff', acc: '#ffff00', frame: '#d7d7d7', paper: '#000000' },
  'exzed-1l': { stage: '#d7d7d7', ink: '#000000', acc: '#000000', frame: '#000000', paper: '#d7d7d7' },
} as const

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`
}

async function boot(page: Page, stored: Record<string, string>) {
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', ...stored }))
  await page.goto('/')
  await page.locator('.q-home-row').first().waitFor()
}

/** What the browser makes of a CSS colour expression: the computed `color` of a probe, so `var()` and aliases are resolved as for any element. */
const colourOf = (page: Page, expressions: string[]) =>
  page.evaluate((list) => {
    const probe = document.createElement('i')
    document.body.append(probe)
    const out = list.map((expression) => {
      probe.style.color = ''
      probe.style.color = expression
      return getComputedStyle(probe).color
    })
    probe.remove()
    return out
  }, expressions)

test.describe('with the theme exzed', () => {
  for (const key of SKINS) {
    test.describe(key, () => {
      test.beforeEach(async ({ page }) => {
        await boot(page, { theme: 'exzed', exzedSkin: key })
      })

      test('every one of the 32 Quantum colour tokens is solid and is its role’s colour', async ({ page }) => {
        const tokens = Object.keys(MAPPING)
        const seen = await colourOf(page, tokens.map((token) => `var(--${token})`))
        const roles = await colourOf(page, tokens.map((token) => `var(--zx-${MAPPING[token]})`))

        expect(tokens).toHaveLength(32)
        tokens.forEach((token, at) => {
          // `rgb(r, g, b)` is alpha 1: a translucent colour computes to `rgba(...)` (or `color(...)`) in both engines.
          expect(seen[at], token).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
          expect(seen[at], token).toBe(roles[at])
        })
      })

      test('the page draws in the skin’s stage and ink', async ({ page }) => {
        const want = EXPECTED[key]
        const body = await page.evaluate(() => {
          const style = getComputedStyle(document.body)
          return { background: style.backgroundColor, color: style.color }
        })

        expect(body).toEqual({ background: rgb(want.stage), color: rgb(want.ink) })
      })

      test('the primary button and the focus ring take the accent', async ({ page }) => {
        const want = EXPECTED[key]
        // The ring is probed on a bare text input: WebKit's Tab skips buttons unless the person turned that on, and always lands on a field.
        await page.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<input id="zz-focus" aria-label="probe"><button id="zz-primary" class="q-btn primary">Go</button>'))
        const button = await page.evaluate(() => getComputedStyle(document.getElementById('zz-primary')!).backgroundColor)
        await page.keyboard.press('Tab')
        const ring = await page.evaluate(() => {
          const style = getComputedStyle(document.activeElement!)
          return { id: document.activeElement!.id, style: style.outlineStyle, colour: style.outlineColor, width: style.outlineWidth }
        })

        expect(button).toBe(rgb(want.acc))
        expect(ring).toEqual({ id: 'zz-focus', style: 'solid', colour: rgb(want.acc), width: '2px' })
      })

      test('a full layer’s rings draw in the skin’s paper and frame', async ({ page }) => {
        const want = EXPECTED[key]
        const shadow = await page.evaluate(() => getComputedStyle(document.querySelector('.q-layer')!).boxShadow)

        // Three solid rings (4px, 8px, 12px): paper, frame, paper.
        const rings = [...shadow.matchAll(/(rgba?\([^)]*\))\s+0px 0px 0px (\d+)px/g)].map((match) => [match[1], match[2]])
        expect(rings).toEqual([
          [rgb(want.paper), '4'],
          [rgb(want.frame), '8'],
          [rgb(want.paper), '12'],
        ])
      })

      test(`the colour scheme is ${key === 'exzed-1l' ? 'light' : 'dark'}`, async ({ page }) => {
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(key === 'exzed-1l' ? 'light' : 'dark')
      })
    })
  }

  test('a hand-set theme with no skin stored is Lode: dark, with the stage, ink and accent of the first skin', async ({ page }) => {
    await boot(page, { theme: 'exzed' })
    const [stage, ink, accent] = await colourOf(page, ['var(--bg)', 'var(--ink)', 'var(--accent)'])

    expect([stage, ink, accent]).toEqual([rgb('#000000'), rgb('#ffffff'), rgb('#ffff00')])
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')
  })
})

test.describe('with the theme quantum', () => {
  test('the tokens keep Quantum’s own values and the scheme follows the skin', async ({ page }) => {
    await boot(page, { theme: 'quantum', skin: 'dark-orange' })
    const [bg, card, accent] = await colourOf(page, ['var(--bg)', 'var(--card)', 'var(--accent)'])

    expect([bg, card, accent]).toEqual([rgb('#181513'), rgb('#221d19'), rgb('#c1793c')])
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')
  })

  test('a light Quantum skin stays light', async ({ page }) => {
    await boot(page, { theme: 'quantum', skin: 'light-bone' })

    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light')
  })
})
