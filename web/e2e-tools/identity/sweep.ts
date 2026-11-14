import type { PageDump } from './dump.js'

/**
 * The eX-Zed sweep (51.12, X-007, design's X-004): the rules the theme keeps on **every element of every screen**, read from the same dump the identity tool takes, so a
 * screen that is not looked at by a family task's spec is looked at here. A rule is a property of the computed style, never of a stylesheet: this is what is drawn.
 *
 *  - **no radius** on any corner;
 *  - **no shadow** but the frame's rings: a `box-shadow` is `none` or solid rings of `0 0 0 Npx` in an opaque colour; no `text-shadow`, no `filter`, no `backdrop-filter`;
 *  - **no alpha and no fade:** `opacity` 1 everywhere, no colour (text, background, border, outline, fill, stroke or inside a gradient) with a partial alpha (a fully transparent one is
 *    "no colour", not a blend);
 *  - **type that sits on the pixel grid:** every element that draws text sets it at 16, 24 or 32px, at weight 400, with no letter-spacing, so a glyph's stem is a whole number of device pixels at 100%
 *    and at 200% (the font is an 8px grid: 2px a pixel at 16px). Text that is not drawn (a hidden glyph at 0px, a visually hidden live region) is not looked at;
 *  - **a live control is never the secondary grey** (design's D47, 2026-11-15): in the dark skins `ink2` is `#909090`, for text that only informs and for disabled controls; a control that reacts to
 *    the pointer is `ctl`. Read as a button (pointer cursor: a disabled one has `not-allowed`; a link is the colour of its sentence, design's Link card) whose own text, or whose icon or pseudo-element, is that grey. Lotus's `ink2` is its blue, the colour of
 *    `ctl`, so it cannot be told apart there and is not looked at.
 */
export interface Violation {
  /** The element, as the identity tool names it. */
  path: string
  rule: 'radius' | 'shadow' | 'filter' | 'opacity' | 'alpha' | 'size' | 'weight' | 'spacing' | 'control'
  detail: string
}

const RADII = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'] as const
const COLOURS = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'fill', 'stroke'] as const
const SIZES = new Set(['16px', '24px', '32px'])
const RING = /^rgb\(\d+, \d+, \d+\) 0px 0px 0px \d+px$/
const INK2_OF_THE_DARK_SKINS = 'rgb(144, 144, 144)'

/** The tag of a path's segment: `button.q-chip:2` is `button`. */
const tagOf = (segment: string): string => /^([a-z][a-z0-9-]*)/.exec(segment)?.[1] ?? ''

/** Whether this element is a button's own text, or an icon or pseudo-element drawn inside a control, as its path says (a clickable row's other text is not the control's). */
function controlPart(path: string, text: string | undefined): boolean {
  // A Hold My Beer shelf with no lists is dimmed as a disabled control is (D10, kept under D47): it stays `ink2` beside a shelf in `ink`.
  if (/\.none\b/.test(path)) return false
  const pseudo = /::\w+$/.test(path)
  const segments = path.replace(/::\w+$/, '').split('>').filter((segment) => segment !== '')
  const tags = segments.map(tagOf)
  const own = tags[tags.length - 1]!
  if (own === 'button') return text !== undefined || pseudo
  const inside = tags.slice(0, -1).includes('button')

  return inside && (pseudo || own === 'svg' || own === 'path')
}

/** Every `rgba(r, g, b, a)` in a value whose alpha is neither 0 (nothing) nor 1 (the colour). */
function partialAlpha(value: string): string[] {
  return [...value.matchAll(/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([\d.]+)\s*\)/g)].filter((match) => Number(match[1]) !== 0 && Number(match[1]) !== 1).map((match) => match[0])
}

/** A box that is not drawn on the screen as text: nothing to measure the pixel grid of. */
function notDrawn(get: (name: string) => string, rect: DumpedRect | undefined): boolean {
  if (get('display') === 'none' || get('visibility') === 'hidden') return true
  if (get('font-size') === '0px') return true
  if (get('clip-path') !== 'none') return true
  if (rect !== undefined && (rect[2] <= 1 || rect[3] <= 1)) return true

  return false
}
type DumpedRect = [number, number, number, number]

export function sweepDump(dump: PageDump): Violation[] {
  const column = new Map(dump.props.map((name, index) => [name, index]))
  const found: Violation[] = []

  for (const element of dump.elements) {
    const row = dump.styles[element.style]!
    const get = (name: string): string => row[column.get(name)!]!
    const add = (rule: Violation['rule'], detail: string) => found.push({ path: element.path, rule, detail })

    for (const corner of RADII) if (get(corner) !== '0px') add('radius', `${corner} ${get(corner)}`)

    if (get('cursor') === 'pointer' && controlPart(element.path, element.text)) {
      for (const name of ['color', 'background-color'] as const) if (get(name) === INK2_OF_THE_DARK_SKINS) add('control', `${name} ${get(name)}`)
    }

    const shadow = get('box-shadow')
    if (shadow !== 'none' && !shadow.split(/,\s*(?=rgb)/).every((ring) => RING.test(ring.trim()))) add('shadow', `box-shadow ${shadow}`)
    if (get('text-shadow') !== 'none') add('shadow', `text-shadow ${get('text-shadow')}`)
    if (get('filter') !== 'none') add('filter', `filter ${get('filter')}`)
    if (get('backdrop-filter') !== 'none') add('filter', `backdrop-filter ${get('backdrop-filter')}`)
    if (get('opacity') !== '1') add('opacity', `opacity ${get('opacity')}`)

    for (const name of COLOURS) {
      const bad = partialAlpha(get(name))
      if (bad.length > 0) add('alpha', `${name} ${bad.join(' ')}`)
    }
    const gradient = partialAlpha(get('background-image'))
    if (gradient.length > 0) add('alpha', `background-image ${gradient.join(' ')}`)

    // Text: its own, or a pseudo-element's `content`.
    const content = get('content')
    const drawsText = element.text !== undefined || (/^"[^"]/.test(content) && element.rect === undefined)
    if (!drawsText || notDrawn(get, element.rect)) continue
    if (!SIZES.has(get('font-size'))) add('size', `font-size ${get('font-size')}`)
    if (get('font-weight') !== '400') add('weight', `font-weight ${get('font-weight')}`)
    if (get('letter-spacing') !== 'normal' && get('letter-spacing') !== '0px') add('spacing', `letter-spacing ${get('letter-spacing')}`)
  }

  return found
}

/** The violations grouped by what they are and where, for a report: the element's own class (not its place in the page) and the rule, with how many. */
export function summarise(violations: readonly Violation[]): string[] {
  const counts = new Map<string, number>()
  for (const v of violations) {
    const last = v.path.split('>').pop()!.replace(/:\d+(?=(::\w+)?$)/, '')
    const key = `${v.rule}: ${last} (${v.detail})`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => `${n} x ${key}`)
}
