import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeKeyPair, signLikeTauri } from './minisignTesting.js'
import type { Runner } from './releaseSign.js'
import { createVerifyHost, parseReleaseVerifyArguments, releaseVerify, verifiedLine, verifiedReported, type VerifyHost } from './releaseVerify.js'
import { serializeManifest } from './updateManifest.js'

/**
 * `npm run release:verify -- [tag]` (31.4): the read-only check of a PUBLISHED release, as an app and a user see it: the public
 * `latest.json`, the files it points at, `SHA256SUMS`, every signature against the public key of that tag, and the build
 * attestations, with a negative control (the previous tag's commit must be refused). Tested against a fake GitHub that serves real
 * bytes and REAL signatures (Node's Ed25519 in the Tauri format), so every cryptographic check runs for real.
 */

const REPO_URL = 'https://github.com/gerharar/listulator/releases'
const TAG = 'v1.1.0'
const VERSION = '1.1.0'
const PREVIOUS = 'v1.0.2'
const EXE = `Listulator_${VERSION}_x64-setup.exe`
const DMG = `Listulator_${VERSION}_aarch64.dmg`
const TAR = 'Listulator.app.tar.gz'
const SUMS = 'SHA256SUMS'
const COMMIT = 'a'.repeat(40)
const PREVIOUS_COMMIT = 'b'.repeat(40)
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const downloadUrl = (tag: string, name: string) => `${REPO_URL}/download/${tag}/${name}`
/** The installer and the disk image carry their release's version in their names; the update archive does not. */
const exeOf = (tag: string) => `Listulator_${tag.slice(1)}_x64-setup.exe`
const dmgOf = (tag: string) => `Listulator_${tag.slice(1)}_aarch64.dmg`
const LATEST_MANIFEST_URL = `${REPO_URL}/latest/download/latest.json`

const app = makeKeyPair('738FF42772526511')
const other = makeKeyPair('61BCBF5980E87475')

interface World {
  tags: string[]
  /** What each public address answers with, or the error it fails with. Filled by `world()` for TAG. */
  urls: Map<string, Buffer | Error>
  pubkey: string
  /** The key read from the tagged config fails with this (for the tag only: the previous release's key is read separately). */
  pubkeyFails?: Error
  /** The key the PREVIOUS release's config carries (what an installed app of it trusts); the tag's key by default. */
  previousPubkey?: string
  /** Reading the PREVIOUS release's key fails with this. */
  previousPubkeyFails?: Error
  /** The update addresses each release's config carries, or the error reading them fails with. */
  endpoints?: Record<string, string[] | Error>
  commits: Record<string, string | Error>
  /** Whether `gh attestation verify` passes for a file name, a tag and a commit. */
  attested: (name: string, tag: string, commit: string) => boolean
}

interface Served {
  exe: Buffer
  dmg: Buffer
  tar: Buffer
  sums: Buffer
  manifest: Buffer
}

/** The files of a good release, and the text of its manifest, as made by the release pipeline and `release:sign`. */
function goodFiles(over: { tag?: string; signedVersion?: string; signer?: ReturnType<typeof makeKeyPair>; manifestTag?: string } = {}): Served {
  const tag = over.tag ?? TAG
  const exe = Buffer.from('the windows installer'.repeat(100))
  const dmg = Buffer.from('the disk image'.repeat(100))
  const tar = Buffer.from('the app archive'.repeat(100))
  const sums = Buffer.from([[exe, exeOf(tag)], [dmg, dmgOf(tag)], [tar, TAR]].map(([data, name]) => `${sha(data as Buffer)}  ${name as string}\n`).join(''))
  const signer = over.signer ?? app
  const signedVersion = over.signedVersion ?? tag.slice(1)
  const sign = (data: Buffer, name: string) => signLikeTauri(signer.privateKey, signer.keyIdBytes, data, `timestamp:1791727313\tfile:${name}\tversion:${signedVersion}`)
  // Written by hand, not by `buildManifest`: that refuses to build a manifest with a wrong signed version, and the tests need one.
  const at = over.manifestTag ?? tag
  const entry = (name: string, data: Buffer) => ({ signature: sign(data, name), url: downloadUrl(at, name) })
  const manifest = Buffer.from(
    serializeManifest({ version: at.slice(1), pub_date: '2026-10-19T20:51:15Z', platforms: { 'windows-x86_64': entry(exeOf(tag), exe), 'darwin-aarch64': entry(TAR, tar) } }),
  )

  return { exe, dmg, tar, sums, manifest }
}

