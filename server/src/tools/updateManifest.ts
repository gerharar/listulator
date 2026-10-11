import { RELEASE_VERSION } from './versionSources.js'

/**
 * The static update manifest the app fetches from `releases/latest/download/latest.json` (Phase 20, task 20.12b; design:
 * docs/security-review.md section 13). A pure module: it builds the manifest from a tag and the signature files, and judges
 * any manifest against the rules below. The signing script (20.12c) is what reads files, runs `tauri signer sign` and checks
 * each signature cryptographically against the public key; this module checks that what the manifest SAYS is consistent
 * and cannot be steered: exactly the two platforms, addresses that can only be this repository's download for this tag,
 * signatures that cover this very file at this very version, and no release notes (the app never shows them).
 */

export type PlatformKey = 'windows-x86_64' | 'darwin-aarch64'

export interface PlatformEntry {
  signature: string
  url: string
}

export interface UpdateManifest {
  version: string
  pub_date: string
  platforms: Record<PlatformKey, PlatformEntry>
}

/** Windows runs the NSIS installer itself; macOS replaces the app from the archive. Both are arm64 or x64 as built (20.1). */
const PLATFORMS: readonly PlatformKey[] = ['windows-x86_64', 'darwin-aarch64']
const DOWNLOAD_PREFIX = 'https://github.com/gerharar/listulator/releases/download/'
const MANIFEST_KEYS = ['version', 'pub_date', 'platforms']
const ENTRY_KEYS = ['signature', 'url']

/** The file each platform's entry points at, as the release pipeline names it (`Listulator_<version>_x64-setup.exe`, 20.4; the archive, 20.12a). */
export function assetName(platform: PlatformKey, version: string): string {
  return platform === 'windows-x86_64' ? `Listulator_${version}_x64-setup.exe` : 'Listulator.app.tar.gz'
}

