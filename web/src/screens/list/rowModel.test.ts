import { describe, expect, it } from 'vitest'
import type { ListGroup, ListItem } from '../../lib/api.js'
import {
  GROUP_HEIGHT,
  ITEM_HEIGHT,
  VIRTUALIZE_FROM,
  buildRowModel,
  centreOn,
  offsetOf,
  revealScrollTop,
  scrollAfterChange,
  scrollAfterDrop,
  scrollKeepingUnit,
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

describe('centreOn and revealScrollTop: where to scroll to show a row', () => {
  const VH = 460
  // a: 0, the group G: 46 (header 47, 100 members from 93), b: 4693.
  const shown = [loose('a'), block('G', 100), loose('b')]
  const model = buildRowModel(shown, noneShut)
  const member = offsetOf(model, 'G.50')!

  /** The row sits wholly in the part of the viewport that the sticky header does not cover. */
  const inView = (scrollTop: number, top: number, covered: number) => top >= scrollTop + covered && top + ITEM_HEIGHT <= scrollTop + VH

  it('centres a row, below the sticky header of its group when it is a member', () => {
    const at = centreOn(model, 'G.50', VH)!

    expect(inView(at, member, GROUP_HEIGHT)).toBe(true)
    const above = member - (at + GROUP_HEIGHT)
    const below = at + VH - (member + ITEM_HEIGHT)
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1)
  })

  it('never scrolls above the top, and a row that is not in the model has no place to scroll to', () => {
    expect(centreOn(model, 'a', VH)).toBe(0)
    expect(centreOn(model, 'nope', VH)).toBeUndefined()
    expect(revealScrollTop(model, 'nope', 0, VH)).toBeUndefined()
  })

  it('leaves the scroll alone when the row is already in view', () => {
    expect(revealScrollTop(model, 'G.50', member - 200, VH)).toBe(member - 200)
    expect(revealScrollTop(model, 'a', 0, VH)).toBe(0)
  })

  it('a member under its group sticky header is not in view: the row is brought just below it', () => {
    expect(revealScrollTop(model, 'G.50', member - 10, VH)).toBe(member - GROUP_HEIGHT)
  })

  it('a row just below the view is brought in by the least scroll, a row far away is centred', () => {
    const nearBelow = revealScrollTop(model, 'G.50', member - VH, VH)!
    expect(nearBelow).toBe(member + ITEM_HEIGHT - VH)

    const far = revealScrollTop(model, 'b', 0, VH)!
    expect(far).toBe(centreOn(model, 'b', VH))
  })
})

