import { describe, expect, it } from 'vitest'
import { DUMP_PROPS, type DumpedElement, type PageDump } from '../../../e2e-tools/identity/dump.js'
import { summarise, sweepDump } from '../../../e2e-tools/identity/sweep.js'
import { declarations, read, stylesheets } from './cssGuard.js'

/**
 * The eX-Zed sweep (51.12, X-007): its rules over a dump, so the tool is tested like any other code (the screens it reads are `IDENTITY_MODE=sweep npm run identity`), and the one rule a dump cannot
 * carry, **red is the Delete confirms' alone**, as a read of the stylesheets: the colour is read in exactly one eX-Zed rule, `.q-btn.danger`, and the two Quantum places that read it are
 * the danger button (the confirm) and the ⋯ menu's Delete row, which eX-Zed draws in `ink`.
 */
const CLEAN: Record<string, string> = {
  'border-top-left-radius': '0px',
  'border-top-right-radius': '0px',
  'border-bottom-right-radius': '0px',
  'border-bottom-left-radius': '0px',
  'box-shadow': 'none',
  'text-shadow': 'none',
  filter: 'none',
  'backdrop-filter': 'none',
  opacity: '1',
  color: 'rgb(255, 255, 255)',
  'background-color': 'rgba(0, 0, 0, 0)',
  'border-top-color': 'rgb(1, 2, 3)',
  'border-right-color': 'rgb(1, 2, 3)',
  'border-bottom-color': 'rgb(1, 2, 3)',
  'border-left-color': 'rgb(1, 2, 3)',
  'outline-color': 'rgb(1, 2, 3)',
  fill: 'none',
  stroke: 'none',
  'background-image': 'none',
  content: 'normal',
  display: 'block',
  visibility: 'visible',
  'clip-path': 'none',
  'font-size': '16px',
  'font-weight': '400',
  'letter-spacing': 'normal',
}

function dumpOf(...elements: { path?: string; text?: string; rect?: [number, number, number, number]; style?: Record<string, string> }[]): PageDump {
  const styles = elements.map((element) => DUMP_PROPS.map((name) => ({ ...CLEAN, ...element.style })[name] ?? ''))

  return {
    props: [...DUMP_PROPS],
    styles,
    elements: elements.map((element, index): DumpedElement => {
      const entry: DumpedElement = { path: element.path ?? `>div:${index}`, style: index }
      if (element.rect !== undefined) entry.rect = element.rect
      if (element.text !== undefined) entry.text = element.text

      return entry
    }),
  }
}
const BOX: [number, number, number, number] = [0, 0, 100, 24]
const rules = (element: Parameters<typeof dumpOf>[0]) => sweepDump(dumpOf({ rect: BOX, ...element })).map((v) => v.rule)

