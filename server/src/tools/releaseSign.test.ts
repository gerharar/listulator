import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeKeyPair, signLikeTauri } from './minisignTesting.js'
import { createGhHost, nodeRunner, parseReleaseSignArguments, readPubkey, releaseSign, type ReleaseHost, type Runner, type TagState } from './releaseSign.js'
import { parseSignature } from './updateManifest.js'

/**
 * `npm run release:sign -- <tag>` (20.12c): downloads a draft Release's files, checks them against their checksums and their
 * build attestations, signs the two update files with the owner's updater key, builds and re-verifies `latest.json`, and uploads
 * the signatures and the manifest to the draft. Tested here against a fake GitHub and a fake signer that makes REAL signatures
 * (Node's Ed25519, in the format the Tauri CLI writes), so the final self-check runs for real. The one thing never faked in
 * its effect: nothing is uploaded unless every earlier step passed, and a failed run leaves the draft as it was.
 */

const VERSION = '1.0.1'
const TAG = `v${VERSION}`
const EXE = `Listulator_${VERSION}_x64-setup.exe`
const DMG = `Listulator_${VERSION}_aarch64.dmg`
const TAR = 'Listulator.app.tar.gz'
const SUMS = 'SHA256SUMS'
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')

const app = makeKeyPair('738FF42772526511')
const other = makeKeyPair('61BCBF5980E87475')
const CANARY = 'CANARY-PRIVATE-KEY-DO-NOT-LEAK'

let root: string
let repoRoot: string
let keyFile: string
let downloadDirs: string[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'release-sign-test-'))
  repoRoot = join(root, 'repo')
  mkdirSync(repoRoot)
  keyFile = join(root, 'owner.key')
  writeFileSync(keyFile, CANARY)
  downloadDirs = []
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

interface World {
  draft: boolean
  assets: string[]
  files: Record<string, Buffer>
  latest: string | undefined
  attested: (name: string) => boolean
  /** The `.sig` content the fake signer writes for a file, or an error it fails with. */
  signer: (name: string, data: Buffer, version: string) => string
  uploadFails: boolean
  /** Where the tag is in the owner's clone. */
  tag: TagState | Error
}

const COMMIT = 'a'.repeat(40)

function world(over: Partial<World> = {}): World {
  const files: Record<string, Buffer> = {
    [EXE]: Buffer.from('the windows installer'.repeat(100)),
    [DMG]: Buffer.from('the disk image'.repeat(100)),
    [TAR]: Buffer.from('the app archive'.repeat(100)),
  }
  files[SUMS] = Buffer.from(Object.entries(files).map(([name, data]) => `${sha(data)}  ${name}\n`).join(''))

  return {
    draft: true,
    assets: [EXE, DMG, TAR, SUMS],
    files,
    latest: undefined,
    attested: () => true,
    signer: (name, data, version) => signLikeTauri(app.privateKey, app.keyIdBytes, data, `timestamp:1791727313\tfile:${name}\tversion:${version}`),
    uploadFails: false,
    tag: { commit: COMMIT, onMain: true, checkedOut: true, clean: true },
    ...over,
  }
}

interface Fake {
  host: ReleaseHost
  calls: string[]
  uploaded: { name: string; content: Buffer }[]
  signCalls: { file: string; keyFile: string; version: string }[]
  attestedCommits: string[]
}

function fake(w: World): Fake {
  const out: Fake = { calls: [], uploaded: [], signCalls: [], attestedCommits: [], host: undefined as unknown as ReleaseHost }
  out.host = {
    tagState: async () => {
      out.calls.push('tag')
      if (w.tag instanceof Error) throw w.tag
      return w.tag
    },
    viewRelease: async () => {
      out.calls.push('view')
      return { isDraft: w.draft, assets: w.assets }
    },
    latestPublished: async () => {
      out.calls.push('latest')
      return w.latest
    },
    download: async (_tag, names, dir) => {
      out.calls.push('download')
      downloadDirs.push(dir)
      for (const name of names) {
        const data = w.files[name]
        if (data === undefined) throw new Error(`no such asset ${name}`)
        writeFileSync(join(dir, name), data)
      }
    },
    verifyAttestation: async (file, _tag, commit) => {
      out.calls.push(`attest:${basename(file)}`)
      out.attestedCommits.push(commit)
      return w.attested(basename(file))
    },
    signFile: async (file, keyFileArgument, version) => {
      out.calls.push(`sign:${basename(file)}`)
      out.signCalls.push({ file, keyFile: keyFileArgument, version })
      writeFileSync(`${file}.sig`, w.signer(basename(file), readFileSync(file), version))
    },
    upload: async (_tag, files) => {
      out.calls.push('upload')
      if (w.uploadFails) throw new Error('GitHub refused the upload')
      for (const file of files) out.uploaded.push({ name: basename(file), content: readFileSync(file) })
    },
  }

  return out
}

