import { describe, expect, it } from 'vitest'
import type { ListItem } from '../../lib/api.js'
import { countRuntimesPending, mergeArrivedRuntimes } from './runtimePending.js'

const item = (id: string, extra: Partial<ListItem> = {}): ListItem => ({
  id,
  listId: 'L',
  title: id,
  orderIndex: 0,
  timeToConsumeMinutes: 120,
  timeToConsumeIsEstimated: true,
  consumedAt: null,
  source: 'import',
  year: null,
  group: null,
  tags: null,
  notes: null,
  isNew: false,
  runtimePending: true,
  ...extra,
})

const arrived = (id: string, minutes: number, extra: Partial<ListItem> = {}) =>
  item(id, { timeToConsumeMinutes: minutes, timeToConsumeIsEstimated: false, runtimePending: false, ...extra })

describe('countRuntimesPending', () => {
  it('counts the items still waiting for a length', () => {
    expect(countRuntimesPending([item('a'), arrived('b', 90), item('c'), item('d', { runtimePending: undefined })])).toBe(2)
  })
})

describe('mergeArrivedRuntimes (15.7)', () => {
  it('takes the length of an item that was waiting and now has one', () => {
    const merged = mergeArrivedRuntimes([item('a'), item('b')], [arrived('a', 101), item('b')])

    expect(merged.map((entry) => [entry.id, entry.timeToConsumeMinutes, entry.timeToConsumeIsEstimated, entry.runtimePending])).toEqual([
      ['a', 101, false, false],
      ['b', 120, true, true],
    ])
  })

  it('changes nothing else about the item, or the order, or an item the server no longer has', () => {
    const current = [item('a', { title: 'Renamed by hand', consumedAt: 'yesterday' }), item('gone')]

    const merged = mergeArrivedRuntimes(current, [arrived('a', 101, { title: 'Server title' })])

    expect(merged[0]).toMatchObject({ id: 'a', title: 'Renamed by hand', consumedAt: 'yesterday', timeToConsumeMinutes: 101 })
    expect(merged.map((entry) => entry.id)).toEqual(['a', 'gone'])
  })

  it('does not add items the screen does not have', () => {
    expect(mergeArrivedRuntimes([item('a')], [arrived('a', 90), arrived('new', 60)]).map((entry) => entry.id)).toEqual(['a'])
  })

  it('never touches an item that was not waiting, so a time the user set is never replaced by an older one', () => {
    const mine = item('a', { timeToConsumeMinutes: 55, timeToConsumeIsEstimated: false, runtimePending: false })

    expect(mergeArrivedRuntimes([mine], [item('a')])[0]).toBe(mine)
    expect(mergeArrivedRuntimes([mine], [arrived('a', 101)])[0]).toBe(mine)
  })

  it('returns the same list when nothing arrived, so the screen does not redraw for nothing', () => {
    const current = [item('a'), item('b')]

    expect(mergeArrivedRuntimes(current, [item('a'), item('b')])).toBe(current)
  })
})
