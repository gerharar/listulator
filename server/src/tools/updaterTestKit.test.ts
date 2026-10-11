import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeKeyPair, signLikeTauri } from './minisignTesting.js'
import { verifyMinisign } from './minisignVerify.js'
import { buildKitScenarios, parseKitArguments, writeKit, type KitInput } from './updaterTestKit.js'

/**
 * The folders for the updater's two-version test (20.13b): one folder per test case, each holding the files and the `latest.json`
 * to serve, so that on either machine a case is "serve this folder, press this, expect that" and nobody edits a file by hand.
 * Every case is made from the SAME two real-key-signed update files; only what a case needs to be wrong is changed.
 */

const SIGNED = '1.0.0-rc.2'
const INSTALLED = '1.0.0-rc.1'
const EXE = `ListulatorUpdaterTest_${SIGNED}_x64-setup.exe`
const TAR = 'ListulatorUpdaterTest.app.tar.gz'

const app = makeKeyPair('738FF42772526511')
const exeBytes = Buffer.from('windows installer bytes. '.repeat(400))
const tarBytes = Buffer.from('mac archive bytes. '.repeat(400))
const sign = (name: string, data: Buffer, version = SIGNED) => signLikeTauri(app.privateKey, app.keyIdBytes, data, `timestamp:1791734534\tfile:${name}\tversion:${version}`)

const input = (over: Partial<KitInput> = {}): KitInput => ({
  exe: { name: EXE, bytes: exeBytes, signature: sign(EXE, exeBytes) },
  archive: { name: TAR, bytes: tarBytes, signature: sign(TAR, tarBytes) },
  installed: INSTALLED,
  pubkey: app.pubkey,
  pubDate: '2026-10-20T08:30:00Z',
  ...over,
})

/** A file of a case as bytes (a manifest is text, the update files are bytes). */
const buf = (entry: ReturnType<typeof scenario>, name: string): Buffer => Buffer.from(entry.files[name]!)
const names = (scenarios: ReturnType<typeof buildKitScenarios>) => scenarios.map((scenario) => scenario.name)
const scenario = (name: string, over: Partial<KitInput> = {}) => buildKitScenarios(input(over)).find((entry) => entry.name === name)!
const manifestOf = (entry: ReturnType<typeof scenario>) => JSON.parse(entry.files['latest.json']!.toString()) as { version: string; platforms: Record<string, { url: string; signature: string }> }