const options = (over: Record<string, unknown> = {}) => ({
  tag: TAG,
  dryRun: false,
  keyFile,
  pubkey: app.pubkey,
  repoRoot,
  now: () => new Date('2026-10-20T08:30:41.123Z'),
  ...over,
})

async function run(w: World, over: Record<string, unknown> = {}) {
  const f = fake(w)
  const log: string[] = []
  const result = await releaseSign(options(over), f.host, (line) => log.push(line)).then(
    (value) => ({ value, error: undefined as Error | undefined }),
    (error: Error) => ({ value: undefined, error }),
  )

  return { ...f, log, ...result }
}

describe('a release that is as it should be', () => {
  it('signs the installer and the archive, makes the manifest, and uploads the two signatures and the manifest, and nothing else', async () => {
    const r = await run(world())

    expect(r.error).toBeUndefined()
    expect(r.signCalls.map((call) => basename(call.file))).toEqual([EXE, TAR])
    expect(r.uploaded.map((file) => file.name).sort()).toEqual([`${EXE}.sig`, `${TAR}.sig`, 'latest.json'].sort())
    const manifest = JSON.parse(r.uploaded.find((file) => file.name === 'latest.json')!.content.toString()) as { version: string; pub_date: string; platforms: Record<string, { url: string; signature: string }> }
    expect(manifest.version).toBe(VERSION)
    expect(manifest.pub_date).toBe('2026-10-20T08:30:41Z')
    expect(Object.keys(manifest.platforms)).toEqual(['windows-x86_64', 'darwin-aarch64'])
    expect(manifest.platforms['windows-x86_64']!.url).toBe(`https://github.com/gerharar/listulator/releases/download/${TAG}/${EXE}`)
    expect(manifest.platforms['darwin-aarch64']!.url).toBe(`https://github.com/gerharar/listulator/releases/download/${TAG}/${TAR}`)
    expect(r.uploaded.find((file) => file.name === `${EXE}.sig`)!.content.toString()).toBe(manifest.platforms['windows-x86_64']!.signature)
  })

  it('binds each signature to the file and the tag’s version (the CLI is told --app-version)', async () => {
    const r = await run(world())

    expect(r.signCalls.map((call) => call.version)).toEqual([VERSION, VERSION])
    const sig = r.uploaded.find((file) => file.name === `${TAR}.sig`)!.content.toString()
    expect(parseSignature(sig)).toMatchObject({ file: TAR, version: VERSION, keyId: '738FF42772526511' })
  })

  it('checks every file before it signs anything: the checksums, then the attestation of the installer, the disk image and the archive', async () => {
    const r = await run(world())

    expect(r.calls).toEqual(['tag', 'view', 'download', `attest:${EXE}`, `attest:${DMG}`, `attest:${TAR}`, 'latest', `sign:${EXE}`, `sign:${TAR}`, 'upload'])
  })

  it('removes what it downloaded and signed, on success', async () => {
    const r = await run(world())

    expect(r.error).toBeUndefined()
    expect(downloadDirs).toHaveLength(1)
    expect(existsSync(downloadDirs[0]!)).toBe(false)
  })

  it('may be run again on a draft that already has signatures and a manifest: they are replaced', async () => {
    const w = world()
    w.assets = [...w.assets, `${EXE}.sig`, `${TAR}.sig`, 'latest.json']

    const r = await run(w)

    expect(r.error).toBeUndefined()
    expect(r.uploaded).toHaveLength(3)
  })

  it('offers the release over the latest published one, and not under it', async () => {
    expect((await run(world({ latest: '1.0.0' }))).error).toBeUndefined()
    for (const latest of ['1.0.1', '1.0.2', '2.0.0']) expect((await run(world({ latest }))).error?.message).toMatch(/not newer/)
  })

  it('takes the current version from --current when it is given, without asking GitHub', async () => {
    const r = await run(world({ latest: '9.9.9' }), { current: '1.0.0' })

    expect(r.error).toBeUndefined()
    expect(r.calls).not.toContain('latest')
  })
})

