import { describe, expect, it } from 'vitest'
import { makeKeyPair, signLikeTauri } from './minisignTesting.js'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkSignedInstaller, filesHoldingText, filesIn, keyTextProblem, pubkeyFileProblem, withRunPublicKey } from './updaterTestConfig.js'

/**
 * Tests of the three checks the updater test workflow makes around its throw-away key (Phase 31, task 31.6, rules S1 to S4 and S7):
 * the test app trusts the run's key and never the real one, the signed installer verifies against the run's key and FAILS against the
 * real one, and nothing that is uploaded holds the key's text. The keys here are made by Node, at run time, for the test.
 */

const runKey = makeKeyPair('1111111111111111')
const realKey = makeKeyPair('2222222222222222')
const testConfig = () => ({
  productName: 'ListulatorUpdaterTest',
  identifier: 'com.listulator.desktop.updatertest',
  plugins: { updater: { endpoints: ['http://127.0.0.1:8099/latest.json'], dangerousInsecureTransportProtocol: true } },
})

describe('withRunPublicKey', () => {
  it("puts the run's public key into the updater block and changes nothing else", () => {
    const config = withRunPublicKey(testConfig(), runKey.pubkey, realKey.pubkey)

    expect(config).toEqual({ ...testConfig(), plugins: { updater: { ...testConfig().plugins.updater, pubkey: runKey.pubkey } } })
  })

  it('does not change the config it was given', () => {
    const given = testConfig()
    withRunPublicKey(given, runKey.pubkey, realKey.pubkey)

    expect(given).toEqual(testConfig())
  })

  it("refuses the app's REAL public key, by its text and by its key ID: a test app must never trust the real key", () => {
    expect(() => withRunPublicKey(testConfig(), realKey.pubkey, realKey.pubkey)).toThrow(/real public key/)
    expect(() => withRunPublicKey(testConfig(), `${realKey.pubkey}\n`, realKey.pubkey)).toThrow(/real public key/)
    const sameId = makeKeyPair('2222222222222222')
    expect(() => withRunPublicKey(testConfig(), sameId.pubkey, realKey.pubkey)).toThrow(/real public key/)
  })

  it('refuses a text that is not a minisign public key', () => {
    expect(() => withRunPublicKey(testConfig(), 'not a key', realKey.pubkey)).toThrow(/not a minisign public key/)
    expect(() => withRunPublicKey(testConfig(), '', realKey.pubkey)).toThrow(/not a minisign public key/)
  })

  it('refuses a committed config that already carries a public key: the key belongs to the run, not to the repository', () => {
    const carrying = testConfig()
    ;(carrying.plugins.updater as Record<string, unknown>)['pubkey'] = realKey.pubkey

    expect(() => withRunPublicKey(carrying, runKey.pubkey, realKey.pubkey)).toThrow(/already has a pubkey/)
  })

  it('refuses a config with no updater block to put it in', () => {
    expect(() => withRunPublicKey({ productName: 'x' }, runKey.pubkey, realKey.pubkey)).toThrow(/updater/)
  })
})