function world(over: Partial<World> = {}, served: Served = goodFiles(), tag = TAG): World {
  const urls = new Map<string, Buffer | Error>([
    [downloadUrl(tag, exeOf(tag)), served.exe],
    [downloadUrl(tag, dmgOf(tag)), served.dmg],
    [downloadUrl(tag, TAR), served.tar],
    [downloadUrl(tag, SUMS), served.sums],
    [downloadUrl(tag, 'latest.json'), served.manifest],
    [LATEST_MANIFEST_URL, served.manifest],
  ])

  return {
    tags: [PREVIOUS, TAG, 'v1.0.1'],
    urls,
    pubkey: app.pubkey,
    commits: { [TAG]: COMMIT, [PREVIOUS]: PREVIOUS_COMMIT },
    // A build attestation names the commit it was built from; only that one passes.
    attested: (_name, t, commit) => commit === (t === TAG ? COMMIT : PREVIOUS_COMMIT),
    ...over,
  }
}

interface Fake {
  host: VerifyHost
  keyReads: string[]
  endpointReads: string[]
  fetched: string[]
  attestations: { name: string; tag: string; commit: string; onDisk: boolean; dir: string }[]
}

function fake(w: World): Fake {
  const out: Fake = { keyReads: [], endpointReads: [], fetched: [], attestations: [], host: undefined as unknown as VerifyHost }
  out.host = {
    publishedTags: async () => w.tags,
    fetchBytes: async (url) => {
      out.fetched.push(url)
      const answer = w.urls.get(url)
      if (answer === undefined) throw new Error('404 Not Found')
      if (answer instanceof Error) throw answer
      return answer
    },
    pubkey: async (tag) => {
      out.keyReads.push(tag)
      if (w.pubkeyFails !== undefined && tag === TAG) throw w.pubkeyFails
      if (w.previousPubkeyFails !== undefined && tag === PREVIOUS) throw w.previousPubkeyFails

      return tag === PREVIOUS && w.previousPubkey !== undefined ? w.previousPubkey : w.pubkey
    },
    updaterEndpoints: async (tag) => {
      out.endpointReads.push(tag)
      const endpoints = w.endpoints?.[tag] ?? [LATEST_MANIFEST_URL]
      if (endpoints instanceof Error) throw endpoints

      return endpoints
    },
    tagCommit: async (tag) => {
      const commit = w.commits[tag]
      if (commit === undefined) throw new Error(`no commit for ${tag}`)
      if (commit instanceof Error) throw commit
      return commit
    },
    verifyAttestation: async (file, tag, commit) => {
      const name = basename(file)
      out.attestations.push({ name, tag, commit, onDisk: existsSync(file), dir: dirname(file) })
      // The file the attestation is checked on must be the bytes that were served, not a stand-in.
      const served = [...w.urls.entries()].find(([url]) => url.endsWith(`/${name}`) && url.includes('/download/'))?.[1]
      if (served instanceof Buffer && existsSync(file) && !readFileSync(file).equals(served)) return false

      return w.attested(name, tag, commit)
    },
  }

  return out
}

async function verify(w: World, tag?: string) {
  const f = fake(w)
  const log: string[] = []
  const result = await releaseVerify({ ...(tag === undefined ? {} : { tag }) }, f.host, (line) => log.push(line))

  return { ...f, result, log }
}

