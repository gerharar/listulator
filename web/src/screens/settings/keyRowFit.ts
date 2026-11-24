/**
 * Whether an API-key row is wider than its column (design's D63, 57.10b): the sum of its parts' widths and the gaps between them, against the column. Under eX-Zed a row that is wider has its status
 * chip wrap under [Test], right-aligned with it. It is the sum, not what the browser laid out, because the layout depends on the wrapping this decides (the parts' own widths do not). Half a pixel is
 * forgiven: widths are measured at a fractional scale.
 */
export function keyRowOverflows(widths: readonly number[], gap: number, available: number): boolean {
  if (widths.length === 0) return false
  const needed = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1)

  return needed > available + 0.5
}
