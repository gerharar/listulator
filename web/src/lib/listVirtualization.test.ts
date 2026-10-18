import { describe, expect, it, vi } from 'vitest'
import { LIST_VIRTUALIZATION_KEY, loadVirtualization } from './listVirtualization.js'
import type { PreferencesStore } from './preferences/store.js'

/**
 * Whether a long list draws only the rows in view (Phase 25.7): the app's own preference and what the server says, read before the first
 * frame; `off` from either wins, and anything unreadable means `auto` (the safety net must never be the thing that breaks the list).
 */
const store = (value: unknown): PreferencesStore => ({
  get: vi.fn(async () => value as string | undefined),
  set: vi.fn(async () => {}),
})
const server = (answer: unknown) => async () => answer as { listVirtualization?: unknown }

describe('loadVirtualization', () => {
  it('reads the preference under the key `listVirtualization`, the one a person types into preferences.json or localStorage', async () => {
    const preferences = store('off')

    await loadVirtualization(preferences, server({ listVirtualization: 'auto' }))

    expect(LIST_VIRTUALIZATION_KEY).toBe('listVirtualization')
    expect(preferences.get).toHaveBeenCalledWith('listVirtualization')
  })

  it('is `auto` when nothing says otherwise: no preference, a server that says auto', async () => {
    expect(await loadVirtualization(store(undefined), server({ listVirtualization: 'auto' }))).toBe('auto')
  })

  it('is `off` when the preference says off, in the ways it is written by hand (a JSON file may hold a boolean)', async () => {
    for (const value of ['off', 'OFF', 'false', '0', 'no', false, 0]) {
      expect(await loadVirtualization(store(value), server({ listVirtualization: 'auto' })), String(value)).toBe('off')
    }
  })

  it('is `off` when the server says off, whatever the preference says: off wins from either source', async () => {
    expect(await loadVirtualization(store(undefined), server({ listVirtualization: 'off' }))).toBe('off')
    expect(await loadVirtualization(store('auto'), server({ listVirtualization: 'off' }))).toBe('off')
    expect(await loadVirtualization(store('off'), server({ listVirtualization: 'off' }))).toBe('off')
  })

  it('treats what it cannot read as `auto`: a preference nobody understands, a server that fails or answers nonsense', async () => {
    expect(await loadVirtualization(store('maybe'), server({ listVirtualization: 'auto' }))).toBe('auto')
    expect(
      await loadVirtualization(store(undefined), async () => {
        throw new Error('no server')
      }),
    ).toBe('auto')
    expect(await loadVirtualization(store(undefined), server({ listVirtualization: 'maybe' }))).toBe('auto')
    expect(await loadVirtualization(store(undefined), server(undefined))).toBe('auto')
    // One source failing does not lose the other's `off`.
    expect(
      await loadVirtualization(store('off'), async () => {
        throw new Error('no server')
      }),
    ).toBe('off')
  })

  it('treats a preference store that throws as `auto` for that source', async () => {
    const broken: PreferencesStore = {
      get: async () => {
        throw new Error('storage blocked')
      },
      set: async () => {},
    }

    expect(await loadVirtualization(broken, server({ listVirtualization: 'off' }))).toBe('off')
    expect(await loadVirtualization(broken, server({ listVirtualization: 'auto' }))).toBe('auto')
  })
})
