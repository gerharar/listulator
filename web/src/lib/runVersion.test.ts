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

// The release tooling compares versions too (`server/src/tools/updateManifest.ts`, `compareVersions`), and the two cannot share code (separate
// workspaces). They follow the same rules instead, Semantic Versioning 2.0.0 section 11, so the app and the manifest check never disagree.
describe('isNewerVersion follows Semantic Versioning precedence', () => {
  const CHAIN = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'] as const

  it('orders the specification’s own example chain, in every pair', () => {
    for (const [later, laterVersion] of CHAIN.entries()) {
      for (const [earlier, earlierVersion] of CHAIN.entries()) {
        expect(isNewerVersion(laterVersion, earlierVersion), `${laterVersion} is newer than ${earlierVersion}`).toBe(later > earlier)
      }
    }
  })

  it.each([
    // Identifiers are compared as ASCII text: capitals before lower case, "-" inside an identifier is part of it.
    ['1.0.0-alpha', '1.0.0-RC.1', true],
    ['1.0.0-alpha', '1.0.0-Alpha', true],
    ['1.0.0-alpha-1', '1.0.0-alpha.1', true],
    ['1.0.0-x-y', '1.0.0-x.y', true],
    // An identifier with a letter is text, even when it starts with digits; a number is smaller than text.
    ['1.0.0-rc.01x', '1.0.0-rc.2', true],
    ['1.0.0-alpha', '1.0.0-1', true],
    ['1.0.0-2', '1.0.0-1', true],
    // A longer list of identifiers is later when the shorter one is its start.
    ['1.0.0-a.b.c', '1.0.0-a.b', true],
  ] as const)('%s is newer than %s: %s', (a, b, expected) => {
    expect(isNewerVersion(a, b)).toBe(expected)
    expect(isNewerVersion(b, a)).toBe(!expected)
  })

  it.each([
    ['01.0.0', '0.9.0'],
    ['1.0.0-rc..1', '1.0.0-rc'],
    ['1.0.0-rc.', '1.0.0-rc'],
    ['1.0.0-01', '1.0.0-0'],
    ['1.0.0+build.5', '1.0.0-rc.1'],
  ] as const)('does not call %s newer than %s: it is not a version', (a, b) => {
    expect(isNewerVersion(a, b)).toBe(false)
  })
})
