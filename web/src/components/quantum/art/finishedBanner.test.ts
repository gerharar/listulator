import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FINISHED_BANDS, finishedBands } from './finishedBanner.js'

/**
 * The finished list's banner (57.11c; design's D64): the bar's rule drawn to the banner's box. Four bands, each a quarter of the box's width, red, yellow, green, cyan from the left; every edge slants
 * 45 degrees the bar's way (each 2px row down, 2px to the left) and crosses its quarter point at the box's middle row; all on the 2px grid. The same function must draw design's own two bar files, so the bar
 * is the proof of the rule: if it reproduces them rect for rect, it is the bar's rule.
 */
const art = (file: string) => {
  const svg = readFileSync(new URL(`../../../styles/theme/art/${file}`, import.meta.url), 'utf8')
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="2" fill="(#[0-9a-f]{6})"><\/rect>/g)].map((m) => ({ x: +m[1]!, y: +m[2]!, width: +m[3]!, fill: m[4]! }))

  return rects
}

const flat = (width: number, height: number) => finishedBands(width, height).flatMap((row) => row.bands.map((band) => ({ x: band.x, y: row.y, width: band.width, fill: band.fill })))

describe('finishedBands: the bar’s rule at any box', () => {
  it('names the Spectrum’s bands in order', () => {
    expect(FINISHED_BANDS).toEqual(['#ff0000', '#ffff00', '#00ff00', '#00ffff'])
  })

  it.each([
    ['finished-bar-160x16.svg', 160, 16],
    ['finished-bar-320x24.svg', 320, 24],
  ] as const)('draws design’s own %s, rect for rect, at %ix%i', (file, width, height) => {
    expect(flat(width, height)).toEqual(art(file))
  })

  it('has one row of four bands for every 2px of height, each filling the box’s width', () => {
    const rows = finishedBands(386, 106)

    expect(rows).toHaveLength(53)
    rows.forEach((row, n) => {
      expect(row.y).toBe(n * 2)
      expect(row.bands.map((band) => band.fill)).toEqual(FINISHED_BANDS)
      expect(row.bands.reduce((sum, band) => sum + band.width, 0)).toBe(386)
      expect(row.bands[0]!.x).toBe(0)
    })
  })

  it('puts every edge at its quarter of the width on the middle row, 2px further left on each row down', () => {
    const rows = finishedBands(400, 100)
    const middle = rows[25]!
    expect(middle.bands.map((band) => band.x)).toEqual([0, 100, 200, 300])
    expect(rows[26]!.bands.map((band) => band.x)).toEqual([0, 98, 198, 298])
    expect(rows[24]!.bands.map((band) => band.x)).toEqual([0, 102, 202, 302])
  })

  it('keeps every edge on the 2px grid, a quarter that is not on it rounded to the grid', () => {
    for (const row of finishedBands(386, 106)) for (const band of row.bands) expect(band.x % 2, `x ${band.x} on row ${row.y}`).toBe(0)
    expect(finishedBands(386, 106)[26]!.bands.map((band) => band.x)).toEqual([0, 96, 194, 290])
  })

  it('never lets a band leave the box or go negative, however steep the slant runs on a tall box', () => {
    for (const row of finishedBands(200, 240)) {
      row.bands.forEach((band, at) => {
        expect(band.width, `row ${row.y} band ${at}`).toBeGreaterThanOrEqual(0)
        expect(band.x + band.width).toBeLessThanOrEqual(200)
      })
    }
  })
})
