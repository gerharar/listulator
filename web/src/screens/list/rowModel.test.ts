import { describe, expect, it } from 'vitest'
import type { ListGroup, ListItem } from '../../lib/api.js'
import {
  GROUP_HEIGHT,
  ITEM_HEIGHT,
  VIRTUALIZE_FROM,
  buildRowModel,
  offsetOf,
  shouldVirtualize,
  windowSlices,
  type RowModel,
  type Slice,
} from './rowModel.js'
import type { SpineUnit } from './spine.js'

/** The list as the screen holds it after filtering: units with the members that are shown, and which groups are shut. */
interface Shown {
  unit: SpineUnit
  members: ListItem[]
}

const item = (id: string): ListItem => ({ id, title: id }) as ListItem
const group = (id: string): ListGroup => ({ id, name: id }) as ListGroup

const loose = (id: string): Shown => ({ unit: { kind: 'item', item: item(id) }, members: [] })
const block = (id: string, count: number): Shown => {
  const members = Array.from({ length: count }, (_, n) => item(`${id}.${n}`))
  return { unit: { kind: 'group', group: group(id), items: members } as SpineUnit, members }
}
const noneShut = () => false
const shut = (...names: string[]) => (name: string) => names.includes(name)

describe('rowModel: heights and offsets', () => {
  it('an item is 46px, a group header 47px, and a group is its header plus its open members', () => {
    const model = buildRowModel([loose('a'), block('G', 3), loose('b')], noneShut)

    expect([ITEM_HEIGHT, GROUP_HEIGHT]).toEqual([46, 47])
    expect(model.total).toBe(46 + (47 + 3 * 46) + 46)
    expect(model.units.map((unit) => [unit.key, unit.top, unit.height])).toEqual([
      ['a', 0, 46],
      ['G', 46, 47 + 3 * 46],
      ['b', 46 + 47 + 3 * 46, 46],
    ])
  })

  it('a shut group is its header alone, and its members have no place', () => {
    const model = buildRowModel([block('G', 5), loose('x')], shut('G'))

    expect(model.units[0]!.height).toBe(47)
    expect(model.total).toBe(47 + 46)
    expect(offsetOf(model, 'G.2')).toBeUndefined()
  })

  it('knows where every row starts: loose items, headers and members', () => {
    const model = buildRowModel([loose('a'), block('G', 3), loose('b')], noneShut)

    expect(offsetOf(model, 'a')).toBe(0)
    expect(offsetOf(model, 'G')).toBe(46)
    expect(offsetOf(model, 'G.0')).toBe(46 + 47)
    expect(offsetOf(model, 'G.2')).toBe(46 + 47 + 2 * 46)
    expect(offsetOf(model, 'b')).toBe(46 + 47 + 3 * 46)
    expect(offsetOf(model, 'nope')).toBeUndefined()
  })

  it('an empty list has no height, and an empty group is its header', () => {
    expect(buildRowModel([], noneShut).total).toBe(0)
    expect(buildRowModel([block('G', 0)], noneShut).total).toBe(47)
  })
})

describe('shouldVirtualize', () => {
  it('is on from 200 rows, in auto, and never when switched off', () => {
    expect(VIRTUALIZE_FROM).toBe(200)
    expect(shouldVirtualize(199, 'auto')).toBe(false)
    expect(shouldVirtualize(200, 'auto')).toBe(true)
    expect(shouldVirtualize(50_000, 'auto')).toBe(true)
    expect(shouldVirtualize(50_000, 'off')).toBe(false)
  })
})

/** Reads the slices back as the rows they draw, in order, with each spacer as `~height`. */
function drawn(slices: Slice[], shown: Shown[]): string[] {
  const out: string[] = []
  for (const slice of slices) {
    if (slice.kind === 'spacer') out.push(`~${slice.height}`)
    else if (slice.kind === 'item') out.push((shown[slice.unitIndex]!.unit as { item: ListItem }).item.id)
    else {
      out.push(`[${(shown[slice.unitIndex]!.unit as { group: ListGroup }).group.id}`)
      for (const part of slice.parts) {
        if (part.kind === 'spacer') out.push(`~${part.height}`)
        else for (let n = part.from; n < part.to; n += 1) out.push(shown[slice.unitIndex]!.members[n]!.id)
      }
      out.push(']')
    }
  }

  return out
}