describe('which commit it signs for (20.14: the tools run on the key machine, and the attestation must bind the commit)', () => {
  const nothingHappened = (r: Awaited<ReturnType<typeof run>>) => {
    expect(r.calls).not.toContain('download')
    expect(r.signCalls).toEqual([])
    expect(r.uploaded).toEqual([])
  }

  it('checks that every file was built from the commit the tag points at: the attestation is asked for that commit', async () => {
    const r = await run(world({ tag: { commit: 'b'.repeat(40), onMain: true, checkedOut: true, clean: true } }))

    expect(r.error).toBeUndefined()
    expect(r.attestedCommits).toEqual(['b'.repeat(40), 'b'.repeat(40), 'b'.repeat(40)])
  })

  it('refuses a tag whose commit is not on main, before it downloads anything', async () => {
    const r = await run(world({ tag: { commit: COMMIT, onMain: false, checkedOut: true, clean: true } }))

    expect(r.error?.message).toMatch(/not on main/)
    nothingHappened(r)
  })

  it('refuses to sign when the tag is not what is checked out, and says the exact commands', async () => {
    const r = await run(world({ tag: { commit: COMMIT, onMain: true, checkedOut: false, clean: true } }))

    expect(r.error?.message).toContain(`git checkout ${TAG} && npm ci --ignore-scripts`)
    nothingHappened(r)
  })

  it('refuses to sign from a working tree with changes in it', async () => {
    const r = await run(world({ tag: { commit: COMMIT, onMain: true, checkedOut: true, clean: false } }))

    expect(r.error?.message).toMatch(/changes/)
    nothingHappened(r)
  })

  it('lets a dry run be made from anywhere (it signs nothing), but still wants the tag on main', async () => {
    const elsewhere = { commit: COMMIT, onMain: true, checkedOut: false, clean: false }

    expect((await run(world({ tag: elsewhere }), { dryRun: true, keyFile: undefined })).error).toBeUndefined()
    expect((await run(world({ tag: { ...elsewhere, onMain: false } }), { dryRun: true, keyFile: undefined })).error?.message).toMatch(/not on main/)
  })

  it('stops with the reason when the tag is not in the clone', async () => {
    const r = await run(world({ tag: new Error(`The tag ${TAG} is not in this clone: run git fetch --tags`) }))

    expect(r.error?.message).toMatch(/git fetch --tags/)
    nothingHappened(r)
  })
})

describe('a key rotation: the new key must be one the owner named', () => {
  const newKey = makeKeyPair('0123456789ABCDEF')
  const rotation = { newPubkey: newKey.pubkey, newKeyId: '0123456789ABCDEF' }

  it('signs when the tag carries the key whose ID the owner named (any letter case)', async () => {
    expect((await run(world(), { rotation })).error).toBeUndefined()
    expect((await run(world(), { rotation: { ...rotation, newKeyId: '0123456789abcdef' } })).error).toBeUndefined()
  })

  it('refuses a tag that carries another key than the one named, before it downloads or signs anything', async () => {
    const r = await run(world(), { rotation: { newPubkey: other.pubkey, newKeyId: '0123456789ABCDEF' } })

    expect(r.error?.message).toMatch(/61BCBF5980E87475/)
    expect(r.error?.message).toMatch(/0123456789ABCDEF/)
    expect(r.calls).not.toContain('download')
    expect(r.signCalls).toEqual([])
  })

  it('refuses a "rotation" to the key the apps already trust', async () => {
    const r = await run(world(), { rotation: { newPubkey: app.pubkey, newKeyId: '738FF42772526511' } })

    expect(r.error?.message).toMatch(/same key/)
    expect(r.signCalls).toEqual([])
  })

  it('refuses a new key that is not a minisign public key', async () => {
    const r = await run(world(), { rotation: { newPubkey: 'not a key', newKeyId: '0123456789ABCDEF' } })

    expect(r.error?.message).toMatch(/new public key/)
    expect(r.signCalls).toEqual([])
  })
})

