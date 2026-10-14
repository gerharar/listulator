import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildTestManifest, parseTestManifestArguments, writeTestManifest } from './updaterTestManifest.js'

/** `text` as a regular expression that matches it literally (every special character escaped, the backslash too). */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The manifest for the updater's two-version test (20.13a), pointing at the local file server. Unlike `updateManifest.ts` (the
 * release's, which refuses anything that could mislead an app), this one has to be able to make a WRONG manifest on purpose
 * (an announced version other than the signed one, the wrong bundle under a platform, one platform missing) for the negative
 * cases of 20.13b. So it builds what it is told, and says in notes where the result differs from a correct one.
 */

const BASE = 'http://127.0.0.1:8099'

/** A `.sig` file's content in the form `tauri signer sign` writes, with made-up bytes. */
function signature(file: string, version: string, keyId = '738FF42772526511'): string {
  const signed = Buffer.concat([Buffer.from('ED'), Buffer.from(keyId, 'hex').reverse(), Buffer.alloc(64, 7)])
  const text = ['untrusted comment: signature from tauri secret key', signed.toString('base64'), `trusted comment: timestamp:1791727313\tfile:${file}\tversion:${version}`, Buffer.alloc(64, 9).toString('base64')]

  return Buffer.from(`${text.join('\n')}\n`).toString('base64')
}

const WIN = 'ListulatorUpdaterTest_1.0.0-rc.2_x64-setup.exe'
const MAC = 'ListulatorUpdaterTest.app.tar.gz'
const input = (over: Partial<Parameters<typeof buildTestManifest>[0]> = {}): Parameters<typeof buildTestManifest>[0] => ({
  baseUrl: BASE,
  version: '1.0.0-rc.2',
  pubDate: '2026-10-20T08:30:00Z',
  windows: { file: WIN, signature: signature(WIN, '1.0.0-rc.2') },
  mac: { file: MAC, signature: signature(MAC, '1.0.0-rc.2') },
  ...over,
})

describe('building a test manifest', () => {
  it('points each platform at the local server, with the signature as the .sig file holds it', () => {
    const { manifest, notes } = buildTestManifest(input())

    expect(manifest).toEqual({
      version: '1.0.0-rc.2',
      pub_date: '2026-10-20T08:30:00Z',
      platforms: {
        'windows-x86_64': { signature: signature(WIN, '1.0.0-rc.2'), url: `${BASE}/${WIN}` },
        'darwin-aarch64': { signature: signature(MAC, '1.0.0-rc.2'), url: `${BASE}/${MAC}` },
      },
    })
    expect(notes).toEqual([])
  })

  it('drops the newline a signature file ends with', () => {
    const { manifest } = buildTestManifest(input({ mac: { file: MAC, signature: `${signature(MAC, '1.0.0-rc.2')}\n` } }))

    expect(manifest.platforms['darwin-aarch64']?.signature).toBe(signature(MAC, '1.0.0-rc.2'))
  })

  it('can leave a platform out (the app on that platform finds no entry)', () => {
    const { manifest } = buildTestManifest(input({ windows: undefined }))

    expect(Object.keys(manifest.platforms)).toEqual(['darwin-aarch64'])
  })

  it('says so when the announced version is not the one signed (the app must refuse it)', () => {
    const { manifest, notes } = buildTestManifest(input({ version: '1.0.0-rc.3' }))

    expect(manifest.version).toBe('1.0.0-rc.3')
    expect(notes.join('\n')).toMatch(/darwin-aarch64.*signed for version 1\.0\.0-rc\.2.*announces 1\.0\.0-rc\.3/)
    expect(notes.join('\n')).toMatch(/windows-x86_64.*signed for version 1\.0\.0-rc\.2/)
  })

  it('says so when a platform points at a file its signature does not cover (the wrong bundle under a platform)', () => {
    const { notes } = buildTestManifest(input({ mac: { file: WIN, signature: signature(MAC, '1.0.0-rc.2') } }))

    expect(notes.join('\n')).toMatch(/darwin-aarch64.*signature covers ListulatorUpdaterTest\.app\.tar\.gz, the entry points at Listulator/)
  })

  it('says so when a signature was made with another key than the app’s, if it is told the app’s', () => {
    const other = signature(MAC, '1.0.0-rc.2', '61BCBF5980E87475')

    expect(buildTestManifest(input({ mac: { file: MAC, signature: other } })).notes).toEqual([])
    expect(buildTestManifest(input({ mac: { file: MAC, signature: other }, keyId: '738FF42772526511' })).notes.join('\n')).toMatch(/darwin-aarch64.*61BCBF5980E87475.*738FF42772526511/)
  })

  it('says so when a signature cannot be read at all, and still builds (a garbled signature is a case to test)', () => {
    const { manifest, notes } = buildTestManifest(input({ mac: { file: MAC, signature: 'AAAA' } }))

    expect(manifest.platforms['darwin-aarch64']?.signature).toBe('AAAA')
    expect(notes.join('\n')).toMatch(/darwin-aarch64.*signature.*four lines/)
  })

  it('refuses a base address that is not this machine’s loopback over http, so it cannot be mistaken for a real manifest', () => {
    for (const baseUrl of ['https://github.com/gerharar/listulator/releases/download/v1.0.0', 'http://example.com', 'http://127.0.0.1.example.com', 'http://127.0.0.1', 'http://127.0.0.1:8099/', 'http://localhost:8099', 'ftp://127.0.0.1:8099']) {
      expect(() => buildTestManifest(input({ baseUrl })), baseUrl).toThrow(/127\.0\.0\.1/)
    }
  })

  it('refuses a file name that is not a plain name, and a version that is not a version', () => {
    expect(() => buildTestManifest(input({ mac: { file: '../x.tar.gz', signature: 'x' } }))).toThrow(/plain file name/)
    expect(() => buildTestManifest(input({ version: 'next' }))).toThrow(/version/)
  })

  it('needs at least one platform', () => {
    expect(() => buildTestManifest(input({ windows: undefined, mac: undefined }))).toThrow(/at least one/)
  })
})

