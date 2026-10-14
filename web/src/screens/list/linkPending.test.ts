import { describe, expect, it } from 'vitest'
import type { ListItem } from '../../lib/api.js'
import { countLinksPending, mergeArrivedLinks } from './linkPending.js'

const item = (id: string, extra: Partial<ListItem> = {}): ListItem => ({
  id,
  listId: 'L',
  title: id,
  orderIndex: 0,
  timeToConsumeMinutes: 600,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'import',
  year: null,
  group: null,
  tags: null,
  notes: null,
  yearUnk: 0,
  isNew: false,
  link: null,
  linkPending: true,
  ...extra,
})

const LINK = { url: 'https://www.igdb.com/games/zelda', source: 'IGDB' }
const arrived = (id: string, extra: Partial<ListItem> = {}) => item(id, { link: LINK, linkPending: undefined, ...extra })

describe('countLinksPending', () => {
  it('counts the items whose link is still being looked up', () => {
    expect(countLinksPending([item('a'), arrived('b'), item('c'), item('d', { linkPending: undefined })])).toBe(2)
  })
})

describe('mergeArrivedLinks (H-002, IGDB)', () => {
  it('takes the link of an item that was waiting and now has one', () => {
    const merged = mergeArrivedLinks([item('a'), item('b')], [arrived('a'), item('b')])

    expect(merged.map((entry) => [entry.id, entry.link, entry.linkPending])).toEqual([
      ['a', LINK, false],
      ['b', null, true],
    ])
  })

  it('stops waiting for an item the lookup gave up on: no link, and no longer pending', () => {
    const merged = mergeArrivedLinks([item('a')], [item('a', { linkPending: undefined })])

    expect(merged[0]).toMatchObject({ link: null, linkPending: false })
  })

  it('changes nothing else about the item, or the order, or an item the server no longer has', () => {
    const current = [item('a', { title: 'Renamed by hand', consumedAt: 'yesterday' }), item('gone')]

    const merged = mergeArrivedLinks(current, [arrived('a', { title: 'Server title' })])

    expect(merged[0]).toMatchObject({ id: 'a', title: 'Renamed by hand', consumedAt: 'yesterday', link: LINK })
    expect(merged.map((entry) => entry.id)).toEqual(['a', 'gone'])
  })

  it('does not add items the screen does not have', () => {
    expect(mergeArrivedLinks([item('a')], [arrived('a'), arrived('new')]).map((entry) => entry.id)).toEqual(['a'])
  })

  it('never touches an item that was not waiting', () => {
    const settled = item('a', { link: null, linkPending: undefined })

    expect(mergeArrivedLinks([settled], [arrived('a')])[0]).toBe(settled)
  })

  it('hands back the same array when nothing arrived, so nothing is redrawn', () => {
    const current = [item('a')]

    expect(mergeArrivedLinks(current, [item('a')])).toBe(current)
  })
})
