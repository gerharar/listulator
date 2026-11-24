import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declarations, read } from './cssGuard.js'

/**
 * The progress bar under eX-Zed (57.11a; X-008, the ProgressBar card, D22). The card's own CSS is `.zx-bar`: a 2px frame of `chip-ink` round a 160x16 inside (320x24 in the list header), the fill `prog` in whole steps
 * of 8px (16px), the rest the 2px dither (a 4px tile of `prog-dim` and `paper`). The e2e spec reads the pixels; this reads the stylesheet, so a rule that brings back Quantum's cells, mask or size fails here by name.
 */
const FILE = 'styles/theme/exzed-progress.css'

const of = (selector: string): Record<string, string> =>
  Object.fromEntries(
    declarations(read(FILE))
      .filter((d) => d.selector === selector)
      .map((d) => [d.property, d.value]),
  )

describe('the eX-Zed progress bar', () => {
  it('is 160x16 inside a 2px chip-ink frame, with no mask cutting it into cells', () => {
    expect(of('html.theme-exzed .q-meter')).toMatchObject({ 'box-sizing': 'content-box', width: '160px', height: '16px', border: '2px solid var(--zx-chip-ink)', '-webkit-mask-image': 'none', 'mask-image': 'none' })
  })

  it('is 320x24 in the list header', () => {
    expect(of('html.theme-exzed .q-meter.lg')).toMatchObject({ width: '320px', height: '24px' })
  })

  it('fills in whole steps of 8px (16px in the header) of solid prog, the rest the 2px dither of prog-dim and paper', () => {
    const dither = 'repeating-conic-gradient(var(--zx-prog-dim) 0 25%, var(--zx-paper) 0 50%)'
    expect(of('html.theme-exzed .q-meter:not(.full)')).toMatchObject({
      'background-image': `linear-gradient(90deg, var(--zx-prog) 0 calc(var(--f) * 8px), transparent calc(var(--f) * 8px)), ${dither}`,
      'background-size': '100% 100%, 4px 4px',
    })
    expect(of('html.theme-exzed .q-meter.lg:not(.full)')['background-image']).toBe(`linear-gradient(90deg, var(--zx-prog) 0 calc(var(--f) * 16px), transparent calc(var(--f) * 16px)), ${dither}`)
  })

  it('sets the dot between the parts on a 24px line, so the progress line (as tall as its bar) puts nothing on a half pixel', () => {
    expect(of('html.theme-exzed .q-progress .q-sep')).toMatchObject({ 'line-height': '24px' })
  })

  it('draws the percentage of a finished list in ink: there is no gold here', () => {
    expect(of('html.theme-exzed .q-pct.full')).toMatchObject({ color: 'var(--zx-ink)' })
  })
})

/**
 * The finished bar (57.11b; X-008, the Progress assets, `.zx-bar.done`): one run of the Spectrum's four bands, red, yellow, green, cyan, slanted 45 degrees on the 2px grid, drawn by two SVG files design drew
 * (160x16 for a Home row and a group head, 320x24 for the list header) and kept byte for byte. The card sets them on the inside at 0 0, no repeat, at their own size.
 */
const ART = join(import.meta.dirname, 'art')
const BANDS = ['#ff0000', '#ffff00', '#00ff00', '#00ffff']

function rows(file: string): { width: number; height: number; rows: Array<Array<{ x: number; width: number; fill: string }>> } {
  const svg = readFileSync(join(ART, file), 'utf8')
  const [width, height] = [Number(/width="(\d+)"/.exec(svg)![1]), Number(/height="(\d+)"/.exec(svg)![1])]
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9a-f]{6})"><\/rect>/g)].map((m) => ({ x: +m[1]!, y: +m[2]!, width: +m[3]!, height: +m[4]!, fill: m[5]! }))
  expect(rects.every((rect) => rect.height === 2), `${file}: every rect is one 2px row`).toBe(true)
  const byRow = Array.from({ length: height / 2 }, (_, n) => rects.filter((rect) => rect.y === n * 2).map(({ x, width: w, fill }) => ({ x, width: w, fill })))

  return { width, height, rows: byRow }
}

describe('the finished bar’s art (design’s two SVGs, byte for byte)', () => {
  it.each([
    ['finished-bar-160x16.svg', 160, 16],
    ['finished-bar-320x24.svg', 320, 24],
  ] as const)('%s is %ix%i: four bands in the Spectrum’s order on every 2px row, each row’s edges 2px left of the one above (45 degrees on the grid)', (file, width, height) => {
    const art = rows(file)

    expect([art.width, art.height]).toEqual([width, height])
    art.rows.forEach((row, n) => {
      expect(row.map((band) => band.fill), `${file} row ${n}: the order`).toEqual(BANDS)
      expect(row.reduce((sum, band) => sum + band.width, 0), `${file} row ${n}: the bands fill the row`).toBe(width)
      expect(
        row.map((band) => band.x),
        `${file} row ${n}: each edge is 2px left of the row above`,
      ).toEqual(art.rows[0]!.map((band, at) => (at === 0 ? 0 : band.x - 2 * n)))
    })
  })
})

describe('the eX-Zed finished bar (the stripe replaces the solid ok)', () => {
  it('draws the 160x16 stripe on the inside, once, at its own size', () => {
    expect(of('html.theme-exzed .q-meter.full')).toMatchObject({
      'background-image': "url('./art/finished-bar-160x16.svg')",
      'background-size': '160px 16px',
      'background-position': '0 0',
      'background-repeat': 'no-repeat',
    })
  })

  it('draws the 320x24 stripe in the list header', () => {
    expect(of('html.theme-exzed .q-meter.lg.full')).toMatchObject({
      'background-image': "url('./art/finished-bar-320x24.svg')",
      'background-size': '320px 24px',
    })
  })
})

