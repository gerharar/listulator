import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeKeyPair, signLikeTauri } from './minisignTesting.js'
import { verifyMinisign } from './minisignVerify.js'

/**
 * Checking an update file's signature against the app's public key, the way the updater plugin does (20.12c: the signing script
 * re-verifies everything it signed before it uploads a thing). The first fixture is REAL output of the Tauri CLI (2.12.1,
 * `signer sign --app-version 1.2.3`, a throw-away key), so the reading of the format is tested against the tool that writes it;
 * the rest is made here with Node's own Ed25519, to also produce what the CLI does not (a legacy signature, a signature by
 * another key, one with a doctored comment).
 */

/** The `.pub` file of the throw-away key, which is also how `plugins.updater.pubkey` is written in the config. */
const REAL_PUBKEY = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDYxQkNCRjU5ODBFODc0NzUKUldSMWRPaUFXYis4WWNFK1lNN2g3QXBKZG91S0ZUNFFaUHZpeldxS2hVWGRHd3lhcDhLOTJoMGkK'
/** The `.sig` the CLI wrote for `hello updater\n`. */
const REAL_SIGNATURE =
  'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSMWRPaUFXYis4WWFiT01IcVZLU0FzTllMZVFONTdkOEhqTEpTUkNCVEJiUGE5R2d4R1h3eSs0QXo5TzRCUjBONi9zKzJub1FicVluQ3duUkpXaCttc2dvU1Y2R1MrOVFnPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkxNzMyMDY5CWZpbGU6c2FtcGxlLnR4dAl2ZXJzaW9uOjEuMi4zCkVZL1ZpTEpOUkxFYy9rWThPaWQ0aUptS0toTk5jQ0Rqa2pobXZ0U3lSWFRYUFpTREM5RmlNTTJMN0pvcmFWQ0oyeStmbi9ZTVMzU1plaWFFbXoxb0JBPT0K'
const REAL_DATA = Buffer.from('hello updater\n')
const REAL_TRUSTED = 'timestamp:1791732069\tfile:sample.txt\tversion:1.2.3'
/** The updater key the app really trusts (public, from the config). */
const APP_PUBKEY = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../apps/desktop/src-tauri/tauri.conf.json', import.meta.url)), 'utf8')) as { plugins: { updater: { pubkey: string } } }).plugins.updater.pubkey

const text = (base64: string) => Buffer.from(base64, 'base64').toString('utf8')
const encode = (value: string) => Buffer.from(value).toString('base64')

describe('a signature made by the Tauri CLI', () => {
  it('verifies against its own public key, and says what the signature binds: the key, and the trusted comment', () => {
    expect(verifyMinisign(REAL_PUBKEY, REAL_SIGNATURE, REAL_DATA)).toEqual({ ok: true, keyId: '61BCBF5980E87475', trustedComment: REAL_TRUSTED })
  })

  it('does not verify other data: one byte changed, one byte added, nothing', () => {
    for (const data of [Buffer.from('hello updatex\n'), Buffer.from('hello updater\n '), Buffer.alloc(0), Buffer.from('hello updater')]) {
      expect(verifyMinisign(REAL_PUBKEY, REAL_SIGNATURE, data)).toMatchObject({ ok: false })
    }
  })

  it('does not verify against the app’s real public key: a signature by another key is refused, naming both keys', () => {
    const result = verifyMinisign(APP_PUBKEY, REAL_SIGNATURE, REAL_DATA)

    expect(result).toMatchObject({ ok: false })
    expect((result as { reason: string }).reason).toMatch(/61BCBF5980E87475.*738FF42772526511/)
  })

  it('does not verify when the trusted comment is doctored (a version changed from 1.2.3 to 9.9.9), because the comment is signed too', () => {
    const lines = text(REAL_SIGNATURE).split('\n')
    lines[2] = lines[2]!.replace('version:1.2.3', 'version:9.9.9')

    const result = verifyMinisign(REAL_PUBKEY, encode(lines.join('\n')), REAL_DATA)

    expect(result).toMatchObject({ ok: false })
    expect((result as { reason: string }).reason).toMatch(/trusted comment/)
  })

  it('does not verify when the signature bytes are changed', () => {
    const lines = text(REAL_SIGNATURE).split('\n')
    const bytes = Buffer.from(lines[1]!, 'base64')
    bytes[40] = bytes[40]! ^ 1
    lines[1] = bytes.toString('base64')

    expect(verifyMinisign(REAL_PUBKEY, encode(lines.join('\n')), REAL_DATA)).toMatchObject({ ok: false })
  })
})