describe('the sweep’s rules', () => {
  it('finds nothing wrong with text at 16px, weight 400, no spacing, drawn as opaque rings and flat colour', () => {
    expect(rules({ text: 'Hello', style: { 'box-shadow': 'rgb(0, 0, 0) 0px 0px 0px 4px, rgb(255, 0, 0) 0px 0px 0px 8px' } })).toEqual([])
    expect(rules({ text: 'Big', style: { 'font-size': '24px', 'letter-spacing': '0px' } })).toEqual([])
    expect(rules({ text: 'Huge', style: { 'font-size': '32px' } })).toEqual([])
  })

  it('names a radius on any corner', () => {
    expect(rules({ style: { 'border-bottom-left-radius': '3px' } })).toEqual(['radius'])
  })

  it('names a blurred, offset or translucent shadow, and any text shadow, filter or backdrop filter, and allows the opaque rings', () => {
    expect(rules({ style: { 'box-shadow': 'rgba(0, 0, 0, 0.18) 0px 10px 26px 0px' } })).toEqual(['shadow'])
    expect(rules({ style: { 'box-shadow': 'rgb(0, 0, 0) 0px 3px 0px 0px inset' } })).toEqual(['shadow'])
    expect(rules({ style: { 'text-shadow': 'rgb(0, 0, 0) 1px 1px 0px' } })).toEqual(['shadow'])
    expect(rules({ style: { filter: 'brightness(1.12)' } })).toEqual(['filter'])
    expect(rules({ style: { 'backdrop-filter': 'blur(4px)' } })).toEqual(['filter'])
  })

  it('names an opacity under 1 and a colour with a partial alpha anywhere, and lets full transparency and a solid pass', () => {
    expect(rules({ style: { opacity: '0.45' } })).toEqual(['opacity'])
    for (const property of ['color', 'background-color', 'border-top-color', 'outline-color', 'fill', 'stroke']) expect(rules({ style: { [property]: 'rgba(255, 0, 0, 0.5)' } }), property).toEqual(['alpha'])
    expect(rules({ style: { 'background-image': 'linear-gradient(rgba(0, 0, 0, 0.2), rgb(0, 0, 0))' } })).toEqual(['alpha'])
    expect(rules({ style: { 'background-image': 'repeating-conic-gradient(rgb(0, 0, 0) 0%, rgba(0, 0, 0, 0) 25%)' } })).toEqual([])
    expect(rules({ style: { color: 'rgba(255, 0, 0, 1)' } })).toEqual([])
  })

  it('names text that is not 16, 24 or 32px, is bold, or has letter-spacing, together when it is all three', () => {
    expect(rules({ text: 'x', style: { 'font-size': '14px' } })).toEqual(['size'])
    expect(rules({ text: 'x', style: { 'font-size': '12.5px' } })).toEqual(['size'])
    expect(rules({ text: 'x', style: { 'font-weight': '600' } })).toEqual(['weight'])
    expect(rules({ text: 'x', style: { 'letter-spacing': '0.72px' } })).toEqual(['spacing'])
    expect(rules({ text: 'x', style: { 'font-size': '11px', 'font-weight': '500', 'letter-spacing': '1.54px' } })).toEqual(['size', 'weight', 'spacing'])
  })

  it('does not look at what draws no text, or text that is not drawn: a hidden glyph at 0px, a hidden or clipped or 1px box, display none', () => {
    expect(rules({ style: { 'font-size': '14px' } }), 'no text of its own').toEqual([])
    for (const style of [{ 'font-size': '0px' }, { visibility: 'hidden' }, { display: 'none' }, { 'clip-path': 'inset(50%)' }] as Record<string, string>[]) expect(rules({ text: 'x', style: { 'font-size': '14px', ...style } }), JSON.stringify(style)).toEqual([])
    expect(sweepDump(dumpOf({ text: 'x', rect: [0, 0, 1, 1], style: { 'font-size': '14px' } }))).toEqual([])
  })

  it('looks at a pseudo-element that draws text from its content, and not one that draws a mask', () => {
    const drawn = sweepDump(dumpOf({ path: '>button::before', style: { content: '"["', 'font-size': '14px' } }))
    expect(drawn.map((v) => v.rule)).toEqual(['size'])
    expect(sweepDump(dumpOf({ path: '>div::before', style: { content: '""', 'font-size': '14px' } }))).toEqual([])
  })

  it('reports each as one line by the element’s own class, counted', () => {
    const lines = summarise(sweepDump(dumpOf(...[0, 1, 2].map((n) => ({ path: `>div.q-x:0>span.q-tile-src:${n}`, text: 'x', rect: BOX, style: { 'font-size': '12px' } })))))
    expect(lines).toEqual(['3 x size: span.q-tile-src (font-size 12px)'])
  })
})

describe('red is for the Delete confirms alone', () => {
  const theme = stylesheets().filter((path) => path.startsWith('styles/theme/exzed-') && path.endsWith('.css') && !['styles/theme/exzed-tokens.css', 'styles/theme/exzed-colours.css'].includes(path))

  it('is read, in eX-Zed’s own stylesheets, by the danger button’s rule and nothing else', () => {
    const readers = theme.flatMap((path) => declarations(read(path)).filter((d) => d.value.includes('--zx-danger')).map((d) => `${path}: ${d.selector}`))
    expect(readers.length).toBeGreaterThan(0)
    for (const reader of readers) expect(reader, reader).toMatch(/\.q-btn\.danger\b/)
  })

  it('is read in the app’s own stylesheets, through Quantum’s `--danger`, by the danger button and the ⋯ menu’s Delete row only', () => {
    const readers = stylesheets()
      .filter((path) => !path.startsWith('styles/'))
      .flatMap((path) => declarations(read(path)).filter((d) => /var\(--danger/.test(d.value)).map((d) => `${path}: ${d.selector}`))
    expect(readers.sort()).toEqual(['components/quantum/Button/Button.css: .q-btn.danger', 'components/quantum/Button/Button.css: .q-btn.danger', 'screens/list/ListMorePopover.css: .q-pop-menu .q-btn.warn'].sort())
  })

  it('draws the menu’s Delete row in ink under eX-Zed, not in the danger colour', () => {
    const rows = declarations(read('styles/theme/exzed-buttons.css')).filter((d) => d.property === 'color' && d.selector.split(',').some((part) => part.trim() === 'html.theme-exzed .q-kicker + .q-pop-menu .q-btn'))
    expect(rows.map((d) => d.value)).toEqual(['var(--zx-ink)'])
  })
})
