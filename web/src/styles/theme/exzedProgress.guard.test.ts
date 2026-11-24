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