describe('signatures made here, to cover what the CLI does not make', () => {
  const keyPair = () => {
    const pair = makeKeyPair()
    return { privateKey: pair.privateKey, keyId: pair.keyIdBytes, pubkey: pair.pubkey }
  }
  const minisign = (privateKey: Parameters<typeof signLikeTauri>[0], keyId: Buffer, data: Buffer, trusted: string, algorithm: 'ED' | 'Ed' = 'ED') =>
    signLikeTauri(privateKey, keyId, data, trusted, algorithm)

  const DATA = Buffer.from('an installer, in a manner of speaking'.repeat(1000))
  const TRUSTED = 'timestamp:1\tfile:x.exe\tversion:1.0.1'

  it('verifies a prehashed signature (what Tauri writes) and a legacy one (what the plugin also accepts)', () => {
    const { privateKey, keyId, pubkey } = keyPair()

    expect(verifyMinisign(pubkey, minisign(privateKey, keyId, DATA, TRUSTED, 'ED'), DATA)).toMatchObject({ ok: true, trustedComment: TRUSTED })
    expect(verifyMinisign(pubkey, minisign(privateKey, keyId, DATA, TRUSTED, 'Ed'), DATA)).toMatchObject({ ok: true, trustedComment: TRUSTED })
  })

  it('refuses a signature that claims to be prehashed but was made over the data itself, and the reverse', () => {
    const { privateKey, keyId, pubkey } = keyPair()
    const legacy = text(minisign(privateKey, keyId, DATA, TRUSTED, 'Ed')).replace(/^(.*\n)([^\n]*)/, (_whole, first: string, second: string) => {
      const bytes = Buffer.from(second, 'base64')
      bytes.write('ED', 0, 'latin1')
      return `${first}${bytes.toString('base64')}`
    })
    const prehashed = text(minisign(privateKey, keyId, DATA, TRUSTED, 'ED')).replace(/^(.*\n)([^\n]*)/, (_whole, first: string, second: string) => {
      const bytes = Buffer.from(second, 'base64')
      bytes.write('Ed', 0, 'latin1')
      return `${first}${bytes.toString('base64')}`
    })

    expect(verifyMinisign(pubkey, encode(legacy), DATA)).toMatchObject({ ok: false })
    expect(verifyMinisign(pubkey, encode(prehashed), DATA)).toMatchObject({ ok: false })
  })

  it('refuses a signature made by another key that carries this key’s ID', () => {
    const mine = keyPair()
    const theirs = keyPair()

    expect(verifyMinisign(mine.pubkey, minisign(theirs.privateKey, mine.keyId, DATA, TRUSTED), DATA)).toMatchObject({ ok: false })
  })

  it('refuses a trusted comment signed by another key, even when the file signature is good', () => {
    const mine = keyPair()
    const theirs = keyPair()
    const real = text(minisign(mine.privateKey, mine.keyId, DATA, TRUSTED)).split('\n')
    const forged = text(minisign(theirs.privateKey, mine.keyId, DATA, 'timestamp:1\tfile:x.exe\tversion:9.9.9')).split('\n')
    // The file signature of the real one, the comment and global signature of the forgery.
    const mixed = [real[0], real[1], forged[2], forged[3], ''].join('\n')

    const result = verifyMinisign(mine.pubkey, encode(mixed), DATA)

    expect(result).toMatchObject({ ok: false })
    expect((result as { reason: string }).reason).toMatch(/trusted comment/)
  })
})

