import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkAttestations } from './attestationCheck.js'
import { verifyMinisign } from './minisignVerify.js'
import { CONFIG_PATH, REPO, createGhHost, nodeRunner, parseSums, type Runner } from './releaseSign.js'
import { isRunDirectly } from './runDirectly.js'
import { checkUpdatePath } from './updatePathCheck.js'
import { assetName, compareVersions, keyIdOfPublicKey, manifestProblems, type PlatformKey } from './updateManifest.js'
import { RELEASE_VERSION } from './versionSources.js'

/**
 * `npm run release:verify -- [tag]` (Phase 31, task 31.4). A read-only check of a PUBLISHED release, as an installed app and a
 * user see it. It changes nothing and needs no key, so the owner, `release:ship` and the scheduled canary can all run it.
 * Without a tag it checks the newest published stable release. For that tag:
 *
 *  1. `latest.json` is fetched from the public address (`releases/latest/download/` for the newest release: the one the app asks;
 *     `releases/download/<tag>/` for an older one) and judged by `updateManifest.ts`: it announces the tag's version, points at this
 *     repository's download for this tag, and carries signatures that bind that version, that file and the tag's key.
 *  2. The installer, the disk image, the update archive and `SHA256SUMS` are fetched from the public download addresses. The sums
 *     list exactly the three files and every file's bytes match.
 *  3. Each update file's signature verifies against `plugins.updater.pubkey` as it is written in THAT tag on GitHub (not in the
 *     folder that happens to be checked out), with `verifyMinisign`.
 *  4. Each of the three files has a build attestation from this repository's release workflow, on this tag and the tag's commit
 *     (`--source-digest`), and the same check REFUSES the previous release's commit: a check that accepts anything proves nothing.
 *
 * Every failure is one line; a failure does not stop the other checks, so one run says everything that is wrong. The exit code is
 * non-zero when there is any failure. Addresses are never taken from the manifest: the manifest's own URLs must equal the ones
 * this tool builds (step 1), and only those are fetched.
 */

const REPO_URL = `https://github.com/${REPO}/releases`

/** The public network and GitHub CLI calls the check needs, as intentions; `createVerifyHost` is the real one, the tests use a fake. */
export interface VerifyHost {
  /** The tags of the published stable releases (drafts and pre-releases excluded), in any order. */
  publishedTags(): Promise<string[]>
  /** The bytes a public https address answers with; throws if it does not answer with them. */
  fetchBytes(url: string): Promise<Buffer>
  /** `plugins.updater.pubkey` as written in the tagged config on GitHub. */
  pubkey(tag: string): Promise<string>
  /** `plugins.updater.endpoints` as written in the tagged config on GitHub: the addresses an installed copy of that release asks. */
  updaterEndpoints(tag: string): Promise<string[]>
  /** The full commit a tag points at on GitHub. */
  tagCommit(tag: string): Promise<string>
  /** Whether `file` has a build attestation from this repository's release workflow on `tag` and `commit`. */
  verifyAttestation(file: string, tag: string, commit: string): Promise<boolean>
}

export interface ReleaseVerifyOptions {
  /** The tag to check (`v` + a version); by default the newest published stable release. */
  tag?: string
}

export interface ReleaseVerifyResult {
  tag: string
  /** One sentence per thing that is wrong; empty when the release is as it should be. */
  failures: string[]
}

const isTag = (value: string): boolean => value.startsWith('v') && RELEASE_VERSION.test(value.slice(1))

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 400)

const downloadUrl = (tag: string, name: string): string => `${REPO_URL}/download/${tag}/${name}`

/** The signature a platform's entry carries, if the manifest is shaped that way (`manifestProblems` says what is wrong when it is not). */
function signatureOf(manifest: unknown, platform: PlatformKey): string | undefined {
  const signature = (manifest as { platforms?: Record<string, { signature?: unknown } | undefined> } | null | undefined)?.platforms?.[platform]?.signature

  return typeof signature === 'string' ? signature : undefined
}

/** A hung connection must not hang a scheduled run for hours; the largest file is about 17 MB. */
const FETCH_TIMEOUT_MS = 180_000

