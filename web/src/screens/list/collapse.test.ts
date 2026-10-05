import { describe, expect, it } from 'vitest'
import type { PreferencesStore } from '../../lib/preferences/store.js'
import {
  defaultCollapsed,
  loadAddTags,
  loadCollapsed,
  loadFocus,
  loadHideDone,
  saveAddTags,
  saveCollapsed,
  saveFocus,
  saveHideDone,
} from './collapse.js'

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const store: PreferencesStore = {
    get: async (key) => data.get(key),
    set: async (key, value) => void data.set(key, value),
  }

  return { store, data }
}

describe('defaultCollapsed', () => {
  it('collapses every group of a Mega list (C3), and no other category’s', () => {
    expect(defaultCollapsed('mega', ['S1', 'S2'])).toEqual(new Set(['S1', 'S2']))
    expect(defaultCollapsed('tv', ['S1', 'S2'])).toEqual(new Set())
    expect(defaultCollapsed('music', ['Album'])).toEqual(new Set())
  })
})

describe('loadCollapsed', () => {
  it('seeds the list’s own key with the default the first time it is opened', async () => {
    const { store, data } = fakeStore()

    const collapsed = await loadCollapsed(store, 'L1', () => new Set(['S1']))

    expect(collapsed).toEqual(new Set(['S1']))
    expect(JSON.parse(data.get('list:L1:collapsed')!)).toEqual(['S1'])
  })

  it('uses what is stored afterwards, never the default again', async () => {
    const { store } = fakeStore({ 'list:L1:collapsed': JSON.stringify(['Chosen']) })

    expect(await loadCollapsed(store, 'L1', () => new Set(['S1']))).toEqual(new Set(['Chosen']))
  })

  it('remembers an empty choice: everything opened stays opened', async () => {
    const { store } = fakeStore({ 'list:L1:collapsed': '[]' })

    expect(await loadCollapsed(store, 'L1', () => new Set(['S1']))).toEqual(new Set())
  })

  it('keeps two lists apart', async () => {
    const { store } = fakeStore({ 'list:A:collapsed': JSON.stringify(['x']) })

    expect(await loadCollapsed(store, 'B', () => new Set(['y']))).toEqual(new Set(['y']))
  })

  it('falls back to the default when the stored value is unreadable', async () => {
    const { store } = fakeStore({ 'list:L1:collapsed': '{not json' })

    expect(await loadCollapsed(store, 'L1', () => new Set(['S1']))).toEqual(new Set(['S1']))
  })

  it('falls back to the default when the store itself fails', async () => {
    const store: PreferencesStore = {
      get: async () => {
        throw new Error('storage blocked')
      },
      set: async () => {
        throw new Error('storage blocked')
      },
    }

    expect(await loadCollapsed(store, 'L1', () => new Set(['S1']))).toEqual(new Set(['S1']))
  })
})

describe('saveCollapsed / focus', () => {
  it('saves the collapsed groups under the list’s key', async () => {
    const { store, data } = fakeStore()

    await saveCollapsed(store, 'L1', new Set(['A', 'B']))

    expect(JSON.parse(data.get('list:L1:collapsed')!)).toEqual(['A', 'B'])
  })

  it('remembers the last-focused row per list', async () => {
    const { store } = fakeStore()

    await saveFocus(store, 'L1', 'item-9')

    expect(await loadFocus(store, 'L1')).toBe('item-9')
    expect(await loadFocus(store, 'L2')).toBeUndefined()
  })

  it('does not throw when the store fails', async () => {
    const store: PreferencesStore = {
      get: async () => {
        throw new Error('blocked')
      },
      set: async () => {
        throw new Error('blocked')
      },
    }

    await expect(saveCollapsed(store, 'L1', new Set())).resolves.toBeUndefined()
    await expect(saveFocus(store, 'L1', 'x')).resolves.toBeUndefined()
    expect(await loadFocus(store, 'L1')).toBeUndefined()
  })
})

describe('the add row’s remembered tags (U5)', () => {
  it('is nothing until an item is added with tags, then per list what it used', async () => {
    const { store } = fakeStore()
    expect(await loadAddTags(store, 'L1')).toEqual([])

    await saveAddTags(store, 'L1', ['PS4', 'WIN'])
    expect(await loadAddTags(store, 'L1')).toEqual(['PS4', 'WIN'])
    expect(await loadAddTags(store, 'L2')).toEqual([])
  })

  it('reads a damaged value as nothing', async () => {
    expect(await loadAddTags(fakeStore({ 'list:L1:addTags': 'nope' }).store, 'L1')).toEqual([])
    expect(await loadAddTags(fakeStore({ 'list:L1:addTags': '["PS4", 3]' }).store, 'L1')).toEqual(['PS4'])
  })
})

describe('Hide Completed, remembered per list (18.2)', () => {
  it('is off until switched on, then per list', async () => {
    const { store } = fakeStore()
    expect(await loadHideDone(store, 'L1')).toBe(false)

    await saveHideDone(store, 'L1', true)
    expect(await loadHideDone(store, 'L1')).toBe(true)
    expect(await loadHideDone(store, 'L2')).toBe(false)

    await saveHideDone(store, 'L1', false)
    expect(await loadHideDone(store, 'L1')).toBe(false)
  })

  it('reads a damaged value as off', async () => {
    expect(await loadHideDone(fakeStore({ 'list:L1:hideDone': 'yes please' }).store, 'L1')).toBe(false)
  })

  it('does not throw when the store fails', async () => {
    const store: PreferencesStore = {
      get: async () => {
        throw new Error('blocked')
      },
      set: async () => {
        throw new Error('blocked')
      },
    }

    expect(await loadHideDone(store, 'L1')).toBe(false)
    await expect(saveHideDone(store, 'L1', true)).resolves.toBeUndefined()
  })
})