describe('what makes it stop before anything is signed or uploaded', () => {
  const nothingChanged = (r: Awaited<ReturnType<typeof run>>) => {
    expect(r.signCalls).toEqual([])
    expect(r.uploaded).toEqual([])
    expect(r.calls).not.toContain('upload')
    for (const dir of downloadDirs) expect(existsSync(dir)).toBe(false)
  }

  it.each([
    ['a tag that is not v and a version', { tag: '1.0.1' }, /tag/],
    ['a tag with a path in it', { tag: 'v1.0.1/../x' }, /tag/],
  ])('refuses %s', async (_name, over, expected) => {
    const r = await run(world(), over)

    expect(r.error?.message).toMatch(expected)
    expect(r.calls).toEqual([])
  })

  it('refuses a release that is already published: its files are not for signing', async () => {
    const r = await run(world({ draft: false }))

    expect(r.error?.message).toMatch(/not a draft/)
    expect(r.calls).toEqual(['tag', 'view'])
  })

  it('refuses a draft that lacks one of the four files', async () => {
    const r = await run(world({ assets: [EXE, DMG, SUMS] }))

    expect(r.error?.message).toMatch(new RegExp(TAR.replace(/\./g, '\\.')))
    nothingChanged(r)
  })

  it('refuses a draft with a file nobody expected, which it has not checked', async () => {
    const r = await run(world({ assets: [EXE, DMG, TAR, SUMS, 'Listulator_extra.zip'] }))

    expect(r.error?.message).toMatch(/Listulator_extra\.zip/)
    nothingChanged(r)
  })

  it('refuses a file that does not match its checksum (changed after the build)', async () => {
    const w = world()
    w.files[TAR] = Buffer.from('not the archive that was built')

    const r = await run(w)

    expect(r.error?.message).toMatch(new RegExp(`${TAR.replace(/\./g, '\\.')}.*checksum`))
    expect(r.calls.filter((call) => call.startsWith('attest'))).toEqual([])
    nothingChanged(r)
  })

  it.each([
    ['a checksum list that omits a file', (names: string[]) => names.slice(0, 2)],
    ['a checksum list with a file that is not in the release', (names: string[]) => [...names, 'extra.bin']],
  ])('refuses %s', async (_name, change) => {
    const w = world()
    const lines = w.files[SUMS]!.toString().split('\n').filter(Boolean)
    const names = lines.map((line) => line.split('  ')[1]!)
    const kept = change(names)
    w.files[SUMS] = Buffer.from(kept.map((name) => `${w.files[name] ? sha(w.files[name]) : 'a'.repeat(64)}  ${name}\n`).join(''))

    const r = await run(w)

    expect(r.error?.message).toMatch(/SHA256SUMS/)
    nothingChanged(r)
  })

  it('refuses a checksum list with a file named twice, even when the last line is right', async () => {
    const w = world()
    w.files[SUMS] = Buffer.from(`${'0'.repeat(64)}  ${EXE}\n${w.files[SUMS]!.toString()}`)

    const r = await run(w)

    expect(r.error?.message).toMatch(/SHA256SUMS/)
    nothingChanged(r)
  })

  it.each([EXE, DMG, TAR])('refuses a release when %s has no valid build attestation, and signs none of the files', async (bad) => {
    const r = await run(world({ attested: (name) => name !== bad }))

    expect(r.error?.message).toMatch(new RegExp(`${bad.replace(/\./g, '\\.')}.*attestation`))
    nothingChanged(r)
  })

  it('refuses a key file that does not exist', async () => {
    const r = await run(world(), { keyFile: join(root, 'missing.key') })

    expect(r.error?.message).toMatch(/key file/)
    expect(r.calls).toEqual([])
  })

  it('refuses a key file that lies inside the repository (it could be committed by accident)', async () => {
    const inside = join(repoRoot, 'updater.key')
    writeFileSync(inside, CANARY)

    const r = await run(world(), { keyFile: inside })

    expect(r.error?.message).toMatch(/inside the repository/)
    expect(r.calls).toEqual([])
  })

  it('needs a key file unless it is a dry run', async () => {
    const r = await run(world(), { keyFile: undefined })

    expect(r.error?.message).toMatch(/Name the updater key file/)
    expect(r.calls).toEqual([])
  })

  it('refuses a public key it cannot read, since it could not check the signatures', async () => {
    const r = await run(world(), { pubkey: 'not a key' })

    expect(r.error?.message).toMatch(/public key/)
    nothingChanged(r)
  })
})