export async function releaseVerify(options: ReleaseVerifyOptions, host: VerifyHost, log: (line: string) => void): Promise<ReleaseVerifyResult> {
  const published = (await host.publishedTags()).filter(isTag).sort((a, b) => compareVersions(b.slice(1), a.slice(1)))
  const latest = published[0]
  if (latest === undefined) throw new Error('There is no published release to check')
  const tag = options.tag ?? latest
  if (!isTag(tag)) throw new Error(`${JSON.stringify(tag).slice(0, 40)} is not v + a version (like v1.0.0)`)
  if (!published.includes(tag)) return { tag, failures: [`${tag} is not a published release (a draft or a pre-release does not count)`] }

  const version = tag.slice(1)
  const previous = published.find((candidate) => compareVersions(candidate.slice(1), version) < 0)
  const exe = assetName('windows-x86_64', version)
  const archive = assetName('darwin-aarch64', version)
  const dmg = `Listulator_${version}_aarch64.dmg`
  const files = [exe, dmg, archive]

  const failures: string[] = []
  const fail = (line: string) => failures.push(oneLine(line))
  const get = async (url: string): Promise<Buffer | undefined> => {
    try {
      return await host.fetchBytes(url)
    } catch (error) {
      fail(`${url} did not answer: ${error instanceof Error ? error.message : String(error)}`)

      return undefined
    }
  }

  // The key the signatures have to verify against: the one in the tag's own config.
  let pubkey: string | undefined
  try {
    pubkey = await host.pubkey(tag)
  } catch (error) {
    fail(`The updater public key of ${tag} could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  const keyId = pubkey === undefined ? undefined : keyIdOfPublicKey(pubkey)
  if (pubkey !== undefined && keyId === undefined) fail(`The updater public key in the config of ${tag} is not a minisign public key, so no signature can be checked`)

  // 1. The manifest, as the app fetches it.
  const manifestUrl = tag === latest ? `${REPO_URL}/latest/download/latest.json` : downloadUrl(tag, 'latest.json')
  const manifestBytes = await get(manifestUrl)
  let manifest: unknown
  if (manifestBytes !== undefined) {
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8'))
    } catch {
      fail(`latest.json is not JSON (${manifestUrl})`)
    }
    if (manifest !== undefined) {
      const problems = manifestProblems(manifest, { tag, ...(keyId === undefined ? {} : { keyId }) })
      for (const problem of problems) fail(`latest.json: ${problem}`)
      if (problems.length === 0) log(`latest.json  announces ${version}, this tag's download addresses and signatures for key ${keyId ?? 'unknown'}`)
    }
  }

  // 2. The files and their checksums.
  const sumsBytes = await get(downloadUrl(tag, 'SHA256SUMS'))
  const sums = sumsBytes === undefined ? undefined : parseSums(sumsBytes.toString('utf8'))
  if (sumsBytes !== undefined && (sums === undefined || sums.size !== files.length || files.some((name) => !sums.has(name)))) {
    fail(`SHA256SUMS does not list exactly ${files.join(', ')}`)
  }
  const bytes = new Map<string, Buffer>()
  for (const name of files) {
    const data = await get(downloadUrl(tag, name))
    if (data === undefined) continue
    bytes.set(name, data)
    const wanted = sums?.get(name)
    if (wanted === undefined) continue
    const actual = createHash('sha256').update(data).digest('hex')
    if (actual === wanted) log(`${name}  sha256 ${actual} matches SHA256SUMS`)
    else fail(`${name} does not match its checksum in SHA256SUMS`)
  }

  // 3. The signatures of the two update files against the tag's key.
  if (pubkey !== undefined && keyId !== undefined) {
    for (const [platform, name] of [['windows-x86_64', exe], ['darwin-aarch64', archive]] as const) {
      const data = bytes.get(name)
      const signature = signatureOf(manifest, platform)
      if (data === undefined || signature === undefined) continue
      const verdict = verifyMinisign(pubkey, signature, data)
      if (verdict.ok) log(`${name}  signature verifies against the key of ${tag} (${verdict.trustedComment.replace(/\t/g, ' ')})`)
      else fail(`${name}: ${verdict.reason}`)
    }
  }

  // 3b. The update path: what an app installed at the previous release does with this one. Only the newest release is served by the feed.
  if (tag === latest && previous !== undefined) {
    const signed = ([['windows-x86_64', exe], ['darwin-aarch64', archive]] as const).flatMap(([platform, name]) => {
      const data = bytes.get(name)
      const signature = signatureOf(manifest, platform)

      return data === undefined || signature === undefined ? [] : [{ name, data, signature }]
    })
    await checkUpdatePath(host, { tag, previous, feedUrl: manifestUrl, manifest, files: signed, expected: 2 }, log, fail)
  }

  // 4. The attestations, and the control that the check can say no.
  let commit: string | undefined
  try {
    commit = await host.tagCommit(tag)
  } catch (error) {
    fail(`The commit of ${tag} could not be read (${error instanceof Error ? error.message : String(error)}): the attestations were not checked`)
  }
  if (commit !== undefined) {
    const dir = mkdtempSync(join(tmpdir(), 'release-verify-'))
    try {
      for (const [name, data] of bytes) writeFileSync(join(dir, name), data)
      await checkAttestations(host, { dir, names: [...bytes.keys()], tag, commit, previous }, log, fail)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  return { tag, failures }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The real GitHub CLI and the public network

/** The real calls: `gh` for what GitHub knows (releases, the tagged config, a tag's commit, attestations) and plain https for what a user downloads. */
export function createVerifyHost(run: Runner, fetcher: typeof fetch = fetch): VerifyHost {
  // The attestation check is release:sign's own, so the two cannot drift apart. It needs no repository folder.
  const attest = createGhHost(run, process.cwd()).verifyAttestation
  const checkTag = (tag: string) => {
    if (!isTag(tag)) throw new Error(`${JSON.stringify(tag).slice(0, 40)} is not v + a version`)
  }
  /** `plugins.updater` of a tag's config, as GitHub has it (not the checked-out one). */
  const readUpdaterConfig = async (tag: string): Promise<{ pubkey?: unknown; endpoints?: unknown }> => {
    checkTag(tag)
    const result = await run('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${REPO}/contents/${CONFIG_PATH}?ref=${tag}`])
    if (result.code !== 0) throw new Error(`gh could not read ${CONFIG_PATH} at ${tag}`)

    return (JSON.parse(result.stdout) as { plugins?: { updater?: { pubkey?: unknown; endpoints?: unknown } } }).plugins?.updater ?? {}
  }

  return {
    async publishedTags() {
      const result = await run('gh', ['release', 'list', '--repo', REPO, '--exclude-drafts', '--exclude-pre-releases', '--limit', '100', '--json', 'tagName'])
      if (result.code !== 0) throw new Error('gh could not list the published releases')

      return (JSON.parse(result.stdout) as { tagName: string }[]).map((entry) => entry.tagName).filter(isTag)
    },

    async fetchBytes(url) {
      if (!url.startsWith('https://')) throw new Error(`${url} is not an https address`)
      const response = await fetcher(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())

      return Buffer.from(await response.arrayBuffer())
    },

    async pubkey(tag) {
      const pubkey = (await readUpdaterConfig(tag)).pubkey
      if (typeof pubkey !== 'string') throw new Error(`No updater public key in ${CONFIG_PATH} at ${tag}`)

      return pubkey
    },

    async updaterEndpoints(tag) {
      const endpoints = (await readUpdaterConfig(tag)).endpoints
      if (!Array.isArray(endpoints) || endpoints.some((endpoint) => typeof endpoint !== 'string')) throw new Error(`No updater endpoints in ${CONFIG_PATH} at ${tag}`)

      return endpoints as string[]
    },

    async tagCommit(tag) {
      checkTag(tag)
      const result = await run('gh', ['api', `repos/${REPO}/commits/${tag}`, '--jq', '.sha'])
      const commit = result.stdout.trim()
      if (result.code !== 0 || !/^[0-9a-f]{40}$/.test(commit)) throw new Error(`gh could not read the commit of ${tag}`)

      return commit
    },

    verifyAttestation: attest,
  }
}

/** The last line of a run that found nothing wrong, and the check `release:ship` makes of it: the sign that the script ran at all (see `dryRunReported` in releaseSign.ts). */
export const verifiedLine = (tag: string): string => `${tag}: verified`
export const verifiedReported = (output: string): boolean => /: verified\s*$/m.test(output)

/** The command line as a value, or a sentence saying what is wrong with it. */
export function parseReleaseVerifyArguments(args: readonly string[]): ReleaseVerifyOptions | string {
  if (args.length > 1) return 'only one tag can be checked at a time'
  const tag = args[0]
  if (tag === undefined) return {}
  if (tag.startsWith('-')) return `unknown option ${JSON.stringify(tag).slice(0, 30)} (this tool takes a tag and nothing else)`
  if (!isTag(tag)) return `${JSON.stringify(tag).slice(0, 40)} is not a tag (like v1.0.0)`

  return { tag }
}

if (isRunDirectly(import.meta.url)) {
  const parsed = parseReleaseVerifyArguments(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(`${parsed}\nUsage: npm run release:verify -- [<tag>]   (without a tag: the newest published release)`)
    process.exit(1)
  }

  try {
    const result = await releaseVerify(parsed, createVerifyHost(nodeRunner), (line) => console.log(`ok    ${line}`))
    for (const failure of result.failures) console.error(`FAIL  ${failure}`)
    if (result.failures.length > 0) {
      console.error(`${result.tag}: ${result.failures.length} problem${result.failures.length === 1 ? '' : 's'}`)
      process.exit(1)
    }
    console.log(verifiedLine(result.tag))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
