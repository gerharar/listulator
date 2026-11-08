// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { ListItem } from '../../lib/api.js'
import { buildRowModel, GROUP_HEIGHT, ITEM_HEIGHT, keepItem, listHeights, type ShownUnit } from './rowModel.js'
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
