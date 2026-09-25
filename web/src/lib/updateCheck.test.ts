import { describe, expect, it, vi } from 'vitest'
import type { MediaList } from './api.js'
import type { PreferencesStore } from './preferences/store.js'
import { createPendingUpdates } from './pendingUpdates.js'
import { applyUpdate, checkList, checkLists } from './updateCheck.js'

const memory = (): PreferencesStore => {
  const data = new Map<string, string>()
  return { get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v) }
}

const list = (id: string, externalRef: string | null = `ref:${id}`, title = `List ${id}`) =>
  ({ id, title, externalRef }) as MediaList

const found = (n: number) => ({
  newItems: Array.from({ length: n }, (_, i) => ({ title: `New ${i}` })),
  upstreamCount: 10,
  existingCount: 8,
  dismissedCount: 0,
})

async function setup() {
  const pending = createPendingUpdates(memory())
  await pending.load()
  return pending
}

describe('checkLists', () => {
  it('looks only at lists that have a source', async () => {
    const pending = await setup()
    const api = { checkForUpdates: vi.fn(async () => found(0)), importItems: vi.fn() }

    await checkLists([list('a'), list('b', null), list('c')], { api, pending })

    expect(api.checkForUpdates.mock.calls).toEqual([['a', false], ['c', false]])
  })

  it('goes one list at a time, in order', async () => {
    const pending = await setup()
    let running = 0
    let most = 0
    const api = {
      checkForUpdates: vi.fn(async () => {
        running += 1
        most = Math.max(most, running)
        await new Promise((resolve) => setTimeout(resolve, 1))
        running -= 1
        return found(0)
      }),
      importItems: vi.fn(),
    }

    await checkLists([list('a'), list('b'), list('c')], { api, pending })

    expect(most).toBe(1)
    expect(api.checkForUpdates.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
  })

  it('records each finding as soon as it arrives, not at the end', async () => {
    const pending = await setup()
    let releaseSecond!: () => void
    const api = {
      checkForUpdates: vi.fn(async (id: string) => {
        if (id === 'b') await new Promise<void>((resolve) => (releaseSecond = resolve))
        return found(id === 'a' ? 2 : 1)
      }),
      importItems: vi.fn(),
    }

    const done = checkLists([list('a'), list('b')], { api, pending })
    await vi.waitFor(() => expect(pending.get()['a']?.count).toBe(2))
    expect(pending.get()['b']).toBeUndefined()

    releaseSecond()
    await done
    expect(pending.get()['b']?.count).toBe(1)
  })

  it('clears an entry for a list that has nothing new any more', async () => {
    const pending = await setup()
    await pending.set('a', 5)
    const api = { checkForUpdates: vi.fn(async () => found(0)), importItems: vi.fn() }

    await checkLists([list('a')], { api, pending })

    expect(pending.get()).toEqual({})
  })

  it('brings a dismissed update back: an explicit check shows everything available', async () => {
    const pending = await setup()
    await pending.set('a', 2)
    await pending.remove('a')
    const api = { checkForUpdates: vi.fn(async () => found(2)), importItems: vi.fn() }

    await checkLists([list('a')], { api, pending })

    expect(pending.get()['a']?.count).toBe(2)
  })

  it('carries on past a list it cannot reach, and reports it at the end', async () => {
    const pending = await setup()
    const api = {
      checkForUpdates: vi.fn(async (id: string) => {
        if (id === 'b') throw new Error('Source is down')
        return found(1)
      }),
      importItems: vi.fn(),
    }

    const result = await checkLists([list('a'), list('b', 'ref:b', 'Bee'), list('c')], { api, pending })

    expect(result).toEqual({ checked: 3, found: 2, failed: [{ listId: 'b', title: 'Bee', message: 'Source is down' }] })
    expect(Object.keys(pending.get()).sort()).toEqual(['a', 'c'])
  })

  it('leaves the old entry alone for a list it could not reach', async () => {
    const pending = await setup()
    await pending.set('b', 4)
    const api = { checkForUpdates: vi.fn(async () => { throw new Error('down') }), importItems: vi.fn() }

    await checkLists([list('b')], { api, pending })

    expect(pending.get()['b']?.count).toBe(4)
  })

  it('says it is checking for as long as it runs, and not twice at once', async () => {
    const pending = await setup()
    let release!: () => void
    const api = {
      checkForUpdates: vi.fn(() => new Promise<ReturnType<typeof found>>((resolve) => (release = () => resolve(found(1))))),
      importItems: vi.fn(),
    }

    const first = checkLists([list('a')], { api, pending })
    expect(pending.isChecking()).toBe(true)
    const second = await checkLists([list('a')], { api, pending })
    expect(second).toBeNull()
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1)

    release()
    await first
    expect(pending.isChecking()).toBe(false)
  })

  it('stops saying it is checking even when something unexpected throws', async () => {
    const pending = await setup()
    const api = { checkForUpdates: vi.fn(async () => found(1)), importItems: vi.fn() }
    vi.spyOn(pending, 'set').mockRejectedValueOnce(new Error('disk full'))

    await expect(checkLists([list('a')], { api, pending })).rejects.toThrow('disk full')

    expect(pending.isChecking()).toBe(false)
  })
})