describe('a published release that is as it should be', () => {
  it('has no failures, and says what it checked', async () => {
    const { result, log } = await verify(world(), TAG)

    expect(result).toEqual({ tag: TAG, failures: [] })
    expect(log.join('\n')).toMatch(/latest\.json/)
    expect(log.join('\n')).toMatch(new RegExp(EXE.replace(/\./g, '\\.')))
  })

  it('checks the newest published release when no tag is named, by version and not by the order of the list', async () => {
    const w = world({ tags: ['v1.0.1', 'v1.1.0', 'v1.0.2', 'v1.0.0'] })

    const { result } = await verify(w)

    expect(result).toEqual({ tag: TAG, failures: [] })
  })

  it('reads the manifest the app reads (releases/latest/download) when the tag is the latest one', async () => {
    const { fetched } = await verify(world(), TAG)

    expect(fetched).toContain(LATEST_MANIFEST_URL)
    expect(fetched).not.toContain(downloadUrl(TAG, 'latest.json'))
  })

  it('reads the tag’s own manifest when the tag is an older release', async () => {
    const w = world({ commits: { [TAG]: COMMIT, [PREVIOUS]: PREVIOUS_COMMIT, 'v1.0.1': 'c'.repeat(40) } }, goodFiles({ tag: PREVIOUS }), PREVIOUS)

    const { fetched, result } = await verify(w, PREVIOUS)

    expect(result.failures).toEqual([])
    expect(fetched).toContain(downloadUrl(PREVIOUS, 'latest.json'))
    expect(fetched).not.toContain(LATEST_MANIFEST_URL)
  })

  it('verifies the attestation of all three files against the tag’s commit, on the bytes that were served', async () => {
    const { attestations } = await verify(world(), TAG)

    const right = attestations.filter((entry) => entry.commit === COMMIT)
    expect(right.map((entry) => entry.name).sort()).toEqual([DMG, EXE, TAR].sort())
    expect(right.every((entry) => entry.tag === TAG && entry.onDisk)).toBe(true)
  })

  it('runs the negative control: every file is checked once more with the PREVIOUS tag’s commit', async () => {
    const { attestations } = await verify(world(), TAG)

    const wrong = attestations.filter((entry) => entry.commit === PREVIOUS_COMMIT)
    expect(wrong.map((entry) => entry.name).sort()).toEqual([DMG, EXE, TAR].sort())
  })

  it('takes the previous release by version, not the one listed next to it', async () => {
    const w = world({ tags: ['v1.0.1', 'v1.0.0', 'v1.1.0', 'v1.0.2'], commits: { [TAG]: COMMIT, 'v1.0.2': PREVIOUS_COMMIT, 'v1.0.1': 'c'.repeat(40) } })

    const { attestations, result } = await verify(w, TAG)

    expect(result.failures).toEqual([])
    expect(attestations.some((entry) => entry.commit === PREVIOUS_COMMIT)).toBe(true)
    expect(attestations.some((entry) => entry.commit === 'c'.repeat(40))).toBe(false)
  })
})

