import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildManifest,
  compareVersions,
  isOffered,
  keyIdOfPublicKey,
  manifestProblems,
  parseSignature,
  serializeManifest,
  type PlatformKey,
  type UpdateManifest,
} from './updateManifest.js'

/** The updater key the app trusts (20.9c): the ID is recorded in DECISIONS, the public key is in `tauri.conf.json`. */
const REAL_KEY_ID = '738FF42772526511'
const PREFIX = 'https://github.com/gerharar/listulator/releases/download'

/**
 * A signature in the form `tauri signer sign` writes (the content of a `.sig` file, which is the base64 of a minisign
 * signature file): an untrusted comment, the signature line (`ED` + the key's ID, little-endian, + 64 bytes), the trusted
 * comment (`timestamp:… file:… version:…`, tab-separated) and the global signature. The bytes here are made up; the
 * module reads the structure, and checking the signature against the public key is the signing script's job (20.12c).
 */
function signature(
  over: { keyId?: string; file?: string; version?: string; algorithm?: string; trusted?: string; lines?: number; signatureBytes?: number; globalBytes?: number; extraLine?: boolean } = {},
): string {
  const keyId = Buffer.from(over.keyId ?? REAL_KEY_ID, 'hex').reverse()
  const signed = Buffer.concat([Buffer.from(over.algorithm ?? 'ED'), keyId, Buffer.alloc(over.signatureBytes ?? 64, 7)])
  const trusted = over.trusted ?? `timestamp:1791727313\tfile:${over.file ?? 'Listulator.app.tar.gz'}\tversion:${over.version ?? '1.0.1'}`
  const lines = [
    'untrusted comment: signature from tauri secret key',
    signed.toString('base64'),
    `trusted comment: ${trusted}`,
    Buffer.alloc(over.globalBytes ?? 64, 9).toString('base64'),
  ].slice(0, over.lines ?? 4)
  if (over.extraLine) lines.push('a fifth line')

  return Buffer.from(`${lines.join('\n')}\n`).toString('base64')
}

const WINDOWS_FILE = (version: string) => `Listulator_${version}_x64-setup.exe`
const MAC_FILE = 'Listulator.app.tar.gz'

/** A manifest that breaks no rule, for tag v1.0.1; each case below changes one thing in it. */
function good(version = '1.0.1'): UpdateManifest {
  return {
    version,
    pub_date: '2026-10-20T08:30:00Z',
    platforms: {
      'windows-x86_64': { signature: signature({ file: WINDOWS_FILE(version), version }), url: `${PREFIX}/v${version}/${WINDOWS_FILE(version)}` },
      'darwin-aarch64': { signature: signature({ file: MAC_FILE, version }), url: `${PREFIX}/v${version}/${MAC_FILE}` },
    },
  }
}

const problems = (manifest: unknown, options: { tag?: string; keyId?: string; current?: string } = {}) =>
  manifestProblems(manifest, { tag: options.tag ?? 'v1.0.1', ...(options.keyId ? { keyId: options.keyId } : {}), ...(options.current ? { current: options.current } : {}) }).join(' | ')

