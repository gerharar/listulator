import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from './store.js'
import { forgetDeletedLists, forgetDeletedListsOnce, resetForgetDeletedListsOnce } from './forgetLists.js'

/** BL-150: what the app remembers per list (`list:<id>:…`) goes when the list is gone, and nothing else does. */
function fakeStore(initial: Record<string, string>): PreferencesStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))

  return {
    data,
    get: async (key) => data.get(key),
    set: async (key, value) => void data.set(key, value),
    keys: async () => [...data.keys()],
    delete: async (key) => void data.delete(key),
  }
}

const KEPT = { skin: 'dark', language: 'ru', 'preview:rail': 'hidden', updateTrace: '[]', 'listVirtualization': 'off' }

describe('forgetDeletedLists', () => {
  it('removes every key of a list that is not in the live set, and returns how many', async () => {
    const store = fakeStore({
      ...KEPT,
      'list:live:collapsed': '["A"]',
      'list:live:focus': 'row',
      'list:gone:collapsed': '["A","B"]',
      'list:gone:focus': 'row',
      'list:gone:railWidth': '240',
      'list:gone2:hideDone': 'on',
    })

    expect(await forgetDeletedLists(store, ['live'])).toBe(4)

    expect([...store.data.keys()].sort()).toEqual(['language', 'list:live:collapsed', 'list:live:focus', 'listVirtualization', 'preview:rail', 'skin', 'updateTrace'])
  })

  it('leaves every key that is not a list key alone, even one that merely starts with "list"', async () => {
    const store = fakeStore({ ...KEPT, listFoo: 'x', 'list:': 'x', 'list:nokey': 'x', 'lists:gone:focus': 'x' })

    expect(await forgetDeletedLists(store, ['live'])).toBe(0)
    expect(store.data.size).toBe(Object.keys(KEPT).length + 4)
  })

  it('sweeps nothing for an empty live set: the one shape a bad state could produce', async () => {
    const store = fakeStore({ 'list:gone:collapsed': '[]' })

    expect(await forgetDeletedLists(store, [])).toBe(0)
    expect(store.data.has('list:gone:collapsed')).toBe(true)
  })

  it('does nothing on a store that cannot list or delete keys', async () => {
    const bare: PreferencesStore = { get: async () => undefined, set: async () => undefined }

    expect(await forgetDeletedLists(bare, ['live'])).toBe(0)
  })

  it('goes on past a key that cannot be removed, and past a store that cannot be read, never throwing', async () => {
    const store = fakeStore({ 'list:gone:a': '1', 'list:gone:b': '1' })
    const real = store.delete!
    store.delete = vi.fn(async (key: string) => {
      if (key === 'list:gone:a') throw new Error('locked')
      await real(key)
    })

    expect(await forgetDeletedLists(store, ['live'])).toBe(1)
    expect([...store.data.keys()]).toEqual(['list:gone:a'])

    const unreadable: PreferencesStore = {
      get: async () => undefined,
      set: async () => undefined,
      keys: async () => {
        throw new Error('no store')
      },
      delete: async () => undefined,
    }
    expect(await forgetDeletedLists(unreadable, ['live'])).toBe(0)
  })
})

describe('forgetDeletedListsOnce', () => {
  beforeEach(resetForgetDeletedListsOnce)

  it('sweeps on the first call of a start and never again, so an Undo in the same run still finds its list’s state', async () => {
    const store = fakeStore({ 'list:gone:collapsed': '["A"]' })

    await forgetDeletedListsOnce(store, ['live'])
    store.data.set('list:undone:collapsed', '["A"]')
    await forgetDeletedListsOnce(store, ['live'])

    expect(store.data.has('list:gone:collapsed')).toBe(false)
    expect(store.data.has('list:undone:collapsed')).toBe(true)
  })

  it('does not use up its one go on an empty set (nothing was swept)', async () => {
    const store = fakeStore({ 'list:gone:collapsed': '["A"]' })

    await forgetDeletedListsOnce(store, [])
    await forgetDeletedListsOnce(store, ['live'])

    expect(store.data.has('list:gone:collapsed')).toBe(false)
  })
})
