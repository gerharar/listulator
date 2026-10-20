import { describe, expect, it } from 'vitest'
import { isNewerVersion, noteRunVersion } from './runVersion.js'
import type { PreferencesStore } from './preferences/store.js'

function fakeStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const writes: string[] = []
  const store: PreferencesStore = {
    async get(key) {
      return values.get(key)
    },
    async set(key, value) {
      writes.push(`${key}=${value}`)
      values.set(key, value)
    },
  }

  return { store, values, writes }
}

describe('noteRunVersion', () => {
  it('says there was no earlier start, and records this one', async () => {
    const { store, values } = fakeStore()

    await expect(noteRunVersion(store, '1.1.1')).resolves.toBeUndefined()
    expect(values.get('lastRunVersion')).toBe('1.1.1')
  })

  it('returns the version the last start recorded and replaces it', async () => {
    const { store, values } = fakeStore({ lastRunVersion: '1.1.0' })

    await expect(noteRunVersion(store, '1.1.1')).resolves.toBe('1.1.0')
    expect(values.get('lastRunVersion')).toBe('1.1.1')
  })

  it('writes nothing at a start of the same version', async () => {
    const { store, writes } = fakeStore({ lastRunVersion: '1.1.1' })

    await expect(noteRunVersion(store, '1.1.1')).resolves.toBe('1.1.1')
    expect(writes).toEqual([])
  })

  it('lets a failing store reject, so a reader can tell "unknown" from "failed"', async () => {
    const { store } = fakeStore()
    store.get = async () => {
      throw new Error('disk full')
    }

    await expect(noteRunVersion(store, '1.1.1')).rejects.toThrow('disk full')
  })
})

describe('isNewerVersion', () => {
  it.each([
    ['1.1.1', '1.1.0', true],
    ['1.2.0', '1.1.9', true],
    ['2.0.0', '1.99.99', true],
    ['1.10.0', '1.9.0', true],
    ['1.1.0', '1.1.1', false],
    ['1.1.1', '1.1.1', false],
    ['1.0.0', '1.0.0-rc.2', true],
    ['1.0.0-rc.2', '1.0.0', false],
    ['1.0.0-rc.10', '1.0.0-rc.9', true],
    ['1.0.0-rc.1', '1.0.0-rc.2', false],
    ['1.1.1', 'unknown', false],
    ['x', '1.1.0', false],
  ] as const)('%s is newer than %s: %s', (a, b, expected) => {
    expect(isNewerVersion(a, b)).toBe(expected)
  })
})