describe('checkSignedInstaller', () => {
  const installer = Buffer.from('an installer, as bytes')
  const trusted = (version: string) => `timestamp:1791501219\tfile:setup.exe\tversion:${version}`
  const signed = (version = '1.0.0-rc.2', data: Uint8Array = installer) => signLikeTauri(runKey.privateKey, runKey.keyIdBytes, data, trusted(version))
  const check = (overrides: Partial<Parameters<typeof checkSignedInstaller>[0]> = {}) =>
    checkSignedInstaller({ runPubkey: runKey.pubkey, realPubkey: realKey.pubkey, installer, signature: signed(), version: '1.0.0-rc.2', ...overrides })

  it('has nothing to say about an installer signed by the run key for its version', () => {
    expect(check()).toEqual([])
  })

  it("says so when the signature does not verify against the run's key (a changed file)", () => {
    expect(check({ installer: Buffer.from('another file') }).join(' | ')).toMatch(/does not verify against the run's public key/)
  })

  it('says so when it was signed for another version (the plugin would refuse it)', () => {
    expect(check({ version: '1.0.0-rc.3' }).join(' | ')).toMatch(/signed for version 1\.0\.0-rc\.2, not 1\.0\.0-rc\.3/)
  })

  it('says so when it was signed by a different key than the run key', () => {
    const other = makeKeyPair('3333333333333333')
    const signature = signLikeTauri(other.privateKey, other.keyIdBytes, installer, trusted('1.0.0-rc.2'))

    expect(check({ signature }).join(' | ')).toMatch(/does not verify against the run's public key/)
  })

  it('says so when the REAL public key would accept the signature: the negative control must fail', () => {
    const forged = signLikeTauri(realKey.privateKey, realKey.keyIdBytes, installer, trusted('1.0.0-rc.2'))

    expect(check({ runPubkey: realKey.pubkey, realPubkey: realKey.pubkey, signature: forged }).join(' | ')).toMatch(/verifies against the real public key/)
  })

  it('says so when the update is not newer than the app it is offered to: the test would prove nothing', () => {
    expect(check({ installedVersion: '1.0.0-rc.1' })).toEqual([])
    expect(check({ installedVersion: '1.0.0-rc.2' }).join(' | ')).toMatch(/not newer than the installed 1\.0\.0-rc\.2/)
    expect(check({ installedVersion: '1.0.0' }).join(' | ')).toMatch(/not newer than the installed 1\.0\.0/)
  })

  it('says so when the signature file is not a signature', () => {
    expect(check({ signature: 'nonsense' }).length).toBeGreaterThan(0)
  })
})

describe('filesHoldingText', () => {
  const secret = ['the', 'run', 'key', 'text'].join('-')
  const files = [
    { path: 'out/installer.exe', text: 'binary-ish content' },
    { path: 'out/latest.json', text: '{"version":"1.0.0-rc.2"}' },
  ]

  it('names no file when none holds the text', () => {
    expect(filesHoldingText(files, secret)).toEqual([])
  })

  it('names the files that hold it, anywhere in their text', () => {
    expect(filesHoldingText([...files, { path: 'out/oops.txt', text: `before ${secret} after` }], secret)).toEqual(['out/oops.txt'])
  })

  it('finds the text whatever surrounds it and also when it has a trailing newline of its own', () => {
    expect(filesHoldingText([{ path: 'a', text: `x${secret}` }], `${secret}\n`)).toEqual(['a'])
  })

  it('never matches on an empty text: an empty key file must not flag every file', () => {
    expect(filesHoldingText(files, '')).toEqual([])
    expect(filesHoldingText(files, '\n')).toEqual([])
  })
})

describe('filesHoldingText in other forms', () => {
  // A key file is base64 text itself, so it is a valid base64 string; its decoded bytes, its re-encoding and its UTF-16 form are the other shapes it can take.
  const secret = Buffer.from('a stand-in for a key file, long enough to search for: 0123456789').toString('base64')
  const latin1 = (bytes: Buffer) => bytes.toString('latin1')
  const hold = (text: string) => filesHoldingText([{ path: 'f', text }], secret)

  it('finds it encoded once more as base64', () => {
    expect(hold(`x ${Buffer.from(secret).toString('base64')} y`)).toEqual(['f'])
  })

  it('finds its decoded bytes in a binary file', () => {
    expect(hold(`MZ\u0000\u0001${latin1(Buffer.from(secret, 'base64'))}\u0002`)).toEqual(['f'])
  })

  it('finds it as UTF-16 text', () => {
    expect(hold(`before${latin1(Buffer.from(secret, 'utf16le'))}after`)).toEqual(['f'])
  })

  it('does not look inside compressed data: a known limit, written down so nobody believes otherwise', () => {
    // The installer's payload is LZMA-compressed. Nothing here can see through that; what keeps a key out of it is that no build step
    // is given the key text, and the guard on the workflow (updaterTestProblems), not this search.
    expect(hold(latin1(Buffer.from('\x1f\x8b\x08compressed bytes that no longer contain the text')))).toEqual([])
  })
})

describe('keyTextProblem', () => {
  it('accepts a key-sized text', () => {
    expect(keyTextProblem('q'.repeat(300))).toBeUndefined()
  })

  it('refuses an empty or short key file: searching for it would find everything or nothing', () => {
    expect(keyTextProblem('')).toMatch(/too short/)
    expect(keyTextProblem('\n')).toMatch(/too short/)
    expect(keyTextProblem('short')).toMatch(/too short/)
  })
})

describe('pubkeyFileProblem', () => {
  it('accepts a .pub file and refuses anything else, so a private key file cannot be the one embedded', () => {
    expect(pubkeyFileProblem('/tmp/run/updater-test-run.key.pub')).toBeUndefined()
    expect(pubkeyFileProblem('/tmp/run/updater-test-run.key')).toMatch(/\.pub/)
    expect(pubkeyFileProblem('/tmp/run/pubkey.txt')).toMatch(/\.pub/)
  })
})

describe('filesIn', () => {
  it('lists the files under a folder, and does not follow a link back up (no endless walk)', () => {
    const root = mkdtempSync(join(tmpdir(), 'filesin-'))
    try {
      mkdirSync(join(root, 'sub'))
      writeFileSync(join(root, 'a.txt'), 'a')
      writeFileSync(join(root, 'sub', 'b.txt'), 'b')
      symlinkSync(root, join(root, 'sub', 'loop'))
      symlinkSync(join(root, 'a.txt'), join(root, 'link.txt'))

      expect(filesIn(root).map((path) => path.slice(root.length + 1)).sort()).toEqual(['a.txt', 'sub/b.txt'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