describe('scrollAfterChange: the reader keeps their place when the rows change', () => {
  const VH = 460

  it('is the same position when nothing moved', () => {
    const shown = [loose('a'), block('G', 100), loose('b')]
    const model = buildRowModel(shown, noneShut)

    expect(scrollAfterChange(model, buildRowModel(shown, noneShut), 1473, VH)).toBe(1473)
  })

  // BL-110: a row moved or ticked under a reader whose view starts a pixel into a shut group above (the owner's Windows list, Volume 11
  // folded, Volume 12 open) used to snap the view back to that header, undoing the scroll that follows a keyboard move.
  it('a change that leaves the unit at the top of the view as it was keeps the position, a shut group included', () => {
    const shown = [loose('a'), block('G1', 10), block('G2', 100)]
    const before = buildRowModel(shown, shut('G1'))
    const after = buildRowModel(shown, shut('G1'))
    const at = offsetOf(before, 'G1')! + 1

    expect(scrollAfterChange(before, after, at, VH)).toBe(at)
  })

  it('a change that leaves an open group as it was keeps the position even in the last pixels of its last row', () => {
    const shown = [block('G', 20), loose('b')]
    const before = buildRowModel(shown, noneShut)
    const after = buildRowModel(shown, noneShut)
    const at = before.units[0]!.top + before.units[0]!.height - 5

    expect(scrollAfterChange(before, after, at, VH)).toBe(at)
  })

  it('folding the group the reader is inside puts its header at the top of the view', () => {
    const shown = [loose('a'), block('G', 100), loose('b')]
    const before = buildRowModel(shown, noneShut)
    const after = buildRowModel(shown, shut('G'))

    expect(scrollAfterChange(before, after, offsetOf(before, 'G.30')!, VH)).toBe(offsetOf(after, 'G'))
  })

  it('unfolding a group above the view moves the view by exactly what it opened', () => {
    const shown = [block('G1', 10), block('G2', 100)]
    const before = buildRowModel(shown, shut('G1'))
    const after = buildRowModel(shown, noneShut)
    const at = offsetOf(before, 'G2.20')! + 12

    expect(scrollAfterChange(before, after, at, VH)).toBe(at + 10 * ITEM_HEIGHT)
  })

  it('folding or unfolding a group below the view changes nothing', () => {
    const shown = [block('G1', 10), block('G2', 100)]
    const before = buildRowModel(shown, noneShut)

    expect(scrollAfterChange(before, buildRowModel(shown, shut('G2')), 100, VH)).toBe(100)
  })

  it('keeps a row at the same place in the view when a row above it goes', () => {
    const before = buildRowModel([loose('a'), loose('b'), loose('c')], noneShut)
    const after = buildRowModel([loose('b'), loose('c')], noneShut)

    // 14px into b.
    expect(scrollAfterChange(before, after, ITEM_HEIGHT + 14, VH)).toBe(14)
  })

  it('a group that shrinks keeps the reader at its last rows; a group that is shut, at its header', () => {
    const big = block('G', 100)
    const small = { unit: big.unit, members: big.members.slice(0, 3) }
    const before = buildRowModel([loose('a'), big], noneShut)
    const at = offsetOf(before, 'G.80')!

    const narrowed = buildRowModel([loose('a'), small], noneShut)
    expect(scrollAfterChange(before, narrowed, at, VH)).toBe(offsetOf(narrowed, 'G')! + (GROUP_HEIGHT + 3 * ITEM_HEIGHT) - ITEM_HEIGHT)
  })

  it('a row that is filtered out hands the place to the next row that is left', () => {
    const before = buildRowModel([loose('a'), loose('b'), loose('c'), loose('d')], noneShut)
    const after = buildRowModel([loose('a'), loose('b'), loose('d')], noneShut)

    // In c (92..138); c is gone, d is the next one.
    expect(scrollAfterChange(before, after, 100, VH)).toBe(offsetOf(after, 'd'))
  })

  it('when nothing after the reader is left, the view stays inside the list that is left', () => {
    const many = Array.from({ length: 20 }, (_, n) => loose(`r${n}`))
    const before = buildRowModel(many, noneShut)
    const after = buildRowModel(many.slice(0, 10), noneShut)

    expect(scrollAfterChange(before, after, 17 * ITEM_HEIGHT, 200)).toBe(after.total - 200)
    expect(scrollAfterChange(before, after, 17 * ITEM_HEIGHT, 1000)).toBe(0)
  })

  it('a reader past the last row (on the Add row) or in an empty list is left where they are', () => {
    const model = buildRowModel([loose('a'), loose('b')], noneShut)

    expect(scrollAfterChange(model, model, 500, VH)).toBe(500)
    expect(scrollAfterChange(buildRowModel([], noneShut), model, 0, VH)).toBe(0)
  })
})

