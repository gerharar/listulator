import { describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from './preferences/store.js'
import { createPendingUpdates } from './pendingUpdates.js'

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const store: PreferencesStore = {
    get: async (key) => data.get(key),
    set: async (key, value) => void data.set(key, value),
  }

  return { store, data }
}

const KEY = 'updates:pending'

describe('pendingUpdates', () => {
  it('starts empty', async () => {
    const pending = createPendingUpdates(memoryStore().store)
    await pending.load()

    expect(pending.get()).toEqual({})
  })

  it('remembers what it found across a restart', async () => {
    const { store } = memoryStore()
    const first = createPendingUpdates(store)
    await first.load()
    await first.set('L1', 3)

    const afterRestart = createPendingUpdates(store)
    await afterRestart.load()

    expect(afterRestart.get()).toMatchObject({ L1: { count: 3 } })
    expect(afterRestart.get()['L1']!.checkedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it('starts empty, without complaint, from stored text it cannot read', async () => {
    for (const junk of ['not json', '[]', '{"L1":"x"}', '{"L1":{"count":-2,"checkedAt":"2026-01-01T00:00:00.000Z"}}', '{"L1":{"count":0,"checkedAt":"2026-01-01T00:00:00.000Z"}}', '{"L1":{"count":1.5,"checkedAt":"2026-01-01T00:00:00.000Z"}}', 'null']) {
      const pending = createPendingUpdates(memoryStore({ [KEY]: junk }).store)
      await pending.load()

      expect(pending.get()).toEqual({})
    }
  })

  it('keeps the readable entries when only some are junk', async () => {
    const stored = JSON.stringify({ ok: { count: 2, checkedAt: '2026-01-01T00:00:00.000Z' }, bad: { count: 'x' } })
    const pending = createPendingUpdates(memoryStore({ [KEY]: stored }).store)
    await pending.load()

    expect(Object.keys(pending.get())).toEqual(['ok'])
  })

  it('drops an entry when a list has nothing new any more', async () => {
    const pending = createPendingUpdates(memoryStore().store)
    await pending.load()
    await pending.set('L1', 2)

    await pending.set('L1', 0)

    expect(pending.get()).toEqual({})
  })

  it('removes an entry when it is applied or dismissed, and persists that', async () => {
    const { store } = memoryStore()
    const pending = createPendingUpdates(store)
    await pending.load()
    await pending.set('L1', 2)
    await pending.set('L2', 1)

    await pending.remove('L1')

    const afterRestart = createPendingUpdates(store)
    await afterRestart.load()
    expect(Object.keys(afterRestart.get())).toEqual(['L2'])
  })

  it('forgets lists that no longer exist', async () => {
    const pending = createPendingUpdates(memoryStore().store)
    await pending.load()
    await pending.set('L1', 2)
    await pending.set('gone', 4)

    await pending.prune(['L1', 'L2'])

    expect(Object.keys(pending.get())).toEqual(['L1'])
  })

  it('tells subscribers about every change, and only until they unsubscribe', async () => {
    const pending = createPendingUpdates(memoryStore().store)
    await pending.load()
    const heard = vi.fn()
    const off = pending.subscribe(heard)

    await pending.set('L1', 2)
    await pending.remove('L1')
    expect(heard).toHaveBeenCalledTimes(2)

    off()
    await pending.set('L2', 1)
    expect(heard).toHaveBeenCalledTimes(2)
  })

  it('hands out a new snapshot on each change, so a view can tell', async () => {
    const pending = createPendingUpdates(memoryStore().store)
    await pending.load()
    const before = pending.get()

    await pending.set('L1', 2)

    expect(pending.get()).not.toBe(before)
    expect(before).toEqual({})
  })

  it('does not write or say anything when there was nothing to forget', async () => {
    const { store } = memoryStore()
    const setSpy = vi.spyOn(store, 'set')
    const pending = createPendingUpdates(store)
    await pending.load()
    await pending.set('L1', 2)
    setSpy.mockClear()
    const heard = vi.fn()
    pending.subscribe(heard)

    await pending.prune(['L1'])

    expect(setSpy).not.toHaveBeenCalled()
    expect(heard).not.toHaveBeenCalled()
  })

  describe('visible', () => {
    it('is the first few pending lists, in the order the lists are shown', async () => {
      const pending = createPendingUpdates(memoryStore().store)
      await pending.load()
      for (const id of ['d', 'b', 'a', 'c']) await pending.set(id, 1)

      expect(pending.visible(['a', 'b', 'x', 'c', 'd'], 3)).toEqual(['a', 'b', 'c'])
    })

    it('shows the next one when one is handled', async () => {
      const pending = createPendingUpdates(memoryStore().store)
      await pending.load()
      for (const id of ['a', 'b', 'c', 'd']) await pending.set(id, 1)

      await pending.remove('b')

      expect(pending.visible(['a', 'b', 'c', 'd'], 3)).toEqual(['a', 'c', 'd'])
    })

    it('ignores pending entries for lists that are not in the order', async () => {
      const pending = createPendingUpdates(memoryStore().store)
      await pending.load()
      await pending.set('ghost', 1)

      expect(pending.visible(['a'], 3)).toEqual([])
    })
  })

  describe('checking', () => {
    it('is off until a check starts, and says so to subscribers when it changes', async () => {
      const pending = createPendingUpdates(memoryStore().store)
      const heard = vi.fn()
      pending.subscribe(heard)

      expect(pending.isChecking()).toBe(false)
      pending.setChecking(true)
      expect(pending.isChecking()).toBe(true)
      pending.setChecking(false)

      expect(heard).toHaveBeenCalledTimes(2)
      expect(pending.isChecking()).toBe(false)
    })

    it('says nothing when it is set to what it already is', () => {
      const pending = createPendingUpdates(memoryStore().store)
      const heard = vi.fn()
      pending.subscribe(heard)

      pending.setChecking(false)
      pending.setChecking(true)
      pending.setChecking(true)

      expect(heard).toHaveBeenCalledTimes(1)
    })
  })
})