describe('what makes it fail, one line each', () => {
  it('fails when the tag is not a published release, and checks nothing else', async () => {
    const { result, fetched } = await verify(world(), 'v9.9.9')

    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatch(/v9\.9\.9.*not a published release/)
    expect(fetched).toEqual([])
  })

  it('fails when there is no published release at all and none is named', async () => {
    await expect(verify(world({ tags: [] }))).rejects.toThrow(/no published release/i)
  })

  it('fails a manifest that announces another version than the tag', async () => {
    const files = goodFiles({ manifestTag: 'v1.0.9', signedVersion: '1.0.9' })
    const w = world({}, files)

    const { result } = await verify(w, TAG)

    expect(result.failures.some((line) => /latest\.json/.test(line) && /1\.0\.9/.test(line) && /v1\.1\.0/.test(line))).toBe(true)
  })

  it('fails a file whose bytes are not the ones SHA256SUMS lists (a wrong hash)', async () => {
    const w = world()
    w.urls.set(downloadUrl(TAG, EXE), Buffer.from('a different installer'))

    const { result } = await verify(w, TAG)

    expect(result.failures.some((line) => line.includes(EXE) && /SHA256SUMS/.test(line))).toBe(true)
    // A changed file also no longer matches its signature: that is reported separately, not hidden by the first line.
    expect(result.failures.some((line) => line.includes(EXE) && /signature/i.test(line))).toBe(true)
  })

  it('fails a SHA256SUMS that does not list exactly the three files', async () => {
    const files = goodFiles()
    const w = world({}, { ...files, sums: Buffer.from(files.sums.toString().split('\n').slice(0, 2).join('\n') + '\n') })

    const { result } = await verify(w, TAG)

    expect(result.failures.some((line) => /SHA256SUMS does not list exactly/.test(line))).toBe(true)
  })

  it('fails a platform address that does not answer, and still checks the other platform and the attestations', async () => {
    const w = world()
    w.urls.set(downloadUrl(TAG, EXE), new Error('getaddrinfo ENOTFOUND github.com'))

    const { result, attestations, log } = await verify(w, TAG)

    expect(result.failures.some((line) => line.includes(downloadUrl(TAG, EXE)) && /ENOTFOUND/.test(line))).toBe(true)
    expect(log.join('\n')).toMatch(/Listulator\.app\.tar\.gz.*signature/)
    expect(attestations.some((entry) => entry.name === TAR)).toBe(true)
  })

  it('fails a signature made with another key', async () => {
    const w = world({}, goodFiles({ signer: other }))

    const { result } = await verify(w, TAG)

    expect(result.failures.some((line) => /signature/i.test(line) && /73|61BCBF5980E87475/i.test(line))).toBe(true)
  })

  it('fails a signature whose bytes do not cover the file served (a bad signature)', async () => {
    const files = goodFiles()
    const forged = goodFiles()
    // The manifest's signatures are over other bytes than the ones the release serves.
    forged.exe = Buffer.from('the windows installer'.repeat(99))
    const w = world({}, { ...files, manifest: forged.manifest, exe: forged.exe, sums: Buffer.from(files.sums.toString().replace(sha(files.exe), sha(forged.exe))) })

    const { result } = await verify(w, TAG)

    expect(result.failures.some((line) => line.includes(EXE) && /signature does not match/i.test(line))).toBe(true)
  })

  it('fails a signature that binds another version than the tag', async () => {
    const w = world({}, goodFiles({ signedVersion: '1.0.2' }))

    const { result } = await verify(w, TAG)

    expect(result.failures.some((line) => /signature is for version 1\.0\.2/.test(line))).toBe(true)
  })

  it('checks the signatures against the key of THAT tag: another key in the config fails them', async () => {
    const { result } = await verify(world({ pubkey: other.pubkey }), TAG)

    expect(result.failures.some((line) => /signature/i.test(line))).toBe(true)
  })

  it('fails a public key that is not a minisign key', async () => {
    const { result } = await verify(world({ pubkey: Buffer.from('not a key').toString('base64') }), TAG)

    expect(result.failures.some((line) => /public key/i.test(line))).toBe(true)
  })

  it('does not fetch an address the manifest points to when it is not this repository’s download for this tag', async () => {
    const files = goodFiles()
    const text = files.manifest.toString().replace(downloadUrl(TAG, EXE), 'https://example.invalid/evil.exe')
    const w = world({}, { ...files, manifest: Buffer.from(text) })

    const { result, fetched } = await verify(w, TAG)

    expect(fetched).not.toContain('https://example.invalid/evil.exe')
    expect(result.failures.some((line) => /url must be exactly/.test(line))).toBe(true)
  })

  it('fails a manifest that is not JSON', async () => {
    const w = world({}, { ...goodFiles(), manifest: Buffer.from('<html>Not Found</html>') })

    const { result } = await verify(w, TAG)

    expect(result.failures.some((line) => /latest\.json is not JSON/.test(line))).toBe(true)
  })

  it('fails a file with no attestation from this repository’s workflow', async () => {
    const w = world({ attested: (name, _tag, commit) => name !== DMG && commit === COMMIT })

    const { result } = await verify(w, TAG)

    expect(result.failures.some((line) => line.includes(DMG) && /attestation/i.test(line))).toBe(true)
    expect(result.failures.some((line) => line.includes(EXE) && /attestation/i.test(line))).toBe(false)
  })

  it('fails when the attestation check accepts the previous tag’s commit too: then it proves nothing', async () => {
    const w = world({ attested: () => true })

    const { result } = await verify(w, TAG)

    expect(result.failures.some((line) => /accepts the previous tag/i.test(line))).toBe(true)
  })

  it('does not count the control as passed when the file had failed the real check first', async () => {
    const w = world({ attested: () => false })

    const { result, attestations } = await verify(w, TAG)

    expect(result.failures.filter((line) => /attestation/i.test(line))).toHaveLength(3)
    // A refusal of the wrong commit means nothing when the right one is refused as well: the control is not run then.
    expect(attestations.some((entry) => entry.commit === PREVIOUS_COMMIT)).toBe(false)
  })

  it('fails when the tag’s commit cannot be read, and says the attestations were not checked', async () => {
    const w = world({ commits: { [TAG]: new Error('gh: HTTP 404') } })

    const { result, attestations } = await verify(w, TAG)

    expect(result.failures.some((line) => /commit/i.test(line) && /404/.test(line))).toBe(true)
    expect(attestations).toEqual([])
  })

  it('reports a manifest that is the JSON text null as a failure, not as a crash', async () => {
    const w = world({}, { ...goodFiles(), manifest: Buffer.from('null') })

    const { result } = await verify(w, TAG)

    expect(result.failures.some((line) => /latest\.json: the manifest is not an object/.test(line))).toBe(true)
  })

  it('fails a latest.json that does not answer, and still checks the files and the attestations', async () => {
    const w = world()
    w.urls.set(LATEST_MANIFEST_URL, new Error('503 Service Unavailable'))

    const { result, attestations } = await verify(w, TAG)

    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatch(/latest\/download\/latest\.json.*503/)
    expect(attestations.length).toBeGreaterThan(0)
  })

  it('fails when the public key of the tag cannot be read, once, and still checks everything else', async () => {
    const { result, attestations } = await verify(world({ pubkeyFails: new Error('gh: HTTP 404') }), TAG)

    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatch(/public key of v1\.1\.0 could not be read.*404/)
    expect(attestations.length).toBeGreaterThan(0)
  })

  it('fails when the previous tag’s commit cannot be read, and says the control was not run', async () => {
    const w = world({ commits: { [TAG]: COMMIT, [PREVIOUS]: new Error('gh: HTTP 404') } })

    const { result, attestations } = await verify(w, TAG)

    expect(result.failures.some((line) => line.includes(PREVIOUS) && /negative control was not run/.test(line))).toBe(true)
    expect(attestations.every((entry) => entry.commit === COMMIT)).toBe(true)
  })

  it('removes the downloaded files when it is done, also when it fails', async () => {
    for (const w of [world(), world({ attested: () => false })]) {
      const { attestations } = await verify(w, TAG)
      const dirs = new Set(attestations.map((entry) => entry.dir))

      expect(dirs.size).toBe(1)
      expect(existsSync([...dirs][0]!)).toBe(false)
    }
  })

  it('has every failure on one line', async () => {
    const w = world({ pubkey: other.pubkey, attested: () => true }, goodFiles({ signedVersion: '1.0.2' }))

    const { result } = await verify(w, TAG)

    expect(result.failures.length).toBeGreaterThan(2)
    expect(result.failures.every((line) => !line.includes('\n'))).toBe(true)
  })
})