describe('building the manifest', () => {
  const signatures: Record<PlatformKey, string> = { 'windows-x86_64': good().platforms['windows-x86_64'].signature, 'darwin-aarch64': good().platforms['darwin-aarch64'].signature }

  it('makes the static manifest for a tag: its version, the date given, exactly the two platforms, and no notes', () => {
    const manifest = buildManifest({ tag: 'v1.0.1', pubDate: '2026-10-20T08:30:00Z', signatures })

    expect(manifest).toEqual(good())
    expect(Object.keys(manifest)).toEqual(['version', 'pub_date', 'platforms'])
    expect(Object.keys(manifest.platforms)).toEqual(['windows-x86_64', 'darwin-aarch64'])
  })

  it('takes the signatures as the .sig files hold them, newline at the end and all', () => {
    const manifest = buildManifest({
      tag: 'v1.0.1',
      pubDate: '2026-10-20T08:30:00Z',
      signatures: { 'windows-x86_64': `${signatures['windows-x86_64']}\n`, 'darwin-aarch64': `${signatures['darwin-aarch64']}\r\n` },
    })

    expect(manifest).toEqual(good())
  })

  it('refuses to build anything that fails a rule, and says every reason', () => {
    expect(() => buildManifest({ tag: 'v1.0.1', pubDate: 'yesterday', signatures: { ...signatures, 'darwin-aarch64': '' } })).toThrow(/pub_date.*\n.*darwin-aarch64.*signature/s)
  })

  it('checks the key when it is given one, and that the version is newer than the current one', () => {
    const input = { tag: 'v1.0.1', pubDate: '2026-10-20T08:30:00Z', signatures }

    expect(() => buildManifest({ ...input, keyId: '61BCBF5980E87475' })).toThrow(/key/i)
    expect(() => buildManifest({ ...input, current: '1.0.1' })).toThrow(/newer/)
    expect(buildManifest({ ...input, keyId: REAL_KEY_ID, current: '1.0.0' })).toEqual(good())
  })

  it('writes the same text every time: fixed key order, two spaces, one newline at the end, and it checks out again', () => {
    const text = serializeManifest(good())

    expect(text).toBe(`${JSON.stringify(good(), null, 2)}\n`)
    expect(text.indexOf('"version"')).toBeLessThan(text.indexOf('"pub_date"'))
    expect(text.indexOf('"pub_date"')).toBeLessThan(text.indexOf('"platforms"'))
    expect(problems(JSON.parse(text))).toBe('')
  })
})

