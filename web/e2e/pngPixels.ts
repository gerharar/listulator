import { inflateSync } from 'node:zlib'

/**
 * A PNG as RGBA bytes, for the tests that read a picture's pixels (a screenshot against the art file it should show). Not interlaced; grey, RGB, palette (any depth:
 * the two stone walls are 1-bit palette pictures), grey with alpha or RGBA, at 8 bits (1, 2 and 4 for grey and palette). Anything else throws: nothing reads it here.
 */
export interface Pixels {
  width: number
  height: number
  /** `width * height * 4` bytes, R G B A. */
  data: Uint8Array
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function decodePng(file: Buffer): Pixels {
  if (file.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG')
  let at = 8
  let width = 0
  let height = 0
  let depth = 0
  let colour = 0
  let palette: Buffer = Buffer.alloc(0)
  let transparency: Buffer = Buffer.alloc(0)
  const chunks: Buffer[] = []
  while (at < file.length) {
    const length = file.readUInt32BE(at)
    const type = file.toString('ascii', at + 4, at + 8)
    const body = file.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]!
      colour = body[9]!
      if (body[12] !== 0) throw new Error('unsupported PNG: interlaced')
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') transparency = body
    else if (type === 'IDAT') chunks.push(body)
    at += 12 + length
  }
  const channels = CHANNELS[colour]
  if (channels === undefined) throw new Error(`unsupported PNG colour type ${colour}`)
  if (depth !== 8 && !((colour === 0 || colour === 3) && (depth === 1 || depth === 2 || depth === 4))) throw new Error(`unsupported PNG: colour type ${colour} at depth ${depth}`)

  // Bytes to a line, and the distance a filter looks back (a whole byte at least).
  const stride = Math.ceil((width * channels * depth) / 8)
  const step = Math.max(1, (channels * depth) / 8)
  const raw = inflateSync(Buffer.concat(chunks))
  const lines: Uint8Array[] = []
  let previous: Uint8Array = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const a = i >= step ? line[i - step]! : 0
      const b = previous[i]!
      const c = i >= step ? previous[i - step]! : 0
      if (filter === 1) line[i] = (line[i]! + a) & 255
      else if (filter === 2) line[i] = (line[i]! + b) & 255
      else if (filter === 3) line[i] = (line[i]! + ((a + b) >> 1)) & 255
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        line[i] = (line[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
    }
    lines.push(line)
    previous = line
  }

  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const line = lines[y]!
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4
      if (depth < 8) {
        // 1, 2 or 4 bits to a pixel, the first pixel in the high bits.
        const bit = x * depth
        const value = (line[bit >> 3]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
        if (colour === 3) data.set([palette[value * 3]!, palette[value * 3 + 1]!, palette[value * 3 + 2]!, value < transparency.length ? transparency[value]! : 255], to)
        else data.set([(value * 255) / ((1 << depth) - 1), (value * 255) / ((1 << depth) - 1), (value * 255) / ((1 << depth) - 1), 255], to)
      } else if (colour === 3) {
        const value = line[x]!
        data.set([palette[value * 3]!, palette[value * 3 + 1]!, palette[value * 3 + 2]!, value < transparency.length ? transparency[value]! : 255], to)
      } else if (channels === 1 || channels === 2) {
        data.set([line[x * channels]!, line[x * channels]!, line[x * channels]!, channels === 2 ? line[x * channels + 1]! : 255], to)
      } else {
        const from = x * channels
        data.set([line[from]!, line[from + 1]!, line[from + 2]!, channels === 4 ? line[from + 3]! : 255], to)
      }
    }
  }

  return { width, height, data }
}

/** The pixel at (x, y) as `[r, g, b]`, a transparent one composited on `ground` (a picture's alpha over what is under it). */
export function pixelOver(pixels: Pixels, x: number, y: number, ground: readonly [number, number, number]): [number, number, number] {
  const at = (y * pixels.width + x) * 4
  const alpha = pixels.data[at + 3]! / 255

  return [0, 1, 2].map((channel) => Math.round(pixels.data[at + channel]! * alpha + ground[channel]! * (1 - alpha))) as [number, number, number]
}
