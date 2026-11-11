import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { decodePng } from './pngPixels.js'
import { en } from '../src/locale/en.js'
import { useHomeFixture } from './fixtures.js'

/**
 * The vault door (50.10, X-006), in both engines, under eX-Zed only: in the List Vault's empty pane (loading, out of reach, nothing picked) a mask of `vault-door` (102x100 art
 * pixels) at 3 screen px each (306x300) in the skin's progress colour, centred, 16px above the words, in place of Quantum's line drawing; the words and the live region are as they were.
 */
const door = decodePng(readFileSync(new URL('../src/styles/theme/art/vault-door.png', import.meta.url).pathname))
type Colour = [number, number, number]
const SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

const entry = (category: string, n: number) => ({ externalRef: `canonical:lists/${category}/${n}.yaml`, title: `${category} ${n}`, category, itemCount: 4, tracked: false })
const LIBRARY = [entry('book', 1), entry('book', 2), entry('movie', 1)]

type State = 'chosen' | 'loading' | 'out'

async function openBrowser(page: Page, state: State, { theme = 'exzed', skin = 'exzed-1d', width = 1440, height = 900 } = {}) {
  await page.setViewportSize({ width, height })
  await useHomeFixture(page)
  await page.route('**/api/library/untracked', (route) => route.fulfill({ json: { entries: [LIBRARY[0]], reachable: true } }))
  await page.route('**/api/library', async (route) => {
    // Loading: the answer never comes. Out of reach: it comes, and says so. Otherwise the library, with nothing picked.
    if (state === 'loading') return new Promise<void>(() => {})
    await route.fulfill({ json: { entries: state === 'out' ? [] : LIBRARY, reachable: state !== 'out' } })
  })
  await page.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
    } catch {
      return
    }
    for (const [key, value] of entries as [string, string][]) localStorage.setItem(key, value)
  }, Object.entries({ skin: 'dark-orange', reducedMotion: 'true', theme, exzedSkin: skin }))
  await page.goto('/')
  await page.getByRole('button', { name: 'New List' }).click()
  await page.getByRole('button', { name: en.quantum.vaultShelf.browse }).click()
  await page.locator('.q-vb-empty').waitFor()
  await page.evaluate(() => document.fonts.ready)
  if (state !== 'loading') await page.waitForLoadState('networkidle')
}

const colourOf = (value: string): Colour => {
  const css = value.trim()
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css)
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)]
  const rgb = /^rgba?\((\d+), (\d+), (\d+)/.exec(css)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  throw new Error(`not a colour: ${value}`)
}

const groundOf = (locator: Locator) =>
  locator.evaluate((element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const value = getComputedStyle(node).backgroundColor
      const alpha = /^rgba\(\d+, \d+, \d+, ([\d.]+)\)$/.exec(value)
      if (value !== 'rgba(0, 0, 0, 0)' && (!alpha || Number(alpha[1]) > 0)) return value
    }

    return 'rgb(0, 0, 0)'
  })

const rectOf = (locator: Locator) => locator.evaluate((element) => element.getBoundingClientRect().toJSON() as { left: number; top: number; right: number; bottom: number; width: number; height: number })
const progress = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zx-prog-dim'))

