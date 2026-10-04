// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SourceExpansion } from '../../../lib/api.js'
import { useSourceExpansions } from './useSourceExpansions.js'

/** A fetch whose promises the test settles by hand, in whatever order it likes. */
function controlledFetch() {
  const pending = new Map<string, { resolve: (v: SourceExpansion) => void; reject: (e: Error) => void }>()
  const started: string[] = []

  const fetchExpansion = vi.fn(
    (ref: string) =>
      new Promise<SourceExpansion>((resolve, reject) => {
        started.push(ref)
        pending.set(ref, { resolve, reject })
      }),
  )

  return {
    fetchExpansion,
    started,
    resolve: async (ref: string, value: SourceExpansion) => {
      await act(async () => pending.get(ref)!.resolve(value))
    },
    reject: async (ref: string) => {
      await act(async () => pending.get(ref)!.reject(new Error('upstream down')))
    },
  }
}

describe('useSourceExpansions', () => {
  it('marks every ref loading at once, then fills each in as its fetch settles', async () => {
    const control = controlledFetch()
    const { result } = renderHook(() => useSourceExpansions())

    await act(async () => result.current.begin(['a', 'b'], control.fetchExpansion))
    expect(result.current.states.get('a')).toEqual({ state: 'loading' })
    expect(result.current.states.get('b')).toEqual({ state: 'loading' })

    await control.resolve('a', { itemCount: 12, status: 'ongoing' })
    expect(result.current.states.get('a')).toEqual({
      state: 'done',
      itemCount: 12,
      status: 'ongoing',
    })
    expect(result.current.states.get('b')).toEqual({ state: 'loading' })
  })

  it('never has more than two fetches in flight, starting the next as one finishes', async () => {
    const control = controlledFetch()
    const { result } = renderHook(() => useSourceExpansions())

    await act(async () => result.current.begin(['a', 'b', 'c', 'd'], control.fetchExpansion))
    expect(control.started).toEqual(['a', 'b'])

    await control.resolve('a', { itemCount: 1 })
    expect(control.started).toEqual(['a', 'b', 'c'])

    await control.resolve('b', { itemCount: 2 })
    expect(control.started).toEqual(['a', 'b', 'c', 'd'])
  })

  it('shows no number for a failed count, and carries on with the rest', async () => {
    const control = controlledFetch()
    const { result } = renderHook(() => useSourceExpansions())

    await act(async () => result.current.begin(['a', 'b', 'c'], control.fetchExpansion))
    await control.reject('a')
    await control.resolve('b', { itemCount: 5 })

    expect(result.current.states.get('a')).toEqual({ state: 'failed' })
    expect(result.current.states.get('b')).toMatchObject({ state: 'done', itemCount: 5 })
    expect(control.started).toContain('c')
  })

  it("drops a previous batch's late responses once a new batch has begun", async () => {
    const first = controlledFetch()
    const second = controlledFetch()
    const { result } = renderHook(() => useSourceExpansions())

    await act(async () => result.current.begin(['a'], first.fetchExpansion))
    await act(async () => result.current.begin(['a'], second.fetchExpansion))

    // The stale answer for the same ref arrives after the new batch began.
    await first.resolve('a', { itemCount: 999 })
    expect(result.current.states.get('a')).toEqual({ state: 'loading' })

    await second.resolve('a', { itemCount: 7 })
    expect(result.current.states.get('a')).toMatchObject({ itemCount: 7 })
  })

  it('stops starting queued fetches once cancelled, and ignores what was in flight', async () => {
    const control = controlledFetch()
    const { result } = renderHook(() => useSourceExpansions())

    await act(async () => result.current.begin(['a', 'b', 'c'], control.fetchExpansion))
    await act(async () => result.current.cancel())
    await control.resolve('a', { itemCount: 1 })

    expect(control.started).toEqual(['a', 'b'])
    expect(result.current.states.get('a')).toEqual({ state: 'loading' })
  })

  it('starts nothing after the component is gone', async () => {
    const control = controlledFetch()
    const { result, unmount } = renderHook(() => useSourceExpansions())

    await act(async () => result.current.begin(['a', 'b', 'c'], control.fetchExpansion))
    unmount()
    await control.resolve('a', { itemCount: 1 })

    expect(control.started).toEqual(['a', 'b'])
  })

  it('clears every state on begin([]), so an emptied result list leaves no stale counts', async () => {
    const control = controlledFetch()
    const { result } = renderHook(() => useSourceExpansions())

    await act(async () => result.current.begin(['a'], control.fetchExpansion))
    await act(async () => result.current.begin([], control.fetchExpansion))

    expect(result.current.states.size).toBe(0)
  })

  it('resumes a cancelled batch fetching only what is not already known', async () => {
    const control = controlledFetch()
    const { result } = renderHook(() => useSourceExpansions())

    await act(async () => result.current.begin(['a', 'b'], control.fetchExpansion))
    await control.resolve('a', { itemCount: 4 })
    await act(async () => result.current.cancel())

    await act(async () => result.current.resume(control.fetchExpansion))

    // 'a' keeps its number and is not asked for again; 'b' is asked for afresh.
    expect(result.current.states.get('a')).toMatchObject({ state: 'done', itemCount: 4 })
    expect(control.started.filter((ref) => ref === 'a')).toHaveLength(1)
    expect(control.started.filter((ref) => ref === 'b')).toHaveLength(2)
  })

  describe('counts the search answer already carries', () => {
    it('marks a ref with a known count done at once and never asks for it', async () => {
      const control = controlledFetch()
      const { result } = renderHook(() => useSourceExpansions())

      await act(async () => result.current.begin(['a', 'b'], control.fetchExpansion, new Map([['a', { itemCount: 716 }]])))

      expect(result.current.states.get('a')).toEqual({ state: 'done', itemCount: 716 })
      expect(result.current.states.get('b')).toEqual({ state: 'loading' })
      expect(control.started).toEqual(['b'])
    })

    it('keeps a known count of zero: an empty volume is an answer, not a gap', async () => {
      const control = controlledFetch()
      const { result } = renderHook(() => useSourceExpansions())

      await act(async () => result.current.begin(['a'], control.fetchExpansion, new Map([['a', { itemCount: 0 }]])))

      expect(result.current.states.get('a')).toEqual({ state: 'done', itemCount: 0 })
      expect(control.started).toEqual([])
    })

    it('a resume does not ask for a known count either', async () => {
      const control = controlledFetch()
      const { result } = renderHook(() => useSourceExpansions())

      await act(async () => result.current.begin(['a'], control.fetchExpansion, new Map([['a', { itemCount: 3 }]])))
      await act(async () => result.current.cancel())
      await act(async () => result.current.resume(control.fetchExpansion))

      expect(control.started).toEqual([])
      expect(result.current.states.get('a')).toEqual({ state: 'done', itemCount: 3 })
    })
  })

  describe('append: more rows under the ones already there ("Show more")', () => {
    it('keeps every state already there, in-flight counts included, and adds the new rows', async () => {
      const control = controlledFetch()
      const { result } = renderHook(() => useSourceExpansions())

      await act(async () => result.current.begin(['a', 'b'], control.fetchExpansion))
      await control.resolve('a', { itemCount: 4 })
      await act(async () => result.current.append(['c'], control.fetchExpansion))

      expect(result.current.states.get('a')).toEqual({ state: 'done', itemCount: 4 })
      expect(result.current.states.get('b')).toEqual({ state: 'loading' })
      expect(result.current.states.get('c')).toEqual({ state: 'loading' })

      // 'b' was in flight when 'c' was appended: its answer still lands.
      await control.resolve('b', { itemCount: 9 })
      expect(result.current.states.get('b')).toEqual({ state: 'done', itemCount: 9 })
    })

    it('shares the two lanes with what is still running, so appended rows never raise the pace', async () => {
      const control = controlledFetch()
      const { result } = renderHook(() => useSourceExpansions())

      await act(async () => result.current.begin(['a', 'b', 'c'], control.fetchExpansion))
      await act(async () => result.current.append(['d', 'e'], control.fetchExpansion))
      expect(control.started).toEqual(['a', 'b'])

      await control.resolve('a', { itemCount: 1 })
      expect(control.started).toEqual(['a', 'b', 'c'])
      await control.resolve('b', { itemCount: 1 })
      await control.resolve('c', { itemCount: 1 })
      await control.resolve('d', { itemCount: 1 })
      await control.resolve('e', { itemCount: 1 })

      expect(control.started).toEqual(['a', 'b', 'c', 'd', 'e'])
      expect(result.current.states.get('e')).toEqual({ state: 'done', itemCount: 1 })
    })

    it('starts the new rows when everything before them has finished', async () => {
      const control = controlledFetch()
      const { result } = renderHook(() => useSourceExpansions())

      await act(async () => result.current.begin(['a'], control.fetchExpansion))
      await control.resolve('a', { itemCount: 1 })
      await act(async () => result.current.append(['b'], control.fetchExpansion))

      expect(control.started).toEqual(['a', 'b'])
    })

    it('seeds the known counts of the new rows and asks for the rest', async () => {
      const control = controlledFetch()
      const { result } = renderHook(() => useSourceExpansions())

      await act(async () => result.current.begin(['a'], control.fetchExpansion, new Map([['a', { itemCount: 5 }]])))
      await act(async () => result.current.append(['b', 'c'], control.fetchExpansion, new Map([['b', { itemCount: 6 }]])))

      expect(result.current.states.get('b')).toEqual({ state: 'done', itemCount: 6 })
      expect(control.started).toEqual(['c'])
    })

    it('is dropped with the batch when a new search begins, like everything else of the old one', async () => {
      const first = controlledFetch()
      const second = controlledFetch()
      const { result } = renderHook(() => useSourceExpansions())

      await act(async () => result.current.begin(['a'], first.fetchExpansion))
      await act(async () => result.current.append(['b'], first.fetchExpansion))
      await act(async () => result.current.begin(['x'], second.fetchExpansion))
      await first.resolve('a', { itemCount: 1 })
      await first.resolve('b', { itemCount: 2 })

      expect([...result.current.states.keys()]).toEqual(['x'])
    })

    it('a resume after a cancel picks up the appended rows too', async () => {
      const control = controlledFetch()
      const { result } = renderHook(() => useSourceExpansions())

      await act(async () => result.current.begin(['a'], control.fetchExpansion))
      await act(async () => result.current.append(['b'], control.fetchExpansion))
      await act(async () => result.current.cancel())
      await act(async () => result.current.resume(control.fetchExpansion))

      expect(control.started.filter((ref) => ref === 'a')).toHaveLength(2)
      expect(control.started.filter((ref) => ref === 'b')).toHaveLength(2)
    })

    it('after a cancel only records the rows, and starts nothing until a resume', async () => {
      // "Show more" answered after Add list had cancelled the speculative counts.
      const control = controlledFetch()
      const { result } = renderHook(() => useSourceExpansions())

      await act(async () => result.current.begin(['a'], control.fetchExpansion))
      await act(async () => result.current.cancel())
      await act(async () => result.current.append(['b'], control.fetchExpansion))

      expect(control.started).toEqual(['a'])
      expect(result.current.states.get('b')).toEqual({ state: 'loading' })

      await act(async () => result.current.resume(control.fetchExpansion))
      expect(control.started).toContain('b')
    })
  })
})
