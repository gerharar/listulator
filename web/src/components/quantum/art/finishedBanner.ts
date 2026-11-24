/**
 * The finished list's header banner under eX-Zed (57.11c; X-008, design's D64): the finished bar's rule drawn to the banner's box. Four bands, each a quarter of the box's width, red, yellow, green and cyan from the
 * left; every edge slants 45 degrees the bar's way (each 2px row down, 2px to the left) and crosses its quarter point at the box's middle row; all on the 2px grid. The category's mask cuts the drawing, so the banner
 * keeps its shape. The same rule reproduces design's two bar files rect for rect (160 by 16 and 320 by 24), which `finishedBanner.test.ts` reads, so a bar and a banner are one drawing at two sizes.
 */
export const FINISHED_BANDS = ['#ff0000', '#ffff00', '#00ff00', '#00ffff'] as const

export interface FinishedBand {
  x: number
  width: number
  fill: string
}

export interface FinishedRow {
  y: number
  bands: FinishedBand[]
}

/** One row of 2px for each 2px of the box's height. The middle row is the one at index `floor(rows / 2)`: the bar's (row 4 of 8, row 6 of 12). */
export function finishedBands(width: number, height: number): FinishedRow[] {
  const rows = height / 2
  const middle = Math.floor(rows / 2)

  return Array.from({ length: rows }, (_, row) => {
    // The edges between the bands: the quarter points, rounded onto the 2px grid, then shifted 2px left for each row below the middle (2px right for each above it). Kept in order inside the box.
    const edges: number[] = []
    for (let quarter = 1; quarter <= 3; quarter++) {
      const slanted = Math.round((quarter * width) / 4 / 2) * 2 - 2 * (row - middle)
      edges.push(Math.min(width, Math.max(edges[quarter - 2] ?? 0, slanted)))
    }
    const starts = [0, ...edges]

    return {
      y: row * 2,
      bands: starts.map((x, band) => ({ x, width: (starts[band + 1] ?? width) - x, fill: FINISHED_BANDS[band]! })),
    }
  })
}