describe('scrollKeepingUnit: a carried block stays where it is on the screen when the groups fold and open around it', () => {
  const groups = Array.from({ length: 10 }, (_, n) => block(`G${n}`, 5))
  const open = buildRowModel(groups, noneShut)
  const shutAll = buildRowModel(groups, shut(...groups.map((entry) => (entry.unit as { group: ListGroup }).group.name)))
  const top = (model: RowModel, id: string) => offsetOf(model, id)!

  it('a header 120px below the top of the view is still 120px below it once everything is shut', () => {
    const at = top(open, 'G5') - 120

    expect(scrollKeepingUnit(open, shutAll, 'G5', at)).toBe(top(shutAll, 'G5') - 120)
  })

  it('a header stuck at the top (the view is inside its group) is at the top once it is shut', () => {
    expect(scrollKeepingUnit(open, shutAll, 'G5', top(open, 'G5') + 100)).toBe(top(shutAll, 'G5'))
  })

  it('does not go above the top of the list, and works the other way (the groups open again)', () => {
    expect(scrollKeepingUnit(open, shutAll, 'G1', 0)).toBe(0)
    expect(scrollKeepingUnit(shutAll, open, 'G5', top(shutAll, 'G5') - 60)).toBe(top(open, 'G5') - 60)
  })

  it('has nothing to say about a unit that is not in both models', () => {
    expect(scrollKeepingUnit(open, shutAll, 'nope', 100)).toBeUndefined()
    expect(scrollKeepingUnit(open, buildRowModel([loose('a')], noneShut), 'G5', 100)).toBeUndefined()
  })

  it('a loose item carried keeps its place too', () => {
    const shown = [loose('a'), block('G', 50), loose('b'), loose('c')]
    const before = buildRowModel(shown, noneShut)
    const after = buildRowModel(shown, shut('G'))

    expect(scrollKeepingUnit(before, after, 'c', top(before, 'c') - 30)).toBe(top(after, 'c') - 30)
  })
})