describe('the check of what it signed, before anything is uploaded', () => {
  const failed = (r: Awaited<ReturnType<typeof run>>) => {
    expect(r.uploaded).toEqual([])
    expect(r.calls).not.toContain('upload')
    for (const dir of downloadDirs) expect(existsSync(dir)).toBe(false)
  }

  it('refuses a signature made with another key than the app’s, naming both keys', async () => {
    const r = await run(world({ signer: (name, data, version) => signLikeTauri(other.privateKey, other.keyIdBytes, data, `timestamp:1\tfile:${name}\tversion:${version}`) }))

    expect(r.error?.message).toMatch(/61BCBF5980E87475.*738FF42772526511/s)
    failed(r)
  })

  it('refuses a signature that carries the app’s key ID but was made by another key', async () => {
    const r = await run(world({ signer: (name, data, version) => signLikeTauri(other.privateKey, app.keyIdBytes, data, `timestamp:1\tfile:${name}\tversion:${version}`) }))

    expect(r.error?.message).toMatch(/does not match the file/)
    failed(r)
  })

  it('refuses a signature of other bytes than the file’s', async () => {
    const r = await run(world({ signer: (name, _data, version) => signLikeTauri(app.privateKey, app.keyIdBytes, Buffer.from('something else'), `timestamp:1\tfile:${name}\tversion:${version}`) }))

    expect(r.error?.message).toMatch(/does not match the file/)
    failed(r)
  })

  it('refuses a signature bound to another version than the tag’s (the signer was not told, or told wrongly)', async () => {
    const r = await run(world({ signer: (name, data) => signLikeTauri(app.privateKey, app.keyIdBytes, data, `timestamp:1\tfile:${name}\tversion:1.0.0`) }))

    expect(r.error?.message).toMatch(/version 1\.0\.0/)
    failed(r)
  })

  it('refuses a signature that names another file in its trusted comment', async () => {
    const r = await run(world({ signer: (_name, data, version) => signLikeTauri(app.privateKey, app.keyIdBytes, data, `timestamp:1\tfile:other.bin\tversion:${version}`) }))

    expect(r.error?.message).toMatch(/covers file other\.bin/)
    failed(r)
  })

  it('stops when the signer fails (a wrong passphrase, a missing key), and uploads nothing', async () => {
    const f = fake(world())
    f.host.signFile = async () => {
      throw new Error('the signer exited with 1')
    }

    const error = await releaseSign(options(), f.host, () => undefined).catch((e: Error) => e)

    expect((error as Error).message).toMatch(/signer exited with 1/)
    expect(f.uploaded).toEqual([])
    for (const dir of downloadDirs) expect(existsSync(dir)).toBe(false)
  })

  it('removes its files and reports an upload that GitHub refuses', async () => {
    const r = await run(world({ uploadFails: true }))

    expect(r.error?.message).toMatch(/refused the upload/)
    for (const dir of downloadDirs) expect(existsSync(dir)).toBe(false)
  })
})

describe('--dry-run', () => {
  it('downloads and checks everything, signs nothing, uploads nothing, and asks for no key', async () => {
    const r = await run(world(), { dryRun: true, keyFile: undefined })

    expect(r.error).toBeUndefined()
    expect(r.value?.dryRun).toBe(true)
    expect(r.calls).toEqual(['tag', 'view', 'download', `attest:${EXE}`, `attest:${DMG}`, `attest:${TAR}`])
    expect(r.signCalls).toEqual([])
    expect(r.uploaded).toEqual([])
    expect(existsSync(downloadDirs[0]!)).toBe(false)
  })

  it('says what a real run would sign and upload', async () => {
    const r = await run(world(), { dryRun: true, keyFile: undefined })

    const text = r.log.join('\n')
    expect(text).toContain(EXE)
    expect(text).toContain(TAR)
    expect(text).toMatch(/would sign/i)
    expect(text).toMatch(/latest\.json/)
  })

  it('still refuses a file whose attestation does not verify, and a checksum that does not match', async () => {
    expect((await run(world({ attested: (name) => name !== EXE }), { dryRun: true, keyFile: undefined })).error?.message).toMatch(/attestation/)
    const w = world()
    w.files[EXE] = Buffer.from('changed')
    expect((await run(w, { dryRun: true, keyFile: undefined })).error?.message).toMatch(/checksum/)
  })
})

describe('what must never appear', () => {
  it('never reads the key file: it hands the signer the path, and the passphrase is the signer’s own prompt', async () => {
    const r = await run(world())

    expect(r.error).toBeUndefined()
    expect(r.signCalls.every((call) => call.keyFile === keyFile)).toBe(true)
    expect(JSON.stringify(r.signCalls)).not.toContain(CANARY)
  })

  it('does not put the key file’s content in the log, in a signature, in the manifest or in an error', async () => {
    const ok = await run(world())
    const bad = await run(world({ attested: () => false }))

    for (const text of [...ok.log, ...ok.uploaded.map((file) => file.content.toString()), ...bad.log, bad.error?.message ?? '']) expect(text).not.toContain(CANARY)
  })

  it('logs the key’s ID and the file names and hashes, which are not secret', async () => {
    const r = await run(world())

    const text = r.log.join('\n')
    expect(text).toContain('738FF42772526511')
    expect(text).toContain(sha(world().files[TAR]!))
  })
})