describe('the test cases', () => {
  it('has one folder per case, each named for what it tests', () => {
    expect(names(buildKitScenarios(input()))).toEqual(['ok', 'tampered', 'wrong-key', 'wrong-version', 'other-os-mac', 'other-os-windows', 'same-version', 'lower-version'])
  })

  it('ok: both update files, their real-key signatures, and a manifest that announces exactly the signed version at the local server', () => {
    const entry = scenario('ok')
    const manifest = manifestOf(entry)

    expect(Object.keys(entry.files).sort()).toEqual([EXE, `${EXE}.sig`, TAR, `${TAR}.sig`, 'latest.json'].sort())
    expect(buf(entry, EXE).equals(exeBytes)).toBe(true)
    expect(buf(entry, TAR).equals(tarBytes)).toBe(true)
    expect(manifest.version).toBe(SIGNED)
    expect(manifest.platforms['windows-x86_64']!.url).toBe(`http://127.0.0.1:8099/${EXE}`)
    expect(manifest.platforms['darwin-aarch64']!.url).toBe(`http://127.0.0.1:8099/${TAR}`)
    expect(verifyMinisign(app.pubkey, manifest.platforms['windows-x86_64']!.signature, buf(entry, EXE))).toMatchObject({ ok: true })
    expect(verifyMinisign(app.pubkey, manifest.platforms['darwin-aarch64']!.signature, buf(entry, TAR))).toMatchObject({ ok: true })
  })

  it('tampered: the files are changed by one byte after signing, the signatures and the manifest are the real ones', () => {
    const entry = scenario('tampered')
    const manifest = manifestOf(entry)

    expect(buf(entry, EXE).length).toBe(exeBytes.length)
    expect(buf(entry, EXE).equals(exeBytes)).toBe(false)
    expect(buf(entry, TAR).equals(tarBytes)).toBe(false)
    expect(differingBytes(buf(entry, EXE), exeBytes)).toBe(1)
    expect(differingBytes(buf(entry, TAR), tarBytes)).toBe(1)
    expect(manifest.version).toBe(SIGNED)
    expect(verifyMinisign(app.pubkey, manifest.platforms['windows-x86_64']!.signature, buf(entry, EXE))).toMatchObject({ ok: false })
    expect(verifyMinisign(app.pubkey, manifest.platforms['darwin-aarch64']!.signature, exeBytes)).toMatchObject({ ok: false })
    expect(verifyMinisign(app.pubkey, manifest.platforms['darwin-aarch64']!.signature, buf(entry, TAR))).toMatchObject({ ok: false })
  })

  it('wrong-key: the files are the real ones, signed by another key that is otherwise right (the same file and version in the signature)', () => {
    const entry = scenario('wrong-key')
    const manifest = manifestOf(entry)

    expect(buf(entry, EXE).equals(exeBytes)).toBe(true)
    for (const [platform, file] of [['windows-x86_64', EXE], ['darwin-aarch64', TAR]] as const) {
      const result = verifyMinisign(app.pubkey, manifest.platforms[platform]!.signature, buf(entry, file))
      expect(result).toMatchObject({ ok: false })
      expect((result as { reason: string }).reason).toMatch(/made with key [0-9A-F]{16}, not key 738FF42772526511/)
    }
    expect(manifest.platforms['windows-x86_64']!.signature).not.toBe(input().exe.signature)
  })

  it('wrong-version: the real signatures, a manifest that announces another (newer) version than the one signed', () => {
    const manifest = manifestOf(scenario('wrong-version'))

    expect(manifest.version).not.toBe(SIGNED)
    expect(manifest.version).toBe('99.0.0')
    expect(manifest.platforms['windows-x86_64']!.signature).toBe(input().exe.signature)
  })

  it('other-os-mac / other-os-windows: a manifest with only the other system’s entry, so this system finds none', () => {
    const forMac = scenario('other-os-mac')
    const forWindows = scenario('other-os-windows')

    expect(Object.keys(manifestOf(forMac).platforms)).toEqual(['windows-x86_64'])
    expect(Object.keys(manifestOf(forWindows).platforms)).toEqual(['darwin-aarch64'])
    expect(Object.keys(forMac.files).sort()).toEqual([EXE, `${EXE}.sig`, 'latest.json'].sort())
    expect(Object.keys(forWindows.files).sort()).toEqual([TAR, `${TAR}.sig`, 'latest.json'].sort())
  })

  it('same-version and lower-version: valid signatures, but a version that is not newer than the installed one', () => {
    expect(manifestOf(scenario('same-version')).version).toBe(INSTALLED)
    expect(manifestOf(scenario('lower-version')).version).toBe('0.0.1')
  })

  it('every case’s manifest is for the local server only, and has no release notes', () => {
    for (const entry of buildKitScenarios(input())) {
      const manifest = manifestOf(entry) as Record<string, unknown> & ReturnType<typeof manifestOf>
      expect(Object.keys(manifest).sort()).toEqual(['platforms', 'pub_date', 'version'])
      for (const platform of Object.values(manifest.platforms)) expect(platform.url).toMatch(/^http:\/\/127\.0\.0\.1:8099\/[A-Za-z0-9._-]+$/)
    }
  })
})

describe('what it refuses to build from', () => {
  it('signatures that do not verify against the app’s public key (made with another key than the real one)', () => {
    const other = makeKeyPair('61BCBF5980E87475')
    const bad = signLikeTauri(other.privateKey, other.keyIdBytes, exeBytes, `timestamp:1\tfile:${EXE}\tversion:${SIGNED}`)

    expect(() => buildKitScenarios(input({ exe: { name: EXE, bytes: exeBytes, signature: bad } }))).toThrow(/61BCBF5980E87475/)
  })

  it('a signature of other bytes than the file’s (the file changed after signing)', () => {
    expect(() => buildKitScenarios(input({ archive: { name: TAR, bytes: Buffer.from('changed'), signature: sign(TAR, tarBytes) } }))).toThrow(/does not match the file/)
  })

  it('two files signed for different versions', () => {
    expect(() => buildKitScenarios(input({ archive: { name: TAR, bytes: tarBytes, signature: sign(TAR, tarBytes, '1.0.0-rc.3') } }))).toThrow(/same version/)
  })

  it('a signature that names another file', () => {
    expect(() => buildKitScenarios(input({ exe: { name: EXE, bytes: exeBytes, signature: sign('other.exe', exeBytes) } }))).toThrow(/other\.exe/)
  })

  it.each(['1.0.0', '1.0.1', '2.3.4'])('a signed version of %s, which is a version that is or may be shipped: a test build signed with the real key must stay below the first release', (version) => {
    const exe = `ListulatorUpdaterTest_${version}_x64-setup.exe`

    expect(() =>
      buildKitScenarios(input({ installed: '1.0.0-rc.1', exe: { name: exe, bytes: exeBytes, signature: sign(exe, exeBytes, version) }, archive: { name: TAR, bytes: tarBytes, signature: sign(TAR, tarBytes, version) } })),
    ).toThrow(/below 1\.0\.0/)
  })

  it('an installed version that is not older than the signed one (there would be no update to test)', () => {
    expect(() => buildKitScenarios(input({ installed: SIGNED }))).toThrow(/older/)
    expect(() => buildKitScenarios(input({ installed: '2.0.0' }))).toThrow(/older/)
    expect(() => buildKitScenarios(input({ installed: 'x' }))).toThrow(/installed version.*is not a version/)
  })

  it('a public key it cannot read', () => {
    expect(() => buildKitScenarios(input({ pubkey: 'nope' }))).toThrow(/public key/)
  })
})