describe('scrollAfterDrop: a dropped unit lands exactly at the drop line (H-009)', () => {
  /** A view tall enough that no line here is near its bottom edge (the clamp is tested apart). */
  const VIEW = 3000
  // 10 groups of 5 (277px each, 47px when shut) and a loose row after them.
  const groups = Array.from({ length: 10 }, (_, n) => block(`G${n}`, 5))
  const names = groups.map((entry) => (entry.unit as { group: ListGroup }).group.name)
  const top = (model: RowModel, id: string) => offsetOf(model, id)!
  /** The model the drop was made in (Group 2 carried, so shut, the others open) and the one after it (Group 2 moved, open). */
  const carried = buildRowModel(groups, shut(names[2]!))
  const moved = (order: Shown[]) => buildRowModel(order, noneShut)
  const without2 = [...groups.slice(0, 2), ...groups.slice(3)]

  it('after an open group the moved group\'s top is on the group\'s BOTTOM edge, wherever that was on the screen', () => {
    const order = [...without2.slice(0, 7), groups[2]!, ...without2.slice(7)]
    const open = moved(order)
    const scrollTop = top(carried, 'G7') - 120
    // G7 (open, 277px tall in the model the drop was made in): its bottom was 120 + 277 below the top of the view.
    const bottomOnScreen = top(carried, 'G7') + 277 - scrollTop

    const at = scrollAfterDrop(carried, open, 'G2', 'G7', 'after', scrollTop, VIEW)!

    expect(top(open, 'G2') - at).toBe(bottomOnScreen)
  })

  it('before an open group the moved group\'s top is on the group\'s top edge', () => {
    const open = moved([...without2.slice(0, 6), groups[2]!, ...without2.slice(6)])
    const scrollTop = top(carried, 'G7') - 120

    const at = scrollAfterDrop(carried, open, 'G2', 'G7', 'before', scrollTop, VIEW)!

    expect(top(open, 'G2') - at).toBe(120)
  })

  it('before a group whose header is stuck at the top (the view is inside it) the line is the list\'s top edge: the moved group\'s box is there', () => {
    const open = moved([...without2.slice(0, 6), groups[2]!, ...without2.slice(6)])
    const scrollTop = top(carried, 'G7') + 90

    const at = scrollAfterDrop(carried, open, 'G2', 'G7', 'before', scrollTop, VIEW)!

    expect(top(open, 'G2') - at).toBe(0)
  })

  it('after a shut group the line is under its header', () => {
    const shutSeven = buildRowModel(groups, shut(names[2]!, names[7]!))
    const open = moved([...without2.slice(0, 7), groups[2]!, ...without2.slice(7)])
    const scrollTop = top(shutSeven, 'G7') - 120

    const at = scrollAfterDrop(shutSeven, open, 'G2', 'G7', 'after', scrollTop, VIEW)!

    expect(top(open, 'G2') - at).toBe(120 + GROUP_HEIGHT)
  })

  it('a short move in a flat list is exact too: the row\'s top goes on the line, so the view shifts by the row that moved (as the prototype does)', () => {
    const rows = Array.from({ length: 300 }, (_, n) => loose(`r${n}`))
    const before = buildRowModel(rows, noneShut)
    // r30 after r33 (moving down): r31..r33 close up, r30 takes the slot above r34.
    const after = buildRowModel([...rows.slice(0, 30), ...rows.slice(31, 34), rows[30]!, ...rows.slice(34)], noneShut)

    expect(scrollAfterDrop(before, after, 'r30', 'r33', 'after', 1000, VIEW)).toBe(1000 - ITEM_HEIGHT)
    // r40 before r33 (moving up): the moved row is where the line was; nothing shifts.
    const up = buildRowModel([...rows.slice(0, 33), rows[40]!, ...rows.slice(33, 40), ...rows.slice(41)], noneShut)
    expect(scrollAfterDrop(before, up, 'r40', 'r33', 'before', 1000, VIEW)).toBe(1000)
  })

  it('a far drop in a flat list puts the moved row on the line wherever the view was', () => {
    const rows = Array.from({ length: 5000 }, (_, n) => loose(`r${n}`))
    const before = buildRowModel(rows, noneShut)
    const after = buildRowModel([...rows.slice(1, 2500), rows[0]!, ...rows.slice(2500)], noneShut)
    const scrollTop = 2495 * ITEM_HEIGHT

    const at = scrollAfterDrop(before, after, 'r0', 'r2500', 'before', scrollTop, VIEW)!

    // r2500 was 5 rows below the top of the view; the moved row (now at 2499) is on that line.
    expect(offsetOf(after, 'r0')! - at).toBe(5 * ITEM_HEIGHT)
  })

  it('never scrolls above the top of the list', () => {
    const rows = [loose('a'), loose('b'), loose('c')]
    const before = buildRowModel(rows, noneShut)
    const after = buildRowModel([rows[1]!, rows[2]!, rows[0]!], noneShut)

    expect(scrollAfterDrop(before, after, 'a', 'c', 'after', 0, VIEW)).toBe(0)
  })

  it('an item moved inside its group lands on the line too: the member\'s own row is the box, not the whole group', () => {
    const big = block('G', 10)
    const reorder = (ids: number[]) => ({ unit: big.unit, members: ids.map((n) => big.members[n]!) })
    const shown = [loose('a'), big]
    const before = buildRowModel(shown, noneShut)
    const scrollTop = top(before, 'G.5') - 120
    // G.1 moved after G.5 (downwards): G.2 to G.5 close up, G.1 takes the slot above G.6.
    const down = buildRowModel([shown[0]!, reorder([0, 2, 3, 4, 5, 1, 6, 7, 8, 9])], noneShut)

    const at = scrollAfterDrop(before, down, 'G.1', 'G.5', 'after', scrollTop, VIEW)!

    // G.5's bottom was 120 + 46 below the top of the view; G.1's top is there.
    expect(top(down, 'G.1') - at).toBe(120 + ITEM_HEIGHT)
    // G.7 moved before G.3 (upwards): it takes the slot of G.3, which is the line: nothing shifts.
    const up = buildRowModel([shown[0]!, reorder([0, 1, 2, 7, 3, 4, 5, 6, 8, 9])], noneShut)
    expect(scrollAfterDrop(before, up, 'G.7', 'G.3', 'before', top(before, 'G.3') - 80, VIEW)).toBe(top(before, 'G.3') - 80)
  })

  it('has nothing to say when the unit or its target is not in the models', () => {
    expect(scrollAfterDrop(carried, carried, 'nope', 'G1', 'before', 0, VIEW)).toBeUndefined()
    expect(scrollAfterDrop(carried, carried, 'G1', 'nope', 'before', 0, VIEW)).toBeUndefined()
  })
})