/** Every height drawn: loose rows, headers, member rows and spacers. */
function drawnHeight(slices: Slice[]): number {
  let total = 0
  for (const slice of slices) {
    if (slice.kind === 'spacer') total += slice.height
    else if (slice.kind === 'item') total += ITEM_HEIGHT
    else {
      total += slice.header ? GROUP_HEIGHT : 0
      for (const part of slice.parts) total += part.kind === 'spacer' ? part.height : (part.to - part.from) * ITEM_HEIGHT
    }
  }

  return total
}

const everything = { enabled: true, overscan: 0, pinned: new Set<string>() } as const

describe('windowSlices: what is drawn', () => {
  it('draws the whole list, with no spacers, when it is off or when there is no viewport to measure', () => {
    const shown = [loose('a'), block('G', 2), loose('b')]
    const model = buildRowModel(shown, noneShut)
    const whole = ['a', '[G', 'G.0', 'G.1', ']', 'b']

    expect(drawn(windowSlices(model, { scrollTop: 0, height: 100 }, { ...everything, enabled: false }), shown)).toEqual(whole)
    expect(drawn(windowSlices(model, null, everything), shown)).toEqual(whole)
  })

  it('draws the rows in view and stands a spacer of the exact height for the rest', () => {
    const shown = Array.from({ length: 100 }, (_, n) => loose(`r${n}`))
    const model = buildRowModel(shown, noneShut)

    // 46px rows: a window from 460 to 920 is rows 10 to 19.
    const slices = windowSlices(model, { scrollTop: 460, height: 460 }, everything)

    expect(drawn(slices, shown)).toEqual(['~460', ...Array.from({ length: 10 }, (_, n) => `r${10 + n}`), `~${80 * 46}`])
    expect(drawnHeight(slices)).toBe(model.total)
  })

  it('the overscan draws that much more on each side', () => {
    const shown = Array.from({ length: 100 }, (_, n) => loose(`r${n}`))
    const model = buildRowModel(shown, noneShut)

    const slices = windowSlices(model, { scrollTop: 460, height: 460 }, { ...everything, overscan: 92 })

    expect(drawn(slices, shown).filter((entry) => !entry.startsWith('~'))).toEqual(Array.from({ length: 14 }, (_, n) => `r${8 + n}`))
  })

  it('a group crossing the window keeps its block and its header, and spacers fill the members that are not drawn', () => {
    const shown = [loose('a'), block('G', 100), loose('z')]
    const model = buildRowModel(shown, noneShut)

    // Inside the group's members: rows 50 to 54 of G.
    const top = 46 + 47 + 50 * 46
    const slices = windowSlices(model, { scrollTop: top, height: 5 * 46 }, everything)

    expect(drawn(slices, shown)).toEqual(['~46', '[G', `~${50 * 46}`, 'G.50', 'G.51', 'G.52', 'G.53', 'G.54', `~${45 * 46}`, ']', '~46'])
    expect(drawnHeight(slices)).toBe(model.total)
  })

  it('a group wholly outside the window is one spacer: its header is not drawn', () => {
    const shown = [block('G', 10), loose('a'), loose('b')]
    const model = buildRowModel(shown, noneShut)

    const slices = windowSlices(model, { scrollTop: 47 + 10 * 46, height: 46 }, everything)

    expect(drawn(slices, shown)).toEqual([`~${47 + 10 * 46}`, 'a', '~46'])
  })

  it('a shut group is drawn as its header alone', () => {
    const shown = [block('G', 10)]
    const model = buildRowModel(shown, shut('G'))

    expect(drawn(windowSlices(model, { scrollTop: 0, height: 200 }, everything), shown)).toEqual(['[G', ']'])
  })

  it('draws a pinned row wherever it is, with spacers either side, and keeps its group block', () => {
    const shown = [loose('a'), block('G', 100), loose('z')]
    const model = buildRowModel(shown, noneShut)

    // The window is at the top (row a); the pinned row is G.70, far below.
    const slices = windowSlices(model, { scrollTop: 0, height: 46 }, { ...everything, pinned: new Set(['G.70']) })

    expect(drawn(slices, shown)).toEqual(['a', '[G', `~${70 * 46}`, 'G.70', `~${29 * 46}`, ']', '~46'])
    expect(drawnHeight(slices)).toBe(model.total)
  })

  it('draws a pinned loose item and a pinned group header (a block being dragged)', () => {
    const shown = [loose('a'), loose('b'), block('G', 3), loose('c')]
    const model = buildRowModel(shown, noneShut)

    const slices = windowSlices(model, { scrollTop: 0, height: 10 }, { ...everything, pinned: new Set(['c', 'G']) })

    expect(drawn(slices, shown)).toEqual(['a', '~46', '[G', `~${3 * 46}`, ']', 'c'])
    expect(drawnHeight(slices)).toBe(model.total)
  })

  it('a scroll position past either end draws the nearest rows, not nothing', () => {
    const shown = Array.from({ length: 50 }, (_, n) => loose(`r${n}`))
    const model = buildRowModel(shown, noneShut)

    expect(drawn(windowSlices(model, { scrollTop: -500, height: 92 }, everything), shown).filter((entry) => !entry.startsWith('~'))).toEqual(['r0', 'r1'])
    expect(drawn(windowSlices(model, { scrollTop: 10_000_000, height: 92 }, everything), shown).filter((entry) => !entry.startsWith('~'))).toEqual(['r48', 'r49'])
  })
})

