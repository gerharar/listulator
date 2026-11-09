// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { ListItem } from '../../lib/api.js'
import { buildRowModel, GROUP_HEIGHT, ITEM_HEIGHT, keepItem, listHeights, scrollAfterResize, type ShownUnit } from './rowModel.js'
import type { SpineUnit } from './spine.js'

/**
 * The row model's heights are the page's own (Phase 48.4): `--row-h` and `--group-h`, which a theme sets, read when a model is built. A model laid
 * out at 46px over rows the CSS draws at 32px would put every spacer, every scroll position and every drop line in the wrong place.
 */
const html = document.documentElement

afterEach(() => {
  html.style.removeProperty('--row-h')
  html.style.removeProperty('--group-h')
})

const item = (id: string): ShownUnit => ({ unit: { kind: 'item', item: { id, title: id } as ListItem } as SpineUnit, members: [] })
const group = (id: string, members: number): ShownUnit => {
  const items = Array.from({ length: members }, (_, n) => ({ id: `${id}.${n}`, title: `${id}.${n}` }) as ListItem)
  return { unit: { kind: 'group', group: { id, name: id }, items } as SpineUnit, members: items }
}

describe('the list’s row heights', () => {
  it('are Quantum’s 46 and 47 where the page sets nothing', () => {
    expect(listHeights()).toEqual({ itemHeight: ITEM_HEIGHT, groupHeight: GROUP_HEIGHT })
    expect([ITEM_HEIGHT, GROUP_HEIGHT]).toEqual([46, 47])
    expect(keepItem()).toBe(46)
  })

  it('are the page’s --row-h and --group-h when it sets them, as eX-Zed does', () => {
    html.style.setProperty('--row-h', '32px')
    html.style.setProperty('--group-h', '32px')

    expect(listHeights()).toEqual({ itemHeight: 32, groupHeight: 32 })
    expect(keepItem()).toBe(32)
  })

  it('lay out a model that buildRowModel builds with no heights given', () => {
    html.style.setProperty('--row-h', '32px')
    html.style.setProperty('--group-h', '32px')

    const model = buildRowModel([item('a'), group('G', 3), item('b')], () => false)

    expect([model.itemHeight, model.groupHeight]).toEqual([32, 32])
    expect(model.total).toBe(32 + (32 + 3 * 32) + 32)
    expect(model.units.map((unit) => [unit.key, unit.top, unit.height])).toEqual([
      ['a', 0, 32],
      ['G', 32, 32 + 3 * 32],
      ['b', 32 + 32 + 3 * 32, 32],
    ])
  })
})

/**
 * The reader keeps their row when the rows change height under them (Phase 49.7: a theme switched under an open list, 46px rows to 32px). The model's
 * own scroll rule anchors on the unit at the top, which for a long group is the group: it would keep the pixel offset into it, and 2,000px into a
 * group of 100 rows is row 43 at 46px and row 62 at 32px. This one anchors on the row.
 */
describe('the reader’s place when the rows change height', () => {
  const quantum = { itemHeight: 46, groupHeight: 47 }
  const exzed = { itemHeight: 32, groupHeight: 32 }
  const loose = (n: number) => Array.from({ length: n }, (_, at) => item(`i${at}`))
  const build = (shown: ShownUnit[], heights: { itemHeight: number; groupHeight: number }) => buildRowModel(shown, () => false, heights)

  it('keeps the top of the list at the top', () => {
    const shown = loose(10)

    expect(scrollAfterResize(build(shown, quantum), build(shown, exzed), 0)).toBe(0)
  })

  it('puts the row that was at the top at the top, at the new height: row 10 starts at 460px and then at 320px', () => {
    const shown = loose(50)

    expect(scrollAfterResize(build(shown, quantum), build(shown, exzed), 10 * 46)).toBe(10 * 32)
    expect(scrollAfterResize(build(shown, exzed), build(shown, quantum), 10 * 32)).toBe(10 * 46)
  })

  it('keeps the same part of the row scrolled away: half a row is half a row', () => {
    const shown = loose(50)

    expect(scrollAfterResize(build(shown, quantum), build(shown, exzed), 10 * 46 + 23)).toBe(10 * 32 + 16)
  })

  it('anchors on the row inside a long group, not on the group: 2,000px into 100 rows is the same row after', () => {
    const shown = [group('G', 100)]
    const before = build(shown, quantum)
    const after = build(shown, exzed)
    const scrollTop = 47 + 43 * 46 + 10 // a little into the row G.43

    expect(scrollAfterResize(before, after, scrollTop)).toBe(32 + 43 * 32 + Math.round((10 * 32) / 46))
    expect(after.rowTops.get('G.43')).toBe(32 + 43 * 32)
  })

  it('keeps its distance from the end when the reader is past the last row (on the Add row)', () => {
    const shown = loose(20)
    const before = build(shown, quantum)
    const after = build(shown, exzed)

    expect(scrollAfterResize(before, after, before.total + 30)).toBe(after.total + 30)
  })

  it('changes nothing when the heights did not change', () => {
    const shown = [item('a'), group('G', 5), item('b')]
    const model = build(shown, quantum)

    expect(scrollAfterResize(model, build(shown, quantum), 120)).toBe(120)
  })

  it('has no answer for a row the new model does not have, so the caller’s own rule decides', () => {
    expect(scrollAfterResize(build(loose(10), quantum), build(loose(3), exzed), 7 * 46)).toBeUndefined()
  })
})