describe('checkList', () => {
  it('checks one list, records what it found, and says how many', async () => {
    const pending = await setup()
    const api = { checkForUpdates: vi.fn(async () => found(3)), importItems: vi.fn() }

    expect(await checkList('a', { api, pending })).toBe(3)
    expect(pending.get()['a']?.count).toBe(3)
  })

  it('clears the entry, and says zero, when there is nothing', async () => {
    const pending = await setup()
    await pending.set('a', 3)
    const api = { checkForUpdates: vi.fn(async () => found(0)), importItems: vi.fn() }

    expect(await checkList('a', { api, pending })).toBe(0)
    expect(pending.get()).toEqual({})
  })

  it('lets a failure through, and keeps what it had', async () => {
    const pending = await setup()
    await pending.set('a', 3)
    const api = { checkForUpdates: vi.fn(async () => { throw new Error('down') }), importItems: vi.fn() }

    await expect(checkList('a', { api, pending })).rejects.toThrow('down')
    expect(pending.get()['a']?.count).toBe(3)
  })
})

describe('applyUpdate', () => {
  it('asks the source again, adds what is new as arrivals, and clears the entry', async () => {
    const pending = await setup()
    await pending.set('a', 1)
    const items = found(2).newItems
    const api = { checkForUpdates: vi.fn(async () => ({ ...found(2), newItems: items })), importItems: vi.fn(async () => []) }

    const added = await applyUpdate('a', { api, pending })

    expect(added).toBe(2)
    expect(api.checkForUpdates).toHaveBeenCalledWith('a', false)
    expect(api.importItems).toHaveBeenCalledWith('a', items, 'import', true)
    expect(pending.get()).toEqual({})
  })

  it('adds what is new NOW, not what was counted when the band appeared', async () => {
    const pending = await setup()
    await pending.set('a', 1)
    const api = { checkForUpdates: vi.fn(async () => found(4)), importItems: vi.fn(async () => []) }

    expect(await applyUpdate('a', { api, pending })).toBe(4)
  })

  it('adds nothing, and clears the entry, when the source no longer has anything new', async () => {
    const pending = await setup()
    await pending.set('a', 2)
    const api = { checkForUpdates: vi.fn(async () => found(0)), importItems: vi.fn() }

    expect(await applyUpdate('a', { api, pending })).toBe(0)
    expect(api.importItems).not.toHaveBeenCalled()
    expect(pending.get()).toEqual({})
  })

  it('keeps the entry, and lets the error through, when the add fails', async () => {
    const pending = await setup()
    await pending.set('a', 2)
    const api = {
      checkForUpdates: vi.fn(async () => found(2)),
      importItems: vi.fn(async () => { throw new Error('nope') }),
    }

    await expect(applyUpdate('a', { api, pending })).rejects.toThrow('nope')
    expect(pending.get()['a']?.count).toBe(2)
  })

  it('keeps the entry when the source cannot be reached', async () => {
    const pending = await setup()
    await pending.set('a', 2)
    const api = { checkForUpdates: vi.fn(async () => { throw new Error('down') }), importItems: vi.fn() }

    await expect(applyUpdate('a', { api, pending })).rejects.toThrow('down')
    expect(pending.get()['a']?.count).toBe(2)
  })
})