describe('scrollAfterDrop: the drop never lands outside the visible list (H-014)', () => {
  const groups = Array.from({ length: 10 }, (_, n) => block(`G${n}`, 5))
  const names = groups.map((entry) => (entry.unit as { group: ListGroup }).group.name)
  const carried = buildRowModel(groups, shut(names[2]!))
  const without2 = [...groups.slice(0, 2), ...groups.slice(3)]
  const after7 = buildRowModel([...without2.slice(0, 7), groups[2]!, ...without2.slice(7)], noneShut)
  const top = (model: RowModel, id: string) => offsetOf(model, id)!
  // G7 is 277px tall and starts 120px below the top of the view: its bottom edge is 397px down.
  const scrollTop = top(carried, 'G7') - 120

  it('a group dropped on a line below the bottom edge lands with its header and two rows above it: 140px up from the bottom', () => {
    const view = 300

    const at = scrollAfterDrop(carried, after7, 'G2', 'G7', 'after', scrollTop, view)!

    expect(top(after7, 'G2') - at).toBe(view - 140)
  })

  it('a loose item or a member dropped on such a line keeps one row, 46px', () => {
    const rows = Array.from({ length: 300 }, (_, n) => loose(`r${n}`))
    const before = buildRowModel(rows, noneShut)
    const down = buildRowModel([...rows.slice(0, 30), ...rows.slice(31, 200), rows[30]!, ...rows.slice(200)], noneShut)
    // r199 is 169 rows below the view's top: its bottom is far below a 600px view.
    const at = scrollAfterDrop(before, down, 'r30', 'r199', 'after', 1000, 600)!

    expect(offsetOf(down, 'r30')! - at).toBe(600 - 46)

    const big = block('G', 20)
    const reorder = (ids: number[]) => ({ unit: big.unit, members: ids.map((n) => big.members[n]!) })
    const inGroup = buildRowModel([loose('a'), big], noneShut)
    const moved = buildRowModel([loose('a'), reorder([0, ...Array.from({ length: 18 }, (_, n) => n + 2), 1, 19])], noneShut)
    expect(offsetOf(moved, 'G.1')! - scrollAfterDrop(inGroup, moved, 'G.1', 'G.19', 'before', 0, 300)!).toBe(300 - 46)
  })

  it('a line on screen but within the reserved room above the bottom edge is moved up to it', () => {
    const view = 600
    // The bottom edge of G7 is 397 down: 203 above the view's bottom, which is more than 140, so it stays; a view of 500 leaves 103 < 140.
    expect(top(after7, 'G2') - scrollAfterDrop(carried, after7, 'G2', 'G7', 'after', scrollTop, view)!).toBe(397)
    expect(top(after7, 'G2') - scrollAfterDrop(carried, after7, 'G2', 'G7', 'after', scrollTop, 500)!).toBe(500 - 140)
  })

  it('a line above the top edge lands at the top edge, as before', () => {
    const open = buildRowModel([...without2.slice(0, 6), groups[2]!, ...without2.slice(6)], noneShut)
    // The view is 90px into G7, whose top (the line) is above it: the moved group's box goes to the top edge.
    expect(top(open, 'G2') - scrollAfterDrop(carried, open, 'G2', 'G7', 'before', top(carried, 'G7') + 90, 300)!).toBe(0)
  })

  it('a view shorter than the reserved room lands it at the top edge', () => {
    expect(top(after7, 'G2') - scrollAfterDrop(carried, after7, 'G2', 'G7', 'after', scrollTop, 100)!).toBe(0)
  })
})

/** The Preview's rows are 40px, the header as well (Phase 26): the model takes the heights, and the list's stay the defaults. */
const PREVIEW = { itemHeight: 40, groupHeight: 40 } as const

function drawnHeightAt(slices: Slice[], heights: { itemHeight: number; groupHeight: number }): number {
  let total = 0
  for (const slice of slices) {
    if (slice.kind === 'spacer') total += slice.height
    else if (slice.kind === 'item') total += heights.itemHeight
    else {
      total += slice.header ? heights.groupHeight : 0
      for (const part of slice.parts) total += part.kind === 'spacer' ? part.height : (part.to - part.from) * heights.itemHeight
    }
  }

  return total
}

