import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KEY_ROTATION_PATH, declaredSignerOf, parseKeyRotation } from './keyRotation.js'

/**
 * The bridge release of a key rotation is NAMED in a file committed with it (BL-141), so the tools that judge its signatures (the public check, the
 * daily canary, the signing) take the key from the declaration in the release's own reviewed tree and not from a guess. The file lives in
 * `server/src/tools`, a reviewed path: a change to it shows in the diff `release:ship` makes the owner read.
 */

const file = (bridges: unknown) => JSON.stringify({ bridges })

describe('the declaration file', () => {
  it('is empty until a key is rotated, and the shipped file says so', () => {
    const shipped = readFileSync(join(import.meta.dirname, '../../..', KEY_ROTATION_PATH), 'utf8')

    expect(parseKeyRotation(shipped)).toEqual({ bridges: new Map() })
  })

  it('names, for a bridge release, the older release whose key signed it', () => {
    expect(parseKeyRotation(file({ 'v1.2.0': { signedWithKeyOf: 'v1.1.1' } }))).toEqual({ bridges: new Map([['v1.2.0', 'v1.1.1']]) })
  })

  it.each([
    ['text that is not JSON', 'nope', /not JSON/],
    ['JSON that is not an object', '[]', /object/],
    ['another key beside bridges', JSON.stringify({ bridges: {}, other: 1 }), /only "bridges"/],
    ['bridges that is not an object', JSON.stringify({ bridges: [] }), /"bridges" must be an object/],
    ['a bridge that is not a tag', file({ main: { signedWithKeyOf: 'v1.1.1' } }), /"main" is not a tag/],
    ['a bridge with another key than signedWithKeyOf', file({ 'v1.2.0': { signedWithKeyOf: 'v1.1.1', note: 'x' } }), /only "signedWithKeyOf"/],
    ['a signer that is not a tag', file({ 'v1.2.0': { signedWithKeyOf: 'main' } }), /signedWithKeyOf of v1\.2\.0 is not a tag/],
    ['a signer that is not older', file({ 'v1.2.0': { signedWithKeyOf: 'v1.2.0' } }), /older/],
    ['a signer that is newer', file({ 'v1.2.0': { signedWithKeyOf: 'v1.3.0' } }), /older/],
    ['a pre-release tag', file({ 'v1.2.0-rc.1': { signedWithKeyOf: 'v1.1.1' } }), /is not a tag/],
  ])('refuses %s, in words', (_name, text, expected) => {
    expect(parseKeyRotation(text)).toEqual(expect.stringMatching(expected))
  })
})

describe('what a tag’s tree declares about itself', () => {
  const text = file({ 'v1.2.0': { signedWithKeyOf: 'v1.1.1' } })

  it('is the named older release for a declared bridge release', () => {
    expect(declaredSignerOf(text, 'v1.2.0')).toEqual({ from: 'v1.1.1' })
  })

  it('is nothing for any other release, even though the file keeps the bridge for good', () => {
    expect(declaredSignerOf(text, 'v1.3.0')).toEqual({})
  })

  it('is nothing for a tree that has no such file (every release before this one)', () => {
    expect(declaredSignerOf(undefined, 'v1.1.1')).toEqual({})
  })

  it('is a problem, never a guess, for a file that is wrong', () => {
    expect(declaredSignerOf('nope', 'v1.2.0')).toEqual({ problem: expect.stringMatching(/not JSON/) })
  })
})