describe('what a strict reader refuses although a lax one would take it', () => {
  const key = makeKeyPair()
  const data = Buffer.from('payload')
  const good = (algorithm: 'ED' | 'Ed' = 'ED') => signLikeTauri(key.privateKey, key.keyIdBytes, data, 'timestamp:1\tfile:x\tversion:1.0.0', algorithm)

  it('takes the good signatures, as the control for the cases below', () => {
    expect(verifyMinisign(key.pubkey, good('ED'), data)).toMatchObject({ ok: true })
    expect(verifyMinisign(key.pubkey, good('Ed'), data)).toMatchObject({ ok: true })
  })

  it('refuses a base64 that decodes to the same bytes but is not written canonically (spare bits set in the last character)', () => {
    const lines = text(good()).split('\n')
    const line = lines[1]!
    // 74 bytes end in one `=`; the character before it carries two spare bits, which must be zero.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const last = line[line.length - 2]!
    const twin = alphabet[alphabet.indexOf(last) + 1]!
    lines[1] = `${line.slice(0, -2)}${twin}=`

    expect(Buffer.from(lines[1]!, 'base64').equals(Buffer.from(line, 'base64'))).toBe(true)
    expect(verifyMinisign(key.pubkey, encode(lines.join('\n')), data)).toMatchObject({ ok: false })
  })

  it('refuses a signature whose algorithm bytes are neither ED nor Ed, even if its bytes would verify as a legacy one', () => {
    const lines = text(good('Ed')).split('\n')
    const bytes = Buffer.from(lines[1]!, 'base64')
    bytes.write('XX', 0, 'latin1')
    lines[1] = bytes.toString('base64')

    const result = verifyMinisign(key.pubkey, encode(lines.join('\n')), data)

    expect(result).toMatchObject({ ok: false })
    expect((result as { reason: string }).reason).toMatch(/not a minisign signature/)
  })

  it('refuses a public key whose algorithm bytes are not Ed', () => {
    const lines = text(key.pubkey).split('\n')
    const bytes = Buffer.from(lines[1]!, 'base64')
    bytes.write('XX', 0, 'latin1')
    lines[1] = bytes.toString('base64')

    const result = verifyMinisign(encode(lines.join('\n')), good(), data)

    expect(result).toMatchObject({ ok: false })
    expect((result as { reason: string }).reason).toMatch(/not a minisign public key/)
  })

  it('refuses a signature with a fifth line', () => {
    const result = verifyMinisign(key.pubkey, encode(`${text(good())}an extra line\n`), data)

    expect(result).toMatchObject({ ok: false })
    expect((result as { reason: string }).reason).toMatch(/four lines/)
  })
})

describe('what it refuses to read', () => {
  it.each([
    ['an empty public key', '', REAL_SIGNATURE],
    ['a public key that is not base64', '!!!', REAL_SIGNATURE],
    ['a public key of the wrong length', encode('untrusted comment: x\nQUJD\n'), REAL_SIGNATURE],
    ['an empty signature', REAL_PUBKEY, ''],
    ['a signature that is not base64', REAL_PUBKEY, '!!!'],
    ['a signature with three lines', REAL_PUBKEY, encode(text(REAL_SIGNATURE).split('\n').slice(0, 3).join('\n'))],
    ['a signature whose second line is short', REAL_PUBKEY, encode(['untrusted comment: x', 'QUJD', 'trusted comment: x', 'QUJD', ''].join('\n'))],
    ['a signature with no trusted comment marker', REAL_PUBKEY, encode(text(REAL_SIGNATURE).split('\n').map((line, index) => (index === 2 ? line.replace('trusted comment: ', 'comment: ') : line)).join('\n'))],
  ])('says %s is not usable, in words and without throwing', (_name, pubkey, signature) => {
    const result = verifyMinisign(pubkey, signature, REAL_DATA)

    expect(result).toMatchObject({ ok: false })
    expect(typeof (result as { reason: string }).reason).toBe('string')
  })
})