describe('the command line', () => {
  it('needs a tag; takes --dry-run, --key-file and --current', () => {
    expect(parseReleaseSignArguments(['v1.0.1'])).toEqual({ tag: 'v1.0.1', dryRun: false })
    expect(parseReleaseSignArguments(['v1.0.1', '--dry-run'])).toEqual({ tag: 'v1.0.1', dryRun: true })
    expect(parseReleaseSignArguments(['v1.0.1', '--key-file', '/keys/updater.key', '--current', '1.0.0'])).toEqual({ tag: 'v1.0.1', dryRun: false, keyFile: '/keys/updater.key', current: '1.0.0' })
    expect(parseReleaseSignArguments(['v1.1.0', '--pubkey-from', 'v1.0.0', '--new-key-id', '0123456789abcdef'])).toEqual({ tag: 'v1.1.0', dryRun: false, pubkeyFrom: 'v1.0.0', newKeyId: '0123456789ABCDEF' })
    expect(parseReleaseSignArguments(['v1.1.0', '--pubkey-from'])).toMatch(/needs a value/)
  })

  it.each([
    ['--pubkey-from without --new-key-id', ['v1.1.0', '--pubkey-from', 'v1.0.0'], /--new-key-id/],
    ['--new-key-id without --pubkey-from', ['v1.1.0', '--new-key-id', '0123456789ABCDEF'], /--pubkey-from/],
    ['a key ID that is not 16 hex digits', ['v1.1.0', '--pubkey-from', 'v1.0.0', '--new-key-id', '0123'], /16/],
    ['a --pubkey-from that is not a tag', ['v1.1.0', '--pubkey-from', 'main', '--new-key-id', '0123456789ABCDEF'], /tag/],
    ['a --pubkey-from with a path in it', ['v1.1.0', '--pubkey-from', 'v1.0.0/../x', '--new-key-id', '0123456789ABCDEF'], /tag/],
  ])('refuses %s', (_name, args, expected) => {
    expect(parseReleaseSignArguments(args)).toMatch(expected)
  })

  it.each([
    ['no tag', []],
    ['two tags', ['v1.0.1', 'v1.0.2']],
    ['an unknown option', ['v1.0.1', '--password', 'x']],
    ['--key-file without a path', ['v1.0.1', '--key-file']],
    ['a password option, which does not exist on purpose', ['v1.0.1', '-p', 'hunter2']],
  ])('refuses %s, in words', (_name, args) => {
    expect(typeof parseReleaseSignArguments(args)).toBe('string')
  })

  it('does not take -p or --password as anything but an unknown option', () => {
    expect(parseReleaseSignArguments(['v1.0.1', '-p', 'hunter2'])).toMatch(/unknown option "-p"/)
    expect(parseReleaseSignArguments(['v1.0.1', '--password', 'hunter2'])).toMatch(/unknown option/)
  })
})