describe('rowModel: heights as a parameter (Phase 26.1)', () => {
  it('keeps the list defaults when no heights are given', () => {
    const model = buildRowModel([loose('a'), block('G', 2)], noneShut)

    expect([model.itemHeight, model.groupHeight]).toEqual([ITEM_HEIGHT, GROUP_HEIGHT])
  })

  it('lays the rows out at the given heights: tops, heights and the total', () => {
    const model = buildRowModel([loose('a'), block('G', 3), loose('b')], noneShut, PREVIEW)

    expect(model.total).toBe(40 + (40 + 3 * 40) + 40)
    expect(model.units.map((unit) => [unit.key, unit.top, unit.height])).toEqual([
      ['a', 0, 40],
      ['G', 40, 160],
      ['b', 200, 40],
    ])
    expect([offsetOf(model, 'G'), offsetOf(model, 'G.0'), offsetOf(model, 'G.2')]).toEqual([40, 80, 160])
    expect(model.rowHeights.get('G')).toBe(40)
  })

  it('a shut group is its header alone at the given height', () => {
    const model = buildRowModel([block('G', 5), loose('x')], shut('G'), PREVIEW)

    expect(model.units[0]!.height).toBe(40)
    expect(model.total).toBe(80)
  })

  it('the spacers and the rows drawn add up to the whole list, whatever the window (property)', () => {
    const next = random(777)
    for (let trial = 0; trial < 300; trial += 1) {
      const shown = randomList(next)
      const closed = new Set(shown.filter((entry) => entry.unit.kind === 'group' && next() < 0.2).map((entry) => (entry.unit as { group: ListGroup }).group.name))
      const model = buildRowModel(shown, (name) => closed.has(name), PREVIEW)
      const viewport = { scrollTop: Math.floor(next() * (model.total + 200)) - 100, height: 1 + Math.floor(next() * 600) }
      const slices = windowSlices(model, viewport, { enabled: true, overscan: Math.floor(next() * 300), pinned: new Set() })
      const ids = drawn(slices, shown).filter((entry) => !entry.startsWith('~') && entry !== ']').map((entry) => entry.replace('[', ''))

      expect(drawnHeightAt(slices, PREVIEW)).toBe(model.total)
      for (const [id, top] of model.rowTops) {
        if (top + 40 > viewport.scrollTop && top < viewport.scrollTop + viewport.height) expect(ids).toContain(id)
      }
    }
  })

  it('draws a pinned member of a group at the given heights', () => {
    const shown = [block('G', 100)]
    const model = buildRowModel(shown, noneShut, PREVIEW)
    const slices = windowSlices(model, { scrollTop: 0, height: 200 }, { enabled: true, overscan: 0, pinned: new Set(['G.70']) })

    expect(drawn(slices, shown)).toContain('G.70')
    expect(drawnHeightAt(slices, PREVIEW)).toBe(model.total)
  })

  it('a row under a sticky header is centred and revealed below the header at the given height', () => {
    const model = buildRowModel([block('G', 100)], noneShut, PREVIEW)

    // G.50 starts at 40 + 50 * 40 = 2040; the header covers 40px; viewport 400: (400 - 40 - 40) / 2 = 160 above it.
    expect(centreOn(model, 'G.50', 400)).toBe(2040 - 40 - 160)
    expect(revealScrollTop(model, 'G.50', 2040 - 40, 400)).toBe(2040 - 40)
  })

  it('scrollAfterChange keeps the reader at the last row of a group that shrank, at the given height', () => {
    const shown = [block('G', 10), loose('x')]
    const before = buildRowModel(shown, noneShut, PREVIEW)
    const after = buildRowModel([{ unit: shown[0]!.unit, members: shown[0]!.members.slice(0, 3) }, shown[1]!], noneShut, PREVIEW)

    // Anchor G (scrollTop 200 is inside it, delta 200); after: height 160, room = 160 - 40 = 120.
    expect(scrollAfterChange(before, after, 200, 400)).toBe(0 + 120)
  })
})
