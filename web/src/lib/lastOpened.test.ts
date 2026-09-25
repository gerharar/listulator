import { describe, expect, it } from 'vitest'
import type { PreferencesStore } from './preferences/store.js'
import { loadLastOpened, saveLastOpened } from './lastOpened.js'

function memory(): PreferencesStore & { data: Map<string, string> } {
  const data = new Map<string, string>()

  return { data, get: async (key) => data.get(key), set: async (key, value) => void data.set(key, value) }
}

describe('the last opened list', () => {
  it('remembers the list you opened most recently', async () => {
    const store = memory()

    await saveLastOpened(store, 'a')
    await saveLastOpened(store, 'b')

    expect(await loadLastOpened(store)).toBe('b')
  })

  it('is nothing before any list has been opened', async () => {
    expect(await loadLastOpened(memory())).toBeUndefined()
  })

  it('never breaks the caller when storage throws', async () => {
    const broken: PreferencesStore = {
      get: async () => {
        throw new Error('blocked')
      },
      set: async () => {
        throw new Error('blocked')
      },
    }

    await expect(saveLastOpened(broken, 'a')).resolves.toBeUndefined()
    expect(await loadLastOpened(broken)).toBeUndefined()
  })
})