describe('the real commands (GitHub CLI and the Tauri signer), as they are run', () => {
  interface Call {
    command: string
    args: string[]
    options: { inherit?: boolean; env?: Record<string, string | undefined>; cwd?: string }
  }

  function recorder(answer: (call: Call) => { code: number; stdout: string } = () => ({ code: 0, stdout: '' })) {
    const calls: Call[] = []
    const runner: Runner = async (command, args, runOptions = {}) => {
      const call = { command, args, options: runOptions }
      calls.push(call)
      return { ...answer(call), stderr: '' }
    }

    return { calls, runner }
  }

  it('looks at the release with the repository named, and reads a draft’s files by name', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: JSON.stringify({ isDraft: true, assets: [{ name: EXE }, { name: SUMS }] }) }))

    const view = await createGhHost(runner, repoRoot).viewRelease(TAG)

    expect(view).toEqual({ isDraft: true, assets: [EXE, SUMS] })
    expect(calls[0]).toMatchObject({ command: 'gh', args: ['release', 'view', TAG, '--repo', 'gerharar/listulator', '--json', 'isDraft,assets'] })
  })

  it('says there is no such release when gh fails', async () => {
    const { runner } = recorder(() => ({ code: 1, stdout: '' }))

    await expect(createGhHost(runner, repoRoot).viewRelease(TAG)).rejects.toThrow(/release/)
  })

  it('asks the latest published stable release, drafts and pre-releases excluded, and reads its version', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: JSON.stringify([{ tagName: 'v1.0.0' }]) }))

    expect(await createGhHost(runner, repoRoot).latestPublished()).toBe('1.0.0')
    expect(calls[0]!.args).toEqual(['release', 'list', '--repo', 'gerharar/listulator', '--exclude-drafts', '--exclude-pre-releases', '--limit', '1', '--json', 'tagName'])
  })

  it('has no latest published release when there is none', async () => {
    const { runner } = recorder(() => ({ code: 0, stdout: '[]' }))

    expect(await createGhHost(runner, repoRoot).latestPublished()).toBeUndefined()
  })

  it('downloads by exact file names into the folder it is given', async () => {
    const { calls, runner } = recorder()

    await createGhHost(runner, repoRoot).download(TAG, [EXE, TAR], '/tmp/dir')

    expect(calls[0]!.args).toEqual(['release', 'download', TAG, '--repo', 'gerharar/listulator', '--dir', '/tmp/dir', '--pattern', EXE, '--pattern', TAR])
  })

  it('verifies an attestation as made by THIS repository’s release workflow on THIS tag, not just by anyone', async () => {
    const { calls, runner } = recorder()

    expect(await createGhHost(runner, repoRoot).verifyAttestation('/tmp/dir/x.exe', TAG, COMMIT)).toBe(true)
    expect(calls[0]!.args).toEqual(['attestation', 'verify', '/tmp/dir/x.exe', '--repo', 'gerharar/listulator', '--signer-workflow', 'gerharar/listulator/.github/workflows/release.yml', '--source-ref', `refs/tags/${TAG}`, '--source-digest', COMMIT])
  })

  it('treats a failed verification as false, not as an exception', async () => {
    const { runner } = recorder(() => ({ code: 1, stdout: '' }))

    expect(await createGhHost(runner, repoRoot).verifyAttestation('/tmp/dir/x.exe', TAG, COMMIT)).toBe(false)
  })

  describe('where the tag is in the clone (git, no shell)', () => {
    const answers = (over: { commit?: { code: number; stdout: string }; head?: string; status?: string; ancestor?: number } = {}) =>
      recorder((call) => {
        const key = call.args.join(' ')
        if (key === `rev-parse --verify --quiet ${TAG}^{commit}`) return over.commit ?? { code: 0, stdout: `${COMMIT}\n` }
        if (key === 'rev-parse HEAD') return { code: 0, stdout: `${over.head ?? COMMIT}\n` }
        if (key === 'status --porcelain') return { code: 0, stdout: over.status ?? '' }
        if (key === `merge-base --is-ancestor ${COMMIT} origin/main`) return { code: over.ancestor ?? 0, stdout: '' }
        throw new Error(`unexpected git call: ${key}`)
      })

    it('reports the tag’s commit, that it is on origin/main, that it is checked out and that the tree is clean', async () => {
      const { calls, runner } = answers()

      expect(await createGhHost(runner, repoRoot).tagState(TAG)).toEqual({ commit: COMMIT, onMain: true, checkedOut: true, clean: true })
      expect(calls.every((call) => call.command === 'git' && call.options.cwd === repoRoot)).toBe(true)
    })

    it('reports a tag that is not on main, another checked-out commit, and a tree with changes', async () => {
      expect((await createGhHost(answers({ ancestor: 1 }).runner, repoRoot).tagState(TAG)).onMain).toBe(false)
      expect((await createGhHost(answers({ head: 'c'.repeat(40) }).runner, repoRoot).tagState(TAG)).checkedOut).toBe(false)
      expect((await createGhHost(answers({ status: ' M package.json\n' }).runner, repoRoot).tagState(TAG)).clean).toBe(false)
    })

    it('says to fetch the tags when the tag is not in the clone', async () => {
      await expect(createGhHost(answers({ commit: { code: 1, stdout: '' } }).runner, repoRoot).tagState(TAG)).rejects.toThrow(/git fetch --tags/)
    })
  })

  it('runs the Tauri signer with the key FILE, the version, a terminal of its own for the passphrase, and no secret from the environment', async () => {
    const { calls, runner } = recorder()
    const previous = { key: process.env['TAURI_SIGNING_PRIVATE_KEY'], path: process.env['TAURI_SIGNING_PRIVATE_KEY_PATH'], password: process.env['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'] }
    process.env['TAURI_SIGNING_PRIVATE_KEY'] = 'KEY-IN-ENV'
    process.env['TAURI_SIGNING_PRIVATE_KEY_PATH'] = '/elsewhere.key'
    process.env['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'] = 'PASSWORD-IN-ENV'
    try {
      await createGhHost(runner, repoRoot).signFile('/tmp/dir/x.exe', '/keys/updater.key', VERSION)
    } finally {
      for (const [name, value] of [['TAURI_SIGNING_PRIVATE_KEY', previous.key], ['TAURI_SIGNING_PRIVATE_KEY_PATH', previous.path], ['TAURI_SIGNING_PRIVATE_KEY_PASSWORD', previous.password]] as const) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }

    expect(calls[0]).toMatchObject({
      command: 'npm',
      args: ['run', 'tauri', '-w', '@listulator/desktop', '--', 'signer', 'sign', '-f', '/keys/updater.key', '--app-version', VERSION, '/tmp/dir/x.exe'],
      options: { inherit: true, cwd: repoRoot },
    })
    expect(JSON.stringify(calls[0]!.args)).not.toMatch(/-p\b|--password|-k\b|--private-key\b/)
    const env = calls[0]!.options.env!
    expect(Object.keys(env).filter((name) => name.startsWith('TAURI_SIGNING'))).toEqual([])
    expect(JSON.stringify(env)).not.toMatch(/KEY-IN-ENV|PASSWORD-IN-ENV/)
  })

  it('fails when the signer exits with an error', async () => {
    const { runner } = recorder(() => ({ code: 1, stdout: '' }))

    await expect(createGhHost(runner, repoRoot).signFile('/tmp/dir/x.exe', '/keys/updater.key', VERSION)).rejects.toThrow(/signer/)
  })

  it('uploads to the draft, replacing a file of the same name', async () => {
    const { calls, runner } = recorder()

    await createGhHost(runner, repoRoot).upload(TAG, ['/tmp/dir/a.sig', '/tmp/dir/latest.json'])

    expect(calls[0]!.args).toEqual(['release', 'upload', TAG, '/tmp/dir/a.sig', '/tmp/dir/latest.json', '--repo', 'gerharar/listulator', '--clobber'])
  })

  it('never puts a command through a shell', async () => {
    const { calls, runner } = recorder()
    const host = createGhHost(runner, repoRoot)

    await host.download(TAG, [EXE], '/tmp/dir')
    await host.upload(TAG, ['/tmp/dir/a.sig'])

    for (const call of calls) expect(call.options).not.toHaveProperty('shell')
  })
})

