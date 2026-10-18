import { describe, expect, it } from 'vitest'
import type { ListGroup, ListItem } from '../../lib/api.js'
import { buildRowModel, GROUP_HEIGHT, ITEM_HEIGHT } from './rowModel.js'
import { dropPinEdge } from './dropPin.js'
import type { SpineUnit } from './spine.js'

/** Where the real drop line of a group is, from the row model, and whether it is out of view (H-014). */

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
const open = () => false
const shut = (...names: string[]) => (name: string) => names.includes(name)

// a 0-46, G 46-(46+47+20*46 = 1013), b 1013-1059: a group of 20 rows is 967px tall.
const model = (isShut: (name: string) => boolean = open) => buildRowModel([loose('a'), block('G', 20), loose('b')], isShut)
const G_TOP = ITEM_HEIGHT
const G_BOTTOM = ITEM_HEIGHT + GROUP_HEIGHT + 20 * ITEM_HEIGHT

describe('dropPinEdge: a drop line that is off screen is pinned to the nearest edge', () => {
  it('before a group taller than the view whose top is above the view (its header is stuck): the top edge', () => {
    expect(dropPinEdge(model(), { key: 'G', pos: 'before' }, G_TOP + 200, 600)).toBe('top')
  })

  it('before a tall group whose top is on screen: nothing is pinned, the real line shows', () => {
    expect(dropPinEdge(model(), { key: 'G', pos: 'before' }, 0, 600)).toBeNull()
    expect(dropPinEdge(model(), { key: 'G', pos: 'before' }, G_TOP, 600)).toBeNull()
  })

  it('after a group taller than the view whose bottom is below the view: the bottom edge', () => {
    expect(dropPinEdge(model(), { key: 'G', pos: 'after' }, G_TOP + 200, 600)).toBe('bottom')
  })

  it('after a tall group whose bottom is on screen: nothing is pinned', () => {
    expect(dropPinEdge(model(), { key: 'G', pos: 'after' }, G_BOTTOM - 600, 600)).toBeNull()
    expect(dropPinEdge(model(), { key: 'G', pos: 'after' }, G_BOTTOM - 300, 600)).toBeNull()
  })

  it('a group that fits in the view never pins, even with its top above the view', () => {
    expect(dropPinEdge(model(), { key: 'G', pos: 'before' }, G_TOP + 200, G_BOTTOM - G_TOP)).toBeNull()
    expect(dropPinEdge(model(), { key: 'G', pos: 'after' }, 0, G_BOTTOM - G_TOP)).toBeNull()
    const small = buildRowModel([block('S', 3)], open)
    expect(dropPinEdge(small, { key: 'S', pos: 'before' }, 30, 300)).toBeNull()
  })

  it('a collapsed group, an empty group and a loose item never pin', () => {
    expect(dropPinEdge(model(shut('G')), { key: 'G', pos: 'before' }, 1000, 100)).toBeNull()
    const empty = buildRowModel([loose('a'), block('E', 0)], open)
    expect(dropPinEdge(empty, { key: 'E', pos: 'after' }, 0, 10)).toBeNull()
    expect(dropPinEdge(model(), { key: 'a', pos: 'before' }, 500, 10)).toBeNull()
  })

  it('a row inside a group, or a key that is not in the model, never pins', () => {
    expect(dropPinEdge(model(), { key: 'G.3', pos: 'before' }, 500, 100)).toBeNull()
    expect(dropPinEdge(model(), { key: 'missing', pos: 'after' }, 0, 100)).toBeNull()
  })

  it('is exact at the edge: a top at the view\'s top is on screen, a bottom at the view\'s bottom is on screen', () => {
    expect(dropPinEdge(model(), { key: 'G', pos: 'before' }, G_TOP, 600)).toBeNull()
    expect(dropPinEdge(model(), { key: 'G', pos: 'before' }, G_TOP + 1, 600)).toBe('top')
    expect(dropPinEdge(model(), { key: 'G', pos: 'after' }, G_BOTTOM - 600, 600)).toBeNull()
    expect(dropPinEdge(model(), { key: 'G', pos: 'after' }, G_BOTTOM - 601, 600)).toBe('bottom')
  })
})
