// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listPreferenceKey } from './store.js'

describe('listPreferenceKey', () => {
  it('namespaces the same preference key differently for two different lists', () => {
    const listA = listPreferenceKey('list-a', 'collapse')
    const listB = listPreferenceKey('list-b', 'collapse')

    expect(listA).not.toBe(listB)
  })

  it('namespaces two different preference keys differently for the same list', () => {
    const collapse = listPreferenceKey('list-a', 'collapse')
    const lastFocusedRow = listPreferenceKey('list-a', 'lastFocusedRow')

    expect(collapse).not.toBe(lastFocusedRow)
  })
})

/** The desktop's plugin-store, replaced by a map that has the calls the app uses: `keys` and `delete` are what BL-150's sweep needs. */
const file = vi.hoisted(() => ({ entries: new Map<string, unknown>(), saves: 0 }))

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => ({
    get: async (key: string) => file.entries.get(key),
    set: async (key: string, value: unknown) => void file.entries.set(key, value),
    keys: async () => [...file.entries.keys()],
    delete: async (key: string) => file.entries.delete(key),
    save: async () => void (file.saves += 1),
  })),
}))

/** A fresh module each time: the store is picked once per page load, by whether the Tauri bridge is there. */
async function freshStore() {
  vi.resetModules()
  const { getPreferencesStore } = await import('./store.js')

  return getPreferencesStore()
}

/** A `localStorage` of our own: this Node has an experimental global of that name that jsdom's does not replace. */
function fakeStorage(): Storage {
  const data = new Map<string, string>()

  return {
    get length() {
      return data.size
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
  }
}

describe('the browser store (localStorage), BL-150', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage())
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists the keys it holds', async () => {
    const store = await freshStore()
    await store.set('skin', 'dark')
    await store.set('list:a:collapsed', '[]')

    expect((await store.keys!()).sort()).toEqual(['list:a:collapsed', 'skin'])
  })

  it('deletes one key and leaves the others', async () => {
    const store = await freshStore()
    await store.set('skin', 'dark')
    await store.set('list:a:collapsed', '[]')

    await store.delete!('list:a:collapsed')

    expect(await store.get('list:a:collapsed')).toBeUndefined()
    expect(await store.get('skin')).toBe('dark')
  })

  it('answers an empty list and a no-op when storage cannot be used, never an error', async () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', {
      get length() {
        return blocked()
      },
      key: blocked,
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
    })
    const store = await freshStore()

    expect(await store.keys!()).toEqual([])
    await expect(store.delete!('skin')).resolves.toBeUndefined()
  })
})

describe('the desktop store (preferences.json), BL-150', () => {
  beforeEach(() => {
    file.entries.clear()
    ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {}
  })
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
  })

  it('lists and deletes keys through the plugin', async () => {
    file.entries.set('skin', 'dark')
    file.entries.set('list:a:focus', 'row-1')
    const store = await freshStore()

    expect((await store.keys!()).sort()).toEqual(['list:a:focus', 'skin'])
    await store.delete!('list:a:focus')

    expect([...file.entries.keys()]).toEqual(['skin'])
  })
})