describe('the update path: what an app installed at the previous release does with this release', () => {
  it('asks the address that release carries, is offered this version, and accepts the signatures: all said in one line', async () => {
    const { result, log } = await verify(world(), TAG)

    expect(result.failures).toEqual([])
    expect(log.join('\n')).toMatch(new RegExp(`An installed ${PREVIOUS.replace(/\./g, '\\.')} asks https://github\\.com/.*/latest/download/latest\\.json, is offered ${TAG.replace(/\./g, '\\.')} and accepts the signatures of ${EXE.replace(/\./g, '\\.')} and Listulator\\.app\\.tar\\.gz`))
  })

  it('reads the endpoint and the key from the PREVIOUS release’s own config, not the tag’s', async () => {
    const { endpointReads, keyReads } = await verify(world(), TAG)

    expect(endpointReads).toEqual([PREVIOUS])
    expect(keyReads).toEqual([TAG, PREVIOUS])
  })

  it('fails when the previous release asks another address than the feed this release is served on: its installed apps would never see it', async () => {
    const { result } = await verify(world({ endpoints: { [PREVIOUS]: ['https://example.invalid/latest.json'] } }), TAG)

    expect(result.failures).toEqual([expect.stringMatching(/installed v1\.0\.2 asks https:\/\/example\.invalid\/latest\.json first, not https:\/\/github\.com\/.*latest\.json.*never see v1\.1\.0/)])
  })

  it('requires the feed to be the FIRST address an installed copy asks (Tauri tries them in order), and allows a fallback after it', async () => {
    const wrongFirst = await verify(world({ endpoints: { [PREVIOUS]: ['https://example.invalid/latest.json', LATEST_MANIFEST_URL] } }), TAG)
    const fallback = await verify(world({ endpoints: { [PREVIOUS]: [LATEST_MANIFEST_URL, 'https://example.invalid/latest.json'] } }), TAG)

    expect(wrongFirst.result.failures).toEqual([expect.stringMatching(/installed v1\.0\.2 asks https:\/\/example\.invalid\/latest\.json first, not https:\/\/github\.com\/.*latest\.json/)])
    expect(fallback.result.failures).toEqual([])
  })

  it('does not say all is well when it could not check both update files, and says how many it checked', async () => {
    const w = world()
    w.urls.set(downloadUrl(TAG, EXE), new Error('getaddrinfo ENOTFOUND github.com'))

    const { result, log } = await verify(w, TAG)

    expect(result.failures.some((line) => /update path could not be checked for all update files \(1 of 2\)/.test(line))).toBe(true)
    expect(log.join('\n')).not.toMatch(/An installed .* accepts the signatures/)
  })

  it('fails when the previous release carries no address at all', async () => {
    const { result } = await verify(world({ endpoints: { [PREVIOUS]: [] } }), TAG)

    expect(result.failures).toEqual([expect.stringMatching(/installed v1\.0\.2 asks no address/)])
  })

  it('fails when the previous release’s endpoints cannot be read', async () => {
    const { result } = await verify(world({ endpoints: { [PREVIOUS]: new Error('gh: HTTP 404') } }), TAG)

    expect(result.failures).toEqual([expect.stringMatching(/update address of v1\.0\.2 could not be read.*404/)])
  })

  it('fails when the feed would not offer an installed previous release anything newer', async () => {
    const { result } = await verify(world({}, goodFiles({ manifestTag: 'v1.0.1', signedVersion: '1.0.1' })), TAG)

    expect(result.failures.some((line) => /installed v1\.0\.2 would not be offered v1\.1\.0.*announces 1\.0\.1/.test(line))).toBe(true)
  })

  it('does not count the SAME version as an offer: an installed copy is offered something newer, nothing else', async () => {
    const { result } = await verify(world({}, goodFiles({ manifestTag: 'v1.0.2', signedVersion: '1.0.2' })), TAG)

    expect(result.failures.some((line) => /installed v1\.0\.2 would not be offered v1\.1\.0.*announces 1\.0\.2/.test(line))).toBe(true)
  })

  it('fails a signature the PREVIOUS release’s key does not accept, even when this release’s own key does: that is the key an installed app trusts', async () => {
    const { result } = await verify(world({ previousPubkey: other.pubkey }), TAG)

    expect(result.failures).toHaveLength(2)
    expect(result.failures.every((line) => /an installed v1\.0\.2 would reject this update/.test(line))).toBe(true)
    expect(result.failures.some((line) => line.includes(EXE))).toBe(true)
    expect(result.failures.some((line) => line.includes(TAR))).toBe(true)
  })

  it('fails when the previous release’s key cannot be read, or is not a minisign key', async () => {
    const notAKey = await verify(world({ previousPubkey: Buffer.from('not a key').toString('base64') }), TAG)
    const unreadable = await verify(world({ previousPubkeyFails: new Error('gh: HTTP 404') }), TAG)

    expect(notAKey.result.failures).toEqual([expect.stringMatching(/public key of v1\.0\.2 is not a minisign public key/)])
    expect(unreadable.result.failures).toEqual([expect.stringMatching(/public key of v1\.0\.2 could not be read.*404/)])
  })

  it('does not say all is well in the update path when anything in it failed', async () => {
    const cases = [
      world({ endpoints: { [PREVIOUS]: ['https://example.invalid/latest.json'] } }),
      world({ previousPubkey: other.pubkey }),
      world({ previousPubkeyFails: new Error('gh: HTTP 404') }),
      world({ endpoints: { [PREVIOUS]: new Error('gh: HTTP 404') } }),
    ]

    for (const w of cases) {
      const { log } = await verify(w, TAG)

      expect(log.join('\n')).not.toMatch(/An installed .* accepts the signatures/)
    }
  })

  it('is not run for an older release (the feed does not serve it), nor for the first release (nothing was installed before it)', async () => {
    const older = await verify(world({}, goodFiles({ tag: PREVIOUS }), PREVIOUS), PREVIOUS)
    const first = await verify(world({ tags: ['v1.0.0'], commits: { 'v1.0.0': COMMIT }, attested: (_n, _t, commit) => commit === COMMIT }, goodFiles({ tag: 'v1.0.0' }), 'v1.0.0'), 'v1.0.0')

    expect(older.endpointReads).toEqual([])
    expect(first.endpointReads).toEqual([])
    expect(first.result.failures).toEqual([])
  })

  it('says nothing more when latest.json could not be read: that failure is the whole story', async () => {
    const w = world()
    w.urls.set(LATEST_MANIFEST_URL, new Error('503 Service Unavailable'))

    const { result } = await verify(w, TAG)

    expect(result.failures).toHaveLength(1)
  })
})

