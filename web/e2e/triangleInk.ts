import { inflateSync } from 'node:zlib'
import type { Page } from '@playwright/test'

/**
 * Where a triangle's ink sits against the ink of the text beside it, read from pixels (canvas H-027: "the triangle's middle on the middle of the text's
 * cap height", within 0.5px). The layout cannot say: a font's ascent is rounded by the engine, so a baseline worked out from metrics was off by up to
 * 0.8px in the spike (task 47.0), while the pixels agree with what a person sees. The spec that calls this sets `deviceScaleFactor: 4`, so a pixel is a
 * quarter of a CSS pixel.
 *
 * The first capital of the text is the ruler: a round one ("C", "S") overshoots top and bottom alike, so its middle is the cap middle all the same.
 */
export interface Raster {
  width: number
  height: number
  /** RGBA, row after row. */
  data: Uint8Array
}

/** Just enough PNG for a Playwright screenshot: 8 bits, RGB or RGBA, not interlaced. */
export function decodePng(file: Buffer): Raster {
  let at = 8
  let width = 0
  let height = 0
  let colorType = 0
  const parts: Buffer[] = []
  while (at < file.length) {
    const length = file.readUInt32BE(at)
    const kind = file.toString('ascii', at + 4, at + 8)
    const body = file.subarray(at + 8, at + 8 + length)
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[12] !== 0) throw new Error('only 8-bit, non-interlaced PNG')
      colorType = body[9] ?? 0
    } else if (kind === 'IDAT') parts.push(body)
    else if (kind === 'IEND') break
    at += 12 + length
  }
  if (colorType !== 2 && colorType !== 6) throw new Error(`PNG colour type ${colorType} is not RGB or RGBA`)
  const bytes = colorType === 6 ? 4 : 3
  const stride = width * bytes
  const raw = inflateSync(Buffer.concat(parts))
  const out = new Uint8Array(width * height * 4)
  let above = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const kind = raw[y * (stride + 1)] ?? 0
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const left = i >= bytes ? (row[i - bytes] ?? 0) : 0
      const up = above[i] ?? 0
      const upLeft = i >= bytes ? (above[i - bytes] ?? 0) : 0
      const base = line[i] ?? 0
      let add = 0
      if (kind === 1) add = left
      else if (kind === 2) add = up
      else if (kind === 3) add = (left + up) >> 1
      else if (kind === 4) {
        const guess = left + up - upLeft
        const toLeft = Math.abs(guess - left)
        const toUp = Math.abs(guess - up)
        const toUpLeft = Math.abs(guess - upLeft)
        add = toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft
      }
      row[i] = (base + add) & 255
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      out[o] = row[x * bytes] ?? 0
      out[o + 1] = row[x * bytes + 1] ?? 0
      out[o + 2] = row[x * bytes + 2] ?? 0
      out[o + 3] = bytes === 4 ? (row[x * bytes + 3] ?? 255) : 255
    }
    above = row
  }

  return { width, height, data: out }
}

/** The commonest colour along the picture's edge: the ground the row is drawn on. */
function groundOf(png: Raster): number[] {
  const seen = new Map<string, number>()
  const add = (x: number, y: number) => {
    const o = (y * png.width + x) * 4
    const key = [png.data[o], png.data[o + 1], png.data[o + 2]].join(',')
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  for (let x = 0; x < png.width; x++) {
    add(x, 0)
    add(x, png.height - 1)
  }
  for (let y = 0; y < png.height; y++) {
    add(0, y)
    add(png.width - 1, y)
  }
  const [best] = [...seen.entries()].sort((a, b) => b[1] - a[1])

  return (best?.[0] ?? '0,0,0').split(',').map(Number)
}

/** The first and last pixel row that hold ink in a box (a pixel is ink when at least half as strong as the strongest in the box); null when none. */
export function inkRows(png: Raster, box: { x0: number; x1: number; y0: number; y1: number }): { top: number; bottom: number } | null {
  const ground = groundOf(png)
  const xa = Math.max(0, Math.floor(box.x0))
  const xb = Math.min(png.width, Math.ceil(box.x1))
  const ya = Math.max(0, Math.floor(box.y0))
  const yb = Math.min(png.height, Math.ceil(box.y1))
  const strength = (x: number, y: number) => {
    const o = (y * png.width + x) * 4
    return Math.abs((png.data[o] ?? 0) - (ground[0] ?? 0)) + Math.abs((png.data[o + 1] ?? 0) - (ground[1] ?? 0)) + Math.abs((png.data[o + 2] ?? 0) - (ground[2] ?? 0))
  }
  let strongest = 0
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) strongest = Math.max(strongest, strength(x, y))
  if (strongest < 40) return null
  let top = -1
  let bottom = -1
  for (let y = ya; y < yb; y++) {
    let ink = false
    for (let x = xa; x < xb; x++) if (strength(x, y) >= strongest / 2) ink = true
    if (ink) {
      if (top < 0) top = y
      bottom = y
    }
  }

  return top < 0 ? null : { top, bottom }
}