/** A small deterministic generator, so the property tests are the same on every run. */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function randomList(next: () => number): Shown[] {
  const shown: Shown[] = []
  const units = 1 + Math.floor(next() * 25)
  for (let n = 0; n < units; n += 1) shown.push(next() < 0.4 ? loose(`l${n}`) : block(`g${n}`, Math.floor(next() * 30)))

  return shown
}

describe('windowSlices: for any list and any window', () => {
  it('always draws every row that is in view, once, in order, and its spacers and rows add up to the whole list', () => {
    const next = random(12345)
    for (let trial = 0; trial < 300; trial += 1) {
      const shown = randomList(next)
      const closed = new Set(shown.filter((entry) => entry.unit.kind === 'group' && next() < 0.2).map((entry) => (entry.unit as { group: ListGroup }).group.name))
      const model = buildRowModel(shown, (name) => closed.has(name))
      const viewport = { scrollTop: Math.floor(next() * (model.total + 200)) - 100, height: 1 + Math.floor(next() * 600) }
      const overscan = Math.floor(next() * 300)

      const slices = windowSlices(model, viewport, { enabled: true, overscan, pinned: new Set() })
      const ids = drawn(slices, shown).filter((entry) => !entry.startsWith('~') && entry !== ']').map((entry) => entry.replace('[', ''))

      expect(new Set(ids).size).toBe(ids.length)
      expect(drawnHeight(slices)).toBe(model.total)
      // Every row that touches the viewport is drawn.
      for (const [id, top] of model.rowTops) {
        const height = model.rowHeights.get(id)!
        if (top + height > viewport.scrollTop && top < viewport.scrollTop + viewport.height) expect(ids).toContain(id)
      }
      // Order is the list's order.
      const order = [...model.rowTops.keys()]
      expect(ids.map((id) => order.indexOf(id))).toEqual([...ids.map((id) => order.indexOf(id))].sort((a, b) => a - b))
    }
  })
})

describe('windowSlices: cost', () => {
  it('builds the model of 50,000 rows and answers a window quickly (it runs on every scroll frame)', () => {
    const shown = Array.from({ length: 100 }, (_, n) => block(`g${n}`, 500))
    const started = performance.now()
    const model: RowModel = buildRowModel(shown, noneShut)
    const built = performance.now() - started

    const windowStart = performance.now()
    for (let n = 0; n < 100; n += 1) windowSlices(model, { scrollTop: n * 10_000, height: 900 }, { ...everything, overscan: 900 })
    const perWindow = (performance.now() - windowStart) / 100

    expect(model.total).toBe(100 * (47 + 500 * 46))
    expect(built).toBeLessThan(1500)
    expect(perWindow).toBeLessThan(15)
  })
})