describe('what the manifest may say', () => {
  it('accepts one that breaks no rule, with or without a key and a current version', () => {
    expect(problems(good())).toBe('')
    expect(problems(good(), { keyId: REAL_KEY_ID, current: '1.0.0' })).toBe('')
  })

  const manifest = (change: (m: UpdateManifest & Record<string, unknown>) => void): unknown => {
    const m = structuredClone(good()) as UpdateManifest & Record<string, unknown>
    change(m)
    return m
  }
  const platforms = (m: UpdateManifest) => m.platforms as Record<string, { signature?: string; url?: string } & Record<string, unknown>>

  const refused: [string, unknown, RegExp, { tag?: string; keyId?: string; current?: string }?][] = [
    ['something that is not an object', 'latest.json', /not an object/],
    ['null', null, /not an object/],
    ['an array', [], /not an object/],
    ['release notes', manifest((m) => (m['notes'] = 'Fixes')), /unexpected key "notes"/],
    ['any other top-level key', manifest((m) => (m['channel'] = 'beta')), /unexpected key "channel"/],
    ['no version', manifest((m) => delete (m as Record<string, unknown>)['version']), /version/],
    ['a version that is not a version', manifest((m) => (m.version = 'latest')), /version/],
    ['a version with a leading v', manifest((m) => (m.version = 'v1.0.1')), /version/],
    ['a version with build metadata', manifest((m) => (m.version = '1.0.1+7')), /version/],
    ['a version that is not the tag’s', manifest((m) => (m.version = '1.0.2')), /tag/, {}],
    ['a tag without the v', good(), /tag/, { tag: '1.0.1' }],
    ['no pub_date', manifest((m) => delete (m as Record<string, unknown>)['pub_date']), /pub_date/],
    ['a date without a time', manifest((m) => (m.pub_date = '2026-10-20')), /pub_date/],
    ['a date with an offset instead of Z', manifest((m) => (m.pub_date = '2026-10-20T08:30:00+02:00')), /pub_date/],
    ['a date that is not on the calendar', manifest((m) => (m.pub_date = '2026-13-45T25:61:61Z')), /pub_date/],
    ['no platforms', manifest((m) => delete (m as Record<string, unknown>)['platforms']), /platforms/],
    ['platforms as a list', manifest((m) => ((m as Record<string, unknown>)['platforms'] = [])), /platforms/],
    ['a platform key other than the two (linux)', manifest((m) => (platforms(m)['linux-x86_64'] = platforms(m)['windows-x86_64']!)), /unexpected platform "linux-x86_64"/],
    ['an Intel Mac entry', manifest((m) => (platforms(m)['darwin-x86_64'] = platforms(m)['darwin-aarch64']!)), /unexpected platform "darwin-x86_64"/],
    ['the generic windows key', manifest((m) => (platforms(m)['windows'] = platforms(m)['windows-x86_64']!)), /unexpected platform "windows"/],
    ['the Windows entry missing', manifest((m) => delete platforms(m)['windows-x86_64']), /missing platform "windows-x86_64"/],
    ['the Mac entry missing', manifest((m) => delete platforms(m)['darwin-aarch64']), /missing platform "darwin-aarch64"/],
    ['a platform entry with another key', manifest((m) => (platforms(m)['windows-x86_64']!['format'] = 'exe')), /windows-x86_64.*unexpected key "format"/],
    ['a platform entry with no url', manifest((m) => delete platforms(m)['darwin-aarch64']!['url']), /darwin-aarch64.*url/],
    ['a platform entry that is not an object', manifest((m) => (platforms(m)['darwin-aarch64'] = 'x' as never)), /darwin-aarch64.*object/],
  ]

  it.each(refused)('refuses %s', (_name, value, expected, options) => {
    expect(problems(value, options)).toMatch(expected)
  })

  const url = (change: (u: string) => string) =>
    manifest((m) => {
      platforms(m)['windows-x86_64']!.url = change(platforms(m)['windows-x86_64']!.url!)
    })

  it.each([
    ['plain http', url((u) => u.replace('https:', 'http:'))],
    ['another host', url((u) => u.replace('github.com', 'example.com'))],
    ['a look-alike host', url((u) => u.replace('github.com', 'github.com.example.com'))],
    ['a host with user info in front', url((u) => u.replace('https://github.com', 'https://github.com@example.com'))],
    ['another owner', url((u) => u.replace('gerharar', 'someone'))],
    ['another repository', url((u) => u.replace('/listulator/', '/other/'))],
    ['the latest download path instead of the tag’s', url((u) => u.replace('/download/v1.0.1/', '/latest/download/'))],
    ['another tag', url((u) => u.replace('/v1.0.1/', '/v1.0.0/'))],
    ['a path that climbs out', url((u) => u.replace('/v1.0.1/', '/v1.0.1/../v0.9.0/'))],
    ['an encoded slash', url((u) => u.replace('Listulator_', 'x%2F..%2FListulator_'))],
    ['a query', url((u) => `${u}?token=x`)],
    ['a fragment', url((u) => `${u}#x`)],
    ['a port', url((u) => u.replace('github.com', 'github.com:8443'))],
    ['another file name', url((u) => u.replace('x64-setup.exe', 'x64-setup.msi'))],
    ['another version in the file name', url((u) => u.replace('_1.0.1_', '_1.0.0_'))],
    ['the Mac archive under the Windows entry', url((u) => u.replace(WINDOWS_FILE('1.0.1'), MAC_FILE))],
    ['a trailing space', url((u) => `${u} `)],
    ['an empty url', url(() => '')],
  ])('refuses a url with %s: it must be exactly the tag’s download address for that platform’s file', (_name, value) => {
    expect(problems(value)).toMatch(/windows-x86_64.*url/)
  })

  const signed = (platform: PlatformKey, value: unknown) =>
    manifest((m) => {
      platforms(m)[platform]!.signature = value as string
    })

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['not a text', 7],
    ['not base64', 'this is not a signature!!'],
    ['base64 of something else', Buffer.from('hello').toString('base64')],
    ['a newline at the end (the plugin would not decode it)', `${signature()}\n`],
    ['a space inside', `${signature().slice(0, 40)} ${signature().slice(40)}`],
    ['the base64 of three lines', signature({ lines: 3 })],
    ['the base64 of two lines', signature({ lines: 2 })],
    ['the base64 of five lines', signature({ extraLine: true })],
    ['a signature line of the wrong length', signature({ signatureBytes: 63 })],
    ['a global signature of the wrong length', signature({ globalBytes: 32 })],
    ['an algorithm that is not minisign’s', signature({ algorithm: 'XX' })],
    ['a trusted comment with no version', signature({ trusted: 'timestamp:1791727313\tfile:Listulator.app.tar.gz' })],
    ['a trusted comment with no file', signature({ trusted: 'timestamp:1791727313\tversion:1.0.1' })],
    ['a trusted comment with no timestamp', signature({ trusted: 'file:Listulator.app.tar.gz\tversion:1.0.1' })],
    ['a trusted comment with two versions', signature({ trusted: 'timestamp:1791727313\tfile:Listulator.app.tar.gz\tversion:1.0.1\tversion:1.0.1' })],
    ['a trusted comment with a field of its own', signature({ trusted: 'timestamp:1791727313\tfile:Listulator.app.tar.gz\tversion:1.0.1\tcomment:hi' })],
    ['a trusted comment naming a file with a path', signature({ file: '../Listulator.app.tar.gz' })],
    ['a trusted comment separated by spaces', signature({ trusted: 'timestamp:1791727313 file:Listulator.app.tar.gz version:1.0.1' })],
    ['a timestamp that is not a number', signature({ trusted: 'timestamp:soon\tfile:Listulator.app.tar.gz\tversion:1.0.1' })],
  ])('refuses a signature that is %s', (_name, value) => {
    expect(problems(signed('darwin-aarch64', value))).toMatch(/darwin-aarch64.*signature/)
  })

  it('refuses a signature of another version than the manifest announces (a replayed older file)', () => {
    const replayed = signed('darwin-aarch64', signature({ file: MAC_FILE, version: '1.0.0' }))

    expect(problems(replayed)).toMatch(/darwin-aarch64.*signature.*version 1\.0\.0.*1\.0\.1/)
  })

  it('refuses a signature of another file than the one the url names (the Windows signature under the Mac entry)', () => {
    const swapped = signed('darwin-aarch64', signature({ file: WINDOWS_FILE('1.0.1'), version: '1.0.1' }))

    expect(problems(swapped)).toMatch(/darwin-aarch64.*signature.*file/)
  })

  it('refuses a signature made with another key, when the key is known', () => {
    const other = signed('windows-x86_64', signature({ keyId: '61BCBF5980E87475', file: WINDOWS_FILE('1.0.1') }))

    expect(problems(other, { keyId: REAL_KEY_ID })).toMatch(/windows-x86_64.*signature.*61BCBF5980E87475.*738FF42772526511/)
    expect(problems(other)).toBe('')
  })

  it('reports every problem, not just the first', () => {
    const many = manifest((m) => {
      m['notes'] = 'x'
      m.pub_date = 'soon'
      platforms(m)['darwin-aarch64']!.signature = ''
    })

    expect(manifestProblems(many, { tag: 'v1.0.1' }).length).toBeGreaterThanOrEqual(3)
  })

  describe('a version that is not newer than the installed one (when it is told which)', () => {
    it.each([
      ['the same version', '1.0.1'],
      ['a higher one installed', '1.0.2'],
    ])('does not offer it for %s', (_name, current) => {
      expect(problems(good(), { current })).toMatch(/not newer than 1\./)
    })

    it('does not offer a release candidate over the release it leads up to', () => {
      const rc = good('1.0.0-rc.2')

      expect(problems(rc, { tag: 'v1.0.0-rc.2', current: '1.0.0' })).toMatch(/not newer/)
      expect(problems(rc, { tag: 'v1.0.0-rc.2', current: '1.0.0-rc.2' })).toMatch(/not newer/)
      expect(problems(rc, { tag: 'v1.0.0-rc.2', current: '1.0.0-rc.10' })).toMatch(/not newer/)
      expect(problems(rc, { tag: 'v1.0.0-rc.2', current: '1.0.0-rc.1' })).toBe('')
    })

    it('refuses a current version that is not a version, instead of guessing', () => {
      expect(problems(good(), { current: 'whatever' })).toMatch(/current version/)
    })
  })
})