describe('the first release, which has no earlier one', () => {
  it('skips the negative control, says so, and is not a failure', async () => {
    const w = world({ tags: ['v1.0.0'], commits: { 'v1.0.0': COMMIT }, attested: (_name, _tag, commit) => commit === COMMIT }, goodFiles({ tag: 'v1.0.0' }), 'v1.0.0')

    const { result, log, attestations } = await verify(w, 'v1.0.0')

    expect(result.failures).toEqual([])
    expect(log.join('\n')).toMatch(/no earlier release.*negative control not run/i)
    expect(attestations.every((entry) => entry.commit === COMMIT)).toBe(true)
  })

  it('fails when the previous tag points at the same commit: the control could not tell them apart', async () => {
    const w = world({ commits: { [TAG]: COMMIT, [PREVIOUS]: COMMIT } })

    const { result } = await verify(w, TAG)

    expect(result.failures.some((line) => /same commit/i.test(line))).toBe(true)
  })
})

describe('what release:ship reads as the sign that this script ran', () => {
  it('ends with a line that says the tag is verified, and release:ship recognises that very line, after the lines of the checks', () => {
    expect(verifiedReported(`ok    latest.json  announces 1.1.0\n${verifiedLine(TAG)}\n`)).toBe(true)
    expect(verifiedLine(TAG)).toBe('v1.1.0: verified')
  })

  it('does not take a failure, silence or other text for it', () => {
    expect(verifiedReported('')).toBe(false)
    expect(verifiedReported('FAIL  something\nv1.1.0: 1 problem\n')).toBe(false)
    expect(verifiedReported('not verified yet')).toBe(false)
  })
})