function assetUrl(platform: PlatformKey, tag: string): string {
  return `${DOWNLOAD_PREFIX}${tag}/${assetName(platform, tag.slice(1))}`
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Versions

interface Parsed {
  core: bigint[]
  pre: string[] | undefined
}

function parseVersion(version: string): Parsed {
  if (typeof version !== 'string' || !RELEASE_VERSION.test(version)) throw new Error(`Not a version: ${JSON.stringify(version).slice(0, 60)}`)
  const dash = version.indexOf('-')
  const core = (dash === -1 ? version : version.slice(0, dash)).split('.').map(BigInt)

  return { core, pre: dash === -1 ? undefined : version.slice(dash + 1).split('.') }
}

/** Semantic-versioning precedence: negative when `a` is older than `b`, zero when equal, positive when newer. Throws on what is not a version. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)

  for (let index = 0; index < 3; index++) {
    const difference = left.core[index]! - right.core[index]!
    if (difference !== 0n) return difference > 0n ? 1 : -1
  }
  // A release candidate comes before the release it leads up to.
  if (left.pre === undefined || right.pre === undefined) return left.pre === right.pre ? 0 : left.pre === undefined ? 1 : -1

  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index++) {
    const x = left.pre[index]
    const y = right.pre[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const numericX = /^\d+$/.test(x)
    const numericY = /^\d+$/.test(y)
    if (numericX && numericY) {
      if (BigInt(x) !== BigInt(y)) return BigInt(x) > BigInt(y) ? 1 : -1
    } else if (numericX !== numericY) {
      return numericX ? -1 : 1
    } else if (x !== y) {
      return x > y ? 1 : -1
    }
  }

  return 0
}

/** Would an app at `installed` be offered this manifest? (The plugin offers a version that is newer, and nothing else.) */
export function isOffered(manifest: Pick<UpdateManifest, 'version'>, installed: string): boolean {
  return compareVersions(manifest.version, installed) > 0
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Signatures

export interface ParsedSignature {
  /** The ID of the key that made it, as the 16 hex digits `tauri signer` prints (upper case). */
  keyId: string
  /** The file name the signature covers (from its trusted comment). */
  file: string
  /** The version the signature binds to the file (`--app-version`). */
  version: string
  timestamp: number
}

/** Standard base64, no whitespace, canonical padding: what the plugin's decoder accepts. Undefined for anything else. */
function strictBase64(text: string): Buffer | undefined {
  if (text === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return undefined
  const bytes = Buffer.from(text, 'base64')

  return bytes.toString('base64') === text ? bytes : undefined
}

/** The ID of a minisign key from its 8 little-endian bytes. */
const keyIdFrom = (bytes: Buffer): string => Buffer.from(bytes).reverse().toString('hex').toUpperCase()

/**
 * Reads the content of a `.sig` file as `tauri signer sign` writes it (the base64 of a four-line minisign signature) into
 * the key, file, version and time it carries; or says in words why it cannot. It does not check the signature itself.
 */
export function parseSignature(signature: unknown): ParsedSignature | string {
  if (typeof signature !== 'string') return 'is missing or not a text'
  if (signature === '') return 'is empty'
  if (/\s/.test(signature)) return 'has whitespace in it (the plugin cannot decode that)'
  const decoded = strictBase64(signature)
  if (decoded === undefined) return 'is not base64'

  const lines = decoded.toString('utf8').split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (lines.length !== 4) return 'does not have four lines once decoded'
  const [untrusted, signed, trusted, global] = lines as [string, string, string, string]

  if (!untrusted.startsWith('untrusted comment: ')) return 'does not start with an untrusted comment'
  const signedBytes = strictBase64(signed)
  if (signedBytes === undefined || signedBytes.length !== 74) return 'has a signature line that is not 74 bytes'
  const algorithm = signedBytes.subarray(0, 2).toString('latin1')
  if (algorithm !== 'ED' && algorithm !== 'Ed') return 'is not a minisign signature (algorithm bytes)'
  if (!trusted.startsWith('trusted comment: ')) return 'has no trusted comment'
  const globalBytes = strictBase64(global)
  if (globalBytes === undefined || globalBytes.length !== 64) return 'has a global signature that is not 64 bytes'

  const fields = new Map<string, string>()
  for (const field of trusted.slice('trusted comment: '.length).split('\t')) {
    const colon = field.indexOf(':')
    const name = colon === -1 ? '' : field.slice(0, colon)
    if (!['timestamp', 'file', 'version'].includes(name)) return `has an unexpected field in its trusted comment (${JSON.stringify(field).slice(0, 40)})`
    if (fields.has(name)) return `names ${name} twice in its trusted comment`
    fields.set(name, field.slice(colon + 1))
  }
  const timestamp = fields.get('timestamp')
  const file = fields.get('file')
  const version = fields.get('version')
  if (timestamp === undefined || file === undefined || version === undefined) return 'lacks the timestamp, file or version its trusted comment must carry'
  if (!/^\d{1,12}$/.test(timestamp)) return 'has a timestamp that is not a number'
  if (file === '' || file.includes('/')) return 'names a file that is not a plain file name'
  if (!RELEASE_VERSION.test(version)) return 'binds a version that is not a version'

  return { keyId: keyIdFrom(signedBytes.subarray(2, 10)), file, version, timestamp: Number(timestamp) }
}

/**
 * The ID of the public key in `plugins.updater.pubkey` (the base64 of the two-line `.pub` file), read from its key bytes
 * rather than from its comment. Undefined when it is not a minisign public key.
 */
export function keyIdOfPublicKey(pubkey: string): string | undefined {
  const decoded = strictBase64(pubkey)
  if (decoded === undefined) return undefined
  const lines = decoded.toString('utf8').split('\n')
  const bytes = strictBase64(lines[1] ?? '')
  if (bytes === undefined || bytes.length !== 42 || bytes.subarray(0, 2).toString('latin1') !== 'Ed') return undefined

  return keyIdFrom(bytes.subarray(2, 10))
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The manifest

export interface ManifestOptions {
  /** The release tag, `v` + the version: the only download address the entries may point into. */
  tag: string
  /** If given, every signature must have been made with this key (from `keyIdOfPublicKey`). */
  keyId?: string
  /** If given, the version the manifest announces must be newer than this (the latest published release). */
  current?: string
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every rule the manifest breaks, as sentences; empty when it breaks none. */
export function manifestProblems(manifest: unknown, options: ManifestOptions): string[] {
  if (!isObject(manifest)) return ['the manifest is not an object']
  const problems: string[] = []
  const { tag } = options
  const tagVersion = typeof tag === 'string' && tag.startsWith('v') && RELEASE_VERSION.test(tag.slice(1)) ? tag.slice(1) : undefined
  if (tagVersion === undefined) problems.push(`the tag ${JSON.stringify(tag)} is not v + a version`)

  for (const key of Object.keys(manifest)) if (!MANIFEST_KEYS.includes(key)) problems.push(`unexpected key ${JSON.stringify(key)} (the manifest carries a version, a date and the platforms, nothing else)`)

  const version = manifest['version']
  const validVersion = typeof version === 'string' && RELEASE_VERSION.test(version)
  if (!validVersion) problems.push('version is missing or not a version')
  else if (tagVersion !== undefined && version !== tagVersion) problems.push(`version ${version} is not the tag's (${tag})`)

  const date = manifest['pub_date']
  // Only a UTC date and time without fractions survives the round trip through a Date: no date alone, no offset, no 31 February.
  if (typeof date !== 'string' || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 19) + 'Z' !== date) {
    problems.push('pub_date is missing or not a UTC date and time like 2026-10-20T08:30:00Z')
  }

  const platforms = manifest['platforms']
  if (!isObject(platforms)) problems.push('platforms is missing or not an object')
  else {
    for (const key of Object.keys(platforms)) if (!PLATFORMS.includes(key as PlatformKey)) problems.push(`unexpected platform ${JSON.stringify(key)} (only ${PLATFORMS.join(' and ')})`)
    for (const platform of PLATFORMS) {
      if (!(platform in platforms)) problems.push(`missing platform ${JSON.stringify(platform)}`)
      else problems.push(...entryProblems(platform, platforms[platform], tagVersion === undefined ? undefined : tag, validVersion ? version : undefined, options.keyId))
    }
  }

  if (options.current !== undefined) {
    if (!RELEASE_VERSION.test(options.current)) problems.push(`the current version ${JSON.stringify(options.current).slice(0, 40)} is not a version`)
    else if (validVersion && compareVersions(version, options.current) <= 0) problems.push(`version ${version} is not newer than ${options.current} (an app at that version must not be offered it)`)
  }

  return problems
}

function entryProblems(platform: PlatformKey, entry: unknown, tag: string | undefined, version: string | undefined, keyId: string | undefined): string[] {
  if (!isObject(entry)) return [`${platform}: not an object`]
  const problems: string[] = []
  for (const key of Object.keys(entry)) if (!ENTRY_KEYS.includes(key)) problems.push(`${platform}: unexpected key ${JSON.stringify(key)}`)

  const expectedFile = tag === undefined ? undefined : assetName(platform, tag.slice(1))
  if (typeof entry['url'] !== 'string') problems.push(`${platform}: url is missing or not a text`)
  else if (tag !== undefined && entry['url'] !== assetUrl(platform, tag)) {
    problems.push(`${platform}: url must be exactly ${assetUrl(platform, tag)} (this repository's download for this tag), not ${JSON.stringify(entry['url']).slice(0, 100)}`)
  }

  const parsed = parseSignature(entry['signature'])
  if (typeof parsed === 'string') problems.push(`${platform}: signature ${parsed}`)
  else {
    if (version !== undefined && parsed.version !== version) problems.push(`${platform}: signature is for version ${parsed.version}, the manifest announces ${version}`)
    if (expectedFile !== undefined && parsed.file !== expectedFile) problems.push(`${platform}: signature covers file ${parsed.file}, not ${expectedFile}`)
    if (keyId !== undefined && parsed.keyId !== keyId) problems.push(`${platform}: signature was made with key ${parsed.keyId}, not the app's key ${keyId}`)
  }

  return problems
}

export interface ManifestInput extends Omit<ManifestOptions, 'tag'> {
  tag: string
  /** When the release was made, UTC, like 2026-10-20T08:30:00Z. Given, not read from the clock, so the same input is the same file. */
  pubDate: string
  /** The content of each platform's `.sig` file (its trailing newline is dropped). */
  signatures: Record<PlatformKey, string>
}

/** Builds the manifest for a tag and its signatures; throws, listing every reason, if it would break a rule. */
export function buildManifest(input: ManifestInput): UpdateManifest {
  const version = input.tag.startsWith('v') ? input.tag.slice(1) : input.tag
  const entry = (platform: PlatformKey): PlatformEntry => ({
    signature: String(input.signatures[platform] ?? '').trim(),
    url: `${DOWNLOAD_PREFIX}${input.tag}/${assetName(platform, version)}`,
  })
  const manifest: UpdateManifest = {
    version,
    pub_date: input.pubDate,
    platforms: { 'windows-x86_64': entry('windows-x86_64'), 'darwin-aarch64': entry('darwin-aarch64') },
  }

  const problems = manifestProblems(manifest, { tag: input.tag, ...(input.keyId === undefined ? {} : { keyId: input.keyId }), ...(input.current === undefined ? {} : { current: input.current }) })
  if (problems.length > 0) throw new Error(`The update manifest breaks ${problems.length} rule(s):\n${problems.join('\n')}`)

  return manifest
}

/** The text of `latest.json`: the same bytes for the same manifest (fixed key order, two spaces, one newline at the end). */
export function serializeManifest(manifest: UpdateManifest): string {
  const entry = (platform: PlatformKey) => ({ signature: manifest.platforms[platform].signature, url: manifest.platforms[platform].url })

  return `${JSON.stringify({ version: manifest.version, pub_date: manifest.pub_date, platforms: { 'windows-x86_64': entry('windows-x86_64'), 'darwin-aarch64': entry('darwin-aarch64') } }, null, 2)}\n`
}