describe('comparing versions (semantic versioning precedence)', () => {
  it.each([
    ['1.0.1', '1.0.0', 1],
    ['1.0.0', '1.0.1', -1],
    ['1.0.0', '1.0.0', 0],
    ['1.10.0', '1.9.0', 1],
    ['2.0.0', '1.99.99', 1],
    ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-rc.1', '1.0.0', -1],
    ['1.0.0-rc.2', '1.0.0-rc.1', 1],
    ['1.0.0-rc.10', '1.0.0-rc.2', 1],
    ['1.0.0-rc.1', '1.0.0-beta.9', 1],
    ['1.0.0-1', '1.0.0-rc', -1],
    ['1.0.0-rc', '1.0.0-rc.1', -1],
    ['1.0.0-rc.1', '1.0.0-rc.1', 0],
    // The web app compares versions too (`web/src/lib/runVersion.ts`, `isNewerVersion`) and follows the same rules; its test holds these cases as well.
    ['1.0.0-alpha.1', '1.0.0-alpha', 1],
    ['1.0.0-alpha.beta', '1.0.0-alpha.1', 1],
    ['1.0.0-beta', '1.0.0-alpha.beta', 1],
    ['1.0.0-beta.11', '1.0.0-beta.2', 1],
    ['1.0.0-alpha', '1.0.0-RC.1', 1],
    ['1.0.0-alpha', '1.0.0-Alpha', 1],
    ['1.0.0-alpha-1', '1.0.0-alpha.1', 1],
    ['1.0.0-rc.01x', '1.0.0-rc.2', 1],
  ])('%s against %s is %i', (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected)
  })

  it('refuses what is not a version', () => {
    expect(() => compareVersions('1.0', '1.0.0')).toThrow(/version/)
    expect(() => compareVersions('1.0.0', 'v1.0.0')).toThrow(/version/)
  })

  it('says whether an app at one version would be offered a manifest', () => {
    expect(isOffered(good('1.0.1'), '1.0.0')).toBe(true)
    expect(isOffered(good('1.0.1'), '1.0.1')).toBe(false)
    expect(isOffered(good('1.0.1'), '1.1.0')).toBe(false)
    expect(isOffered(good('1.0.0'), '1.0.0-rc.1')).toBe(true)
  })
})