export interface InkSpec {
  /** The row to photograph: it holds both the triangle and the text. */
  row: string
  /** The triangle, inside the row. */
  triangle: string
  /** The text beside it, inside the row: its first letter is the ruler. */
  text: string
  /** Inside the row, an element whose own text is skipped (the triangle's box, when it has some). */
  skip?: string
}

export interface InkReading {
  /** The triangle's ink middle minus the first capital's ink middle, in CSS px. Positive: the triangle is LOW. */
  delta: number
  /** The triangle's ink height and the capital's, in CSS px (a sanity check: the triangle's own height, a cap height). */
  triangleHeight: number
  letterHeight: number
}

/** Photographs the row at the page's own scale (an element screenshot scrolls it into view, so the boxes are read after it) and compares the two inks. */
export async function readInk(page: Page, spec: InkSpec): Promise<InkReading> {
  const row = page.locator(spec.row).first()
  const png = decodePng(await row.screenshot({ scale: 'device' }))
  const found = await row.evaluate(
    (node, s) => {
      const origin = node.getBoundingClientRect()
      const tri = node.querySelector(s.triangle)!.getBoundingClientRect()
      const holder = node.querySelector(s.text)!
      const skip = s.skip ? node.querySelector(s.skip) : null
      const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT)
      let text: Text | null = null
      for (let next = walker.nextNode(); next; next = walker.nextNode()) {
        if ((next.textContent ?? '').trim() && !(skip && skip.contains(next))) {
          text = next as Text
          break
        }
      }
      if (!text) throw new Error(`no text in ${s.text}`)
      const first = text.textContent!.search(/\S/)
      const range = document.createRange()
      range.setStart(text, first)
      range.setEnd(text, first + 1)
      const letter = range.getClientRects()[0]!

      return {
        scale: window.devicePixelRatio,
        tri: { x: tri.x - origin.x, y: tri.y - origin.y, w: tri.width, h: tri.height },
        letter: { x: letter.x - origin.x, y: letter.y - origin.y, w: letter.width, h: letter.height },
      }
    },
    spec,
  )
  const k = found.scale
  const tri = inkRows(png, { x0: found.tri.x * k, x1: (found.tri.x + found.tri.w) * k, y0: (found.tri.y - 1) * k, y1: (found.tri.y + found.tri.h + 1) * k })
  const letter = inkRows(png, { x0: found.letter.x * k, x1: (found.letter.x + found.letter.w) * k, y0: found.letter.y * k, y1: (found.letter.y + found.letter.h) * k })
  if (!tri || !letter) throw new Error(`no ink found for ${spec.row} (triangle ${JSON.stringify(tri)}, letter ${JSON.stringify(letter)})`)
  const middle = (rows: { top: number; bottom: number }) => (rows.top + rows.bottom + 1) / 2 / k

  return {
    delta: Math.round((middle(tri) - middle(letter)) * 100) / 100,
    triangleHeight: (tri.bottom - tri.top + 1) / k,
    letterHeight: (letter.bottom - letter.top + 1) / k,
  }
}