/** The door's box as a screenshot shows it against the file at 3x: the pane's ground and the opaque pixels in the progress colour. Device pixels; the engine's snapping of where the box starts is the one liberty. */
async function wrong(page: Page, at: { left: number; top: number; right: number; bottom: number }, ground: Colour, ink: Colour) {
  const r = await page.evaluate(() => window.devicePixelRatio)
  const x0 = Math.ceil(at.left)
  const y0 = Math.ceil(at.top)
  const clip = { x: x0, y: y0, width: Math.floor(at.right) - x0, height: Math.floor(at.bottom) - y0 }
  const seen = decodePng(await page.screenshot({ clip }))
  expect([seen.width, seen.height], 'the screenshot is the clip at the device ratio').toEqual([clip.width * r, clip.height * r])
  const block = 3 * r
  const lefts = [...new Set([Math.floor(at.left * r), Math.ceil(at.left * r)])]
  const tops = [...new Set([Math.floor(at.top * r), Math.ceil(at.top * r)])]
  const scores = lefts.flatMap((left) =>
    tops.map((top) => {
      let different = 0
      for (let dy = 0; dy < seen.height; dy++) {
        for (let dx = 0; dx < seen.width; dx++) {
          const u = Math.floor((x0 * r + dx - left) / block)
          const v = Math.floor((y0 * r + dy - top) / block)
          const shape = u >= 0 && u < door.width && v >= 0 && v < door.height && door.data[(v * door.width + u) * 4 + 3] === 255
          const expected = shape ? ink : ground
          const i = (dy * seen.width + dx) * 4
          if (seen.data[i] !== expected[0] || seen.data[i + 1] !== expected[1] || seen.data[i + 2] !== expected[2]) different++
        }
      }

      return different
    }),
  )

  return Math.min(...scores)
}

for (const state of ['chosen', 'loading', 'out'] as const) {
  test(`the door in the empty pane (${state}): 306x300, centred, 16px above the words, pixel for pixel in the progress colour`, async ({ page }) => {
    await openBrowser(page, state)
    const pane = page.locator('.q-vb-empty')
    const at = page.locator('.q-vb-door')
    await expect(at).toHaveCount(1)
    await expect(page.locator('.q-vb-art')).toHaveCount(0)

    const box = await rectOf(at)
    const area = await rectOf(pane)
    const words = await rectOf(page.locator('.q-vb-message'))
    expect([box.width, box.height]).toEqual([306, 300])
    expect(Math.abs(box.left + box.width / 2 - (area.left + area.width / 2)), 'centred across the pane').toBeLessThan(1)
    expect(words.top - box.bottom, '16px between the door and the words').toBeCloseTo(16, 0)
    expect(box.top, 'the door is inside the pane').toBeGreaterThanOrEqual(area.top)
    expect(await wrong(page, box, colourOf(await groundOf(page.locator(".q-vb-empty"))), colourOf(await progress(page))), 'pixels that are not the door').toBe(0)
    // The words and the live region are the pane's own.
    await expect(page.locator('.q-vb-message')).toHaveAttribute('role', 'status')
  })
}

for (const skin of SKINS) {
  test(`${skin}: the door is that skin's progress colour`, async ({ page }) => {
    await openBrowser(page, 'chosen', { skin })
    const at = page.locator('.q-vb-door')
    const ink = colourOf(await progress(page))

    expect(colourOf(await at.evaluate((element) => getComputedStyle(element).backgroundColor))).toEqual(ink)
    expect(await wrong(page, await rectOf(at), colourOf(await groundOf(page.locator(".q-vb-empty"))), ink)).toBe(0)
  })
}

test('Quantum keeps its line drawing, no door, and never asks for the door’s file; under eX-Zed the file is asked for', async ({ page, browser }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('vault-door')) asked.push(request.url())
  })
  await openBrowser(page, 'chosen')
  await page.waitForLoadState('networkidle')
  expect(asked.length).toBeGreaterThan(0)

  const quantum = await browser.newPage()
  const askedInQuantum: string[] = []
  quantum.on('request', (request) => {
    if (request.url().includes('vault-door')) askedInQuantum.push(request.url())
  })
  await openBrowser(quantum, 'chosen', { theme: 'quantum' })
  await quantum.waitForLoadState('networkidle')
  expect(askedInQuantum).toEqual([])
  expect(await quantum.locator('.q-vb-door').count()).toBe(0)
  expect(await quantum.locator('.q-vb-art svg').count()).toBe(1)
  await quantum.close()
})

test('choosing a category takes the door away with the empty pane', async ({ page }) => {
  await openBrowser(page, 'chosen')
  await page.locator('.q-vb-cat', { hasText: 'Books' }).click()

  await expect(page.locator('.q-vb-door')).toHaveCount(0)
})