describe('reading what the signing tool writes', () => {
  /** The `.sig` file `tauri build` (CLI 2.12.1) made in the 20.12a spike with a throw-away key: real output, not made up. */
  const REAL_SIG =
    'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSMWRPaUFXYis4WVR5bkFidE5YdHM5U0h4R3ZtcVFkVDR1UkY4WkNZSFpMUHIvTHN6OEFWVENwK3JKeER2YWdtbzRCejVjRzg0dkhUZDBaK0hhRndEbk1oaWwyekdXbndVPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkxNzI3MzEzCWZpbGU6TGlzdHVsYXRvci5hcHAudGFyLmd6CXZlcnNpb246MS4wLjAtcmMuMQppYzg0dDhXdlc1SFZxdjNvQjBDcExBU1diVG9pcTVnTm9WWlM4NFhXUzRpYitMZHFUemgrbWptOHhtNUN5TU5mV3BVZ0p4SnltK0MwY1pFdTQvRExCZz09Cg=='

  it('parses a real signature: its key, the file and the version it covers, and when it was made', () => {
    expect(parseSignature(REAL_SIG)).toEqual({ keyId: '61BCBF5980E87475', file: 'Listulator.app.tar.gz', version: '1.0.0-rc.1', timestamp: 1791727313 })
  })

  it('parses a made-up one the same way', () => {
    expect(parseSignature(signature({ file: MAC_FILE, version: '1.0.1' }))).toEqual({ keyId: REAL_KEY_ID, file: MAC_FILE, version: '1.0.1', timestamp: 1791727313 })
  })

  it('says what is wrong with one it cannot read, as text', () => {
    expect(parseSignature(`${signature()}\n`)).toMatch(/whitespace/)
    expect(parseSignature('AA==')).toMatch(/four lines/)
    expect(parseSignature('AB==')).toMatch(/not base64/)
    expect(parseSignature(signature({ file: 'a/b' }))).toMatch(/plain file name/)
    expect(typeof parseSignature('')).toBe('string')
    expect(parseSignature(signature({ lines: 3 }))).toMatch(/four lines/)
  })

  it('finds the key ID of the public key the app trusts, and it is the one recorded in DECISIONS', () => {
    const config = JSON.parse(readFileSync(fileURLToPath(new URL('../../../apps/desktop/src-tauri/tauri.conf.json', import.meta.url)), 'utf8')) as {
      plugins: { updater: { pubkey: string } }
    }

    expect(keyIdOfPublicKey(config.plugins.updater.pubkey)).toBe(REAL_KEY_ID)
  })

  it('reads nothing from a public key that is not one', () => {
    expect(keyIdOfPublicKey('')).toBeUndefined()
    expect(keyIdOfPublicKey(Buffer.from('untrusted comment: x\nnope\n').toString('base64'))).toBeUndefined()
  })
})
