import { describe, expect, it } from 'vitest'
import { staircaseGeometry } from './popoverTail.js'

/** The cells of a path of `M x y h w v h H x z` rectangles, as "x,y" keys. */
const cells = (path: string) => {
  const filled = new Set<string>()
  for (const [, x, y, w, h] of path.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)H\d+z/g)) {
    for (let dx = 0; dx < Number(w); dx++) for (let dy = 0; dy < Number(h); dy++) filled.add(`${Number(x) + dx},${Number(y) + dy}`)
  }

  return filled
}

describe('the eX-Zed popover tail (the Popover card): an 8x5 hollow staircase at 2px, 16x10', () => {
  it('points up as the card draws it: a rim of 10 cells and an 18-cell fill, the base row broken by the fill', () => {
    const up = staircaseGeometry('up')
    expect([up.width, up.height, up.viewBox]).toEqual([16, 10, '0 0 8 5'])
    expect(cells(up.rim).size).toBe(10)
    expect([...cells(up.fill)].sort()).toEqual(['1,3', '1,4', '2,2', '2,3', '2,4', '3,1', '3,2', '3,3', '3,4', '4,1', '4,2', '4,3', '4,4', '5,2', '5,3', '5,4', '6,3', '6,4'].sort())
    // The tip is the top row's two cells; the base row (y 4) is rim at both ends and fill between, so the card's border is broken there.
    expect(cells(up.rim).has('3,0') && cells(up.rim).has('4,0')).toBe(true)
    expect(cells(up.rim).has('0,4') && cells(up.rim).has('7,4')).toBe(true)
    for (let x = 1; x <= 6; x++) expect(cells(up.fill).has(`${x},4`), `fill at the base, x ${x}`).toBe(true)
  })

  it('points down by mirroring the rows, left and right by turning the grid a quarter', () => {
    const up = cells(staircaseGeometry('up').rim)
    const down = staircaseGeometry('down')
    expect([down.width, down.height, down.viewBox]).toEqual([16, 10, '0 0 8 5'])
    expect(cells(down.rim)).toEqual(new Set([...up].map((key) => { const [x, y] = key.split(',').map(Number) as [number, number]; return `${x},${4 - y}` })))

    const left = staircaseGeometry('left')
    expect([left.width, left.height, left.viewBox]).toEqual([10, 16, '0 0 5 8'])
    expect(cells(left.rim)).toEqual(new Set([...up].map((key) => { const [x, y] = key.split(',').map(Number) as [number, number]; return `${y},${x}` })))
    const right = staircaseGeometry('right')
    expect(cells(right.rim)).toEqual(new Set([...up].map((key) => { const [x, y] = key.split(',').map(Number) as [number, number]; return `${4 - y},${x}` })))
    expect(cells(left.fill).size).toBe(cells(staircaseGeometry('up').fill).size)
  })
})