describe('the command line', () => {
  it('takes no tag (the latest) or one tag', () => {
    expect(parseReleaseVerifyArguments([])).toEqual({})
    expect(parseReleaseVerifyArguments(['v1.1.0'])).toEqual({ tag: 'v1.1.0' })
  })

  it.each([
    ['two tags', ['v1.1.0', 'v1.0.2']],
    ['an option', ['--dry-run']],
    ['a name that is not a tag', ['main']],
    ['a tag with a path in it', ['v1.1.0/../x']],
  ])('refuses %s, in words', (_name, args) => {
    expect(typeof parseReleaseVerifyArguments(args)).toBe('string')
  })
})

describe('the real GitHub CLI and HTTPS calls, as they are made', () => {
  interface Call {
    command: string
    args: string[]
  }

  function recorder(answer: (call: Call) => { code: number; stdout: string } = () => ({ code: 0, stdout: '' })) {
    const calls: Call[] = []
    const runner: Runner = async (command, args) => {
      const call = { command, args }
      calls.push(call)
      return { ...answer(call), stderr: '' }
    }

    return { calls, runner }
  }

  const noFetch = (async () => {
    throw new Error('no network in this test')
  }) as unknown as typeof fetch

  it('lists the published stable releases only, drafts and pre-releases excluded, and keeps real version tags', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: JSON.stringify([{ tagName: 'v1.1.0' }, { tagName: 'v1.0.2' }, { tagName: 'nightly' }]) }))

    expect(await createVerifyHost(runner, noFetch).publishedTags()).toEqual(['v1.1.0', 'v1.0.2'])
    expect(calls[0]).toEqual({ command: 'gh', args: ['release', 'list', '--repo', 'gerharar/listulator', '--exclude-drafts', '--exclude-pre-releases', '--limit', '100', '--json', 'tagName'] })
  })

  it('says so when gh cannot list the releases', async () => {
    const { runner } = recorder(() => ({ code: 1, stdout: '' }))

    await expect(createVerifyHost(runner, noFetch).publishedTags()).rejects.toThrow(/list/)
  })

  it('reads the public key from the tag on GitHub, not from whatever is checked out', async () => {
    const config = JSON.stringify({ plugins: { updater: { pubkey: app.pubkey } } })
    const { calls, runner } = recorder(() => ({ code: 0, stdout: config }))

    expect(await createVerifyHost(runner, noFetch).pubkey(TAG)).toBe(app.pubkey)
    expect(calls[0]!.command).toBe('gh')
    expect(calls[0]!.args).toEqual(['api', '-H', 'Accept: application/vnd.github.raw', `repos/gerharar/listulator/contents/apps/desktop/src-tauri/tauri.conf.json?ref=${TAG}`])
  })

  it('fails when the tagged config has no updater key', async () => {
    const { runner } = recorder(() => ({ code: 0, stdout: '{}' }))

    await expect(createVerifyHost(runner, noFetch).pubkey(TAG)).rejects.toThrow(/updater public key/)
  })

  it('reads the commit a tag points at from GitHub, annotated tags included, and insists on a full hash', async () => {
    const good = recorder(() => ({ code: 0, stdout: `${COMMIT}\n` }))
    expect(await createVerifyHost(good.runner, noFetch).tagCommit(TAG)).toBe(COMMIT)
    expect(good.calls[0]!.args).toEqual(['api', `repos/gerharar/listulator/commits/${TAG}`, '--jq', '.sha'])

    const bad = recorder(() => ({ code: 0, stdout: 'not a hash' }))
    await expect(createVerifyHost(bad.runner, noFetch).tagCommit(TAG)).rejects.toThrow(/commit/)
    const failed = recorder(() => ({ code: 1, stdout: '' }))
    await expect(createVerifyHost(failed.runner, noFetch).tagCommit(TAG)).rejects.toThrow(/commit/)
  })

  it('verifies an attestation exactly as release:sign does: this workflow, this tag, this commit', async () => {
    const { calls, runner } = recorder()

    expect(await createVerifyHost(runner, noFetch).verifyAttestation('/tmp/dir/x.exe', TAG, COMMIT)).toBe(true)
    expect(calls[0]!.args).toEqual(['attestation', 'verify', '/tmp/dir/x.exe', '--repo', 'gerharar/listulator', '--signer-workflow', 'gerharar/listulator/.github/workflows/release.yml', '--source-ref', `refs/tags/${TAG}`, '--source-digest', COMMIT])
  })

  it('fetches a public address over HTTPS and returns its bytes', async () => {
    const seen: string[] = []
    const fetcher = (async (url: string) => {
      seen.push(url)
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }) as unknown as typeof fetch

    const bytes = await createVerifyHost(recorder().runner, fetcher).fetchBytes(downloadUrl(TAG, SUMS))

    expect([...bytes]).toEqual([1, 2, 3])
    expect(seen).toEqual([downloadUrl(TAG, SUMS)])
  })

  it('gives every download a time limit, so a hung connection cannot hang a scheduled run', async () => {
    let signal: AbortSignal | null | undefined
    const fetcher = (async (_url: string, init?: RequestInit) => {
      signal = init?.signal
      return new Response(new Uint8Array([1]), { status: 200 })
    }) as unknown as typeof fetch

    await createVerifyHost(recorder().runner, fetcher).fetchBytes(downloadUrl(TAG, SUMS))

    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal!.aborted).toBe(false)
  })

  it('fails an address that answers with an error status, naming the status', async () => {
    const fetcher = (async () => new Response('Not Found', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch

    await expect(createVerifyHost(recorder().runner, fetcher).fetchBytes(downloadUrl(TAG, EXE))).rejects.toThrow(/404/)
  })

  it('refuses an address that is not https', async () => {
    await expect(createVerifyHost(recorder().runner, noFetch).fetchBytes('http://github.com/x')).rejects.toThrow(/https/)
  })
})