describe('which public key it checks against', () => {
  const config = (pubkey: string) => JSON.stringify({ plugins: { updater: { pubkey } } })

  it('reads the key the app was built with: from the tag’s commit when the tag is in this clone', async () => {
    mkdirSync(join(repoRoot, 'apps/desktop/src-tauri'), { recursive: true })
    writeFileSync(join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), config('WORKING-TREE-KEY'))
    const calls: string[][] = []
    const runner: Runner = async (_command, args) => {
      calls.push(args)
      return { code: 0, stdout: config('TAG-KEY'), stderr: '' }
    }

    const result = await readPubkey(TAG, runner, repoRoot)

    expect(result).toMatchObject({ pubkey: 'TAG-KEY' })
    expect(result.source).toContain(TAG)
    expect(calls[0]).toEqual(['show', `${TAG}:apps/desktop/src-tauri/tauri.conf.json`])
  })

  it('reads the key of another tag when asked (a key rotation: the installed apps trust the old release’s key)', async () => {
    const calls: string[][] = []
    const runner: Runner = async (_command, args) => {
      calls.push(args)
      return { code: 0, stdout: config('OLD-KEY'), stderr: '' }
    }

    const result = await readPubkey('v1.0.0', runner, repoRoot)

    expect(result.pubkey).toBe('OLD-KEY')
    expect(calls[0]).toEqual(['show', 'v1.0.0:apps/desktop/src-tauri/tauri.conf.json'])
  })

  it('does not fall back to the working tree when the tag is not here: it stops and says to fetch the tags', async () => {
    mkdirSync(join(repoRoot, 'apps/desktop/src-tauri'), { recursive: true })
    writeFileSync(join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), config('WORKING-TREE-KEY'))

    await expect(readPubkey(TAG, async () => ({ code: 128, stdout: '', stderr: 'unknown revision' }), repoRoot)).rejects.toThrow(/git fetch --tags/)
  })

  it('fails when the config has no updater key', async () => {
    await expect(readPubkey(TAG, async () => ({ code: 0, stdout: '{}', stderr: '' }), repoRoot)).rejects.toThrow(/public key/)
  })
})

describe('the runner that really starts programs', () => {
  it('hands each argument to the program as it is: no shell reads $, ; or quotes', async () => {
    const tricky = ['$(echo pwned)', '; echo pwned', '"quoted"', '`echo pwned`', 'a b']

    const result = await nodeRunner(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...tricky])

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(tricky)
  })

  it('reports a failing program’s exit code and its output instead of throwing', async () => {
    const result = await nodeRunner(process.execPath, ['-e', 'console.error("nope"); process.exit(3)'])

    expect(result).toMatchObject({ code: 3, stderr: expect.stringContaining('nope') })
  })
})