function differingBytes(a: Buffer, b: Buffer): number {
  let count = 0
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) count++

  return count
}

describe('writing the folders', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'updater-kit-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function files(): string {
    const dir = join(root, 'in')
    mkdirSync(dir)
    writeFileSync(join(dir, EXE), exeBytes)
    writeFileSync(join(dir, `${EXE}.sig`), `${sign(EXE, exeBytes)}\n`)
    writeFileSync(join(dir, TAR), tarBytes)
    writeFileSync(join(dir, `${TAR}.sig`), `${sign(TAR, tarBytes)}\n`)

    return dir
  }

  it('reads the two files and their .sig files from a folder and writes one folder per case', () => {
    const out = join(root, 'out')

    const result = writeKit({ inDir: files(), outDir: out, installed: INSTALLED, pubkey: app.pubkey, now: () => new Date('2026-10-20T08:30:41Z') })

    expect(readdirSync(out).sort()).toEqual(['lower-version', 'ok', 'other-os-mac', 'other-os-windows', 'same-version', 'tampered', 'wrong-key', 'wrong-version'])
    expect(readdirSync(join(out, 'ok')).sort()).toEqual([EXE, `${EXE}.sig`, TAR, `${TAR}.sig`, 'latest.json'].sort())
    expect(readFileSync(join(out, 'ok', EXE)).equals(exeBytes)).toBe(true)
    expect(JSON.parse(readFileSync(join(out, 'ok', 'latest.json'), 'utf8')).pub_date).toBe('2026-10-20T08:30:41Z')
    expect(result.scenarios).toHaveLength(8)
  })

  it('refuses an output folder that already has something in it (it would mix two kits)', () => {
    const out = join(root, 'out')
    mkdirSync(out)
    writeFileSync(join(out, 'old.txt'), 'x')

    expect(() => writeKit({ inDir: files(), outDir: out, installed: INSTALLED, pubkey: app.pubkey })).toThrow(/not empty/)
    expect(existsSync(join(out, 'ok'))).toBe(false)
  })

  it('says which .sig is missing, so the file is signed first', () => {
    const dir = files()
    rmSync(join(dir, `${TAR}.sig`))

    expect(() => writeKit({ inDir: dir, outDir: join(root, 'out'), installed: INSTALLED, pubkey: app.pubkey })).toThrow(/needs ListulatorUpdaterTest\.app\.tar\.gz\.sig/)
  })

  it('says what is missing from the input folder', () => {
    const dir = join(root, 'in')
    mkdirSync(dir)
    writeFileSync(join(dir, TAR), tarBytes)

    expect(() => writeKit({ inDir: dir, outDir: join(root, 'out'), installed: INSTALLED, pubkey: app.pubkey })).toThrow(/x64-setup\.exe/)
  })
})

describe('the command line', () => {
  it('needs the input and output folders and the installed version', () => {
    expect(parseKitArguments(['/in', '/out', '--installed', '1.0.0-rc.1'])).toEqual({ inDir: '/in', outDir: '/out', installed: '1.0.0-rc.1' })
  })

  it.each([
    ['no folders', ['--installed', '1.0.0-rc.1']],
    ['one folder', ['/in', '--installed', '1.0.0-rc.1']],
    ['no installed version', ['/in', '/out']],
    ['an unknown option', ['/in', '/out', '--installed', '1.0.0-rc.1', '--port', '1']],
    ['a third folder', ['/in', '/out', '/x', '--installed', '1.0.0-rc.1']],
    ['--installed without a value', ['/in', '/out', '--installed']],
  ])('refuses %s, in words', (_name, args) => {
    expect(typeof parseKitArguments(args)).toBe('string')
  })
})