describe('the command line', () => {
  it('needs the folder and takes the files, the version, the port and a date', () => {
    expect(parseTestManifestArguments(['/tmp/files', '--mac', MAC])).toEqual({ dir: '/tmp/files', port: 8099, mac: MAC })
    expect(parseTestManifestArguments(['/tmp/files', '--windows', WIN, '--mac', MAC, '--version', '1.0.0-rc.2', '--port', '8123', '--date', '2026-10-20T08:30:00Z'])).toEqual({
      dir: '/tmp/files',
      port: 8123,
      windows: WIN,
      mac: MAC,
      version: '1.0.0-rc.2',
      date: '2026-10-20T08:30:00Z',
    })
  })

  it.each([
    ['no folder', []],
    ['no file at all', ['/tmp/files']],
    ['an option without its value', ['/tmp/files', '--mac']],
    ['an unknown option', ['/tmp/files', '--mac', MAC, '--url', 'http://example.com']],
    ['a second folder', ['/tmp/a', '/tmp/b', '--mac', MAC]],
    ['a bad port', ['/tmp/files', '--mac', MAC, '--port', 'x']],
  ])('refuses %s, in words', (_name, args) => {
    expect(typeof parseTestManifestArguments(args)).toBe('string')
  })
})

describe('writing latest.json into the folder the server serves', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'updater-manifest-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads each file’s .sig from the folder, takes the version from the signature when none is given, and writes the manifest', () => {
    writeFileSync(join(dir, MAC), 'bundle')
    writeFileSync(join(dir, `${MAC}.sig`), `${signature(MAC, '1.0.0-rc.2')}\n`)

    const result = writeTestManifest({ dir, port: 8099, mac: MAC }, () => new Date('2026-10-20T08:30:41.123Z'))

    const written = readFileSync(join(dir, 'latest.json'), 'utf8')
    expect(written).toBe(`${JSON.stringify(result.manifest, null, 2)}\n`)
    expect(JSON.parse(written)).toEqual({
      version: '1.0.0-rc.2',
      pub_date: '2026-10-20T08:30:41Z',
      platforms: { 'darwin-aarch64': { signature: signature(MAC, '1.0.0-rc.2'), url: `${BASE}/${MAC}` } },
    })
    expect(result.notes).toEqual([])
  })

  it('uses the version it is given, even when it is not the signed one, and reports the difference', () => {
    writeFileSync(join(dir, MAC), 'bundle')
    writeFileSync(join(dir, `${MAC}.sig`), signature(MAC, '1.0.0-rc.2'))

    const result = writeTestManifest({ dir, port: 8099, mac: MAC, version: '1.0.0-rc.1' }, () => new Date('2026-10-20T08:30:41Z'))

    expect(JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8')).version).toBe('1.0.0-rc.1')
    expect(result.notes.join('\n')).toMatch(/signed for version 1\.0\.0-rc\.2.*announces 1\.0\.0-rc\.1/)
  })

  it('says which file is missing instead of writing a manifest that points at nothing', () => {
    expect(() => writeTestManifest({ dir, port: 8099, mac: MAC }, () => new Date())).toThrow(new RegExp(escapeRegExp(MAC)))
    writeFileSync(join(dir, MAC), 'bundle')
    expect(() => writeTestManifest({ dir, port: 8099, mac: MAC }, () => new Date())).toThrow(/needs the file and its \.sig/)
  })
})
