import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isRunDirectly } from './runDirectly.js'
import { parseSignature, type PlatformKey } from './updateManifest.js'
import { DEFAULT_PORT, PLAIN_NAME } from './updaterServe.js'
import { RELEASE_VERSION } from './versionSources.js'

/**
 * Writes the `latest.json` for the updater's two-version test (Phase 20, task 20.13a), pointing at the local file server
 * (`updaterServe.ts`): `npm run updater:manifest -- <folder> --mac <archive> [--windows <installer>] [--version <v>]`.
 * Each file's signature is read from `<file>.sig` next to it.
 *
 * Unlike `updateManifest.ts`, which builds the release's manifest and refuses anything that could mislead an app, this has to be
 * able to make a WRONG manifest on purpose for the negative cases of 20.13b: an announced version other than the signed one,
 * the wrong bundle under a platform, a platform left out, a garbled signature. So it builds what it is told and lists, as notes,
 * every place the result differs from a correct manifest, so the tester knows which case they made. Its one hard rule is the
 * address: only `http://127.0.0.1:<port>`, so nothing it writes could be taken for a real release manifest.
 */

export interface TestEntry {
  /** The file the platform's entry points at, a plain name in the served folder. */
  file: string
  /** The content of that file's `.sig`. */
  signature: string
}

export interface TestManifestInput {
  baseUrl: string
  version: string
  pubDate: string
  windows?: TestEntry | undefined
  mac?: TestEntry | undefined
  /** If given, a note is made for a signature that was made with another key. */
  keyId?: string
}

export interface TestManifest {
  version: string
  pub_date: string
  platforms: Partial<Record<PlatformKey, { signature: string; url: string }>>
}

const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

export function buildTestManifest(input: TestManifestInput): { manifest: TestManifest; notes: string[] } {
  if (!LOOPBACK.test(input.baseUrl)) throw new Error(`The address must be http://127.0.0.1:<port> (this machine, plain http), not ${JSON.stringify(input.baseUrl).slice(0, 60)}`)
  if (!RELEASE_VERSION.test(input.version)) throw new Error(`${JSON.stringify(input.version).slice(0, 40)} is not a version`)
  const given: [PlatformKey, TestEntry][] = []
  if (input.windows) given.push(['windows-x86_64', input.windows])
  if (input.mac) given.push(['darwin-aarch64', input.mac])
  if (given.length === 0) throw new Error('Give at least one platform (a Windows installer, a macOS archive)')

  const notes: string[] = []
  const platforms: TestManifest['platforms'] = {}
  for (const [platform, entry] of given) {
    if (!PLAIN_NAME.test(entry.file)) throw new Error(`${JSON.stringify(entry.file).slice(0, 60)} is not a plain file name`)
    const signature = entry.signature.trim()
    platforms[platform] = { signature, url: `${input.baseUrl}/${entry.file}` }

    const parsed = parseSignature(signature)
    if (typeof parsed === 'string') notes.push(`${platform}: signature ${parsed}`)
    else {
      if (parsed.version !== input.version) notes.push(`${platform}: signed for version ${parsed.version}, the manifest announces ${input.version}`)
      if (parsed.file !== entry.file) notes.push(`${platform}: the signature covers ${parsed.file}, the entry points at ${entry.file}`)
      if (input.keyId !== undefined && parsed.keyId !== input.keyId) notes.push(`${platform}: the signature was made with key ${parsed.keyId}, not the app's key ${input.keyId}`)
    }
  }

  return { manifest: { version: input.version, pub_date: input.pubDate, platforms }, notes }
}

export interface TestManifestArguments {
  dir: string
  port: number
  windows?: string
  mac?: string
  version?: string
  date?: string
}

/** The command line as a value, or a sentence saying what is wrong with it. */
export function parseTestManifestArguments(args: readonly string[]): TestManifestArguments | string {
  const parsed: { dir?: string; port: number; windows?: string; mac?: string; version?: string; date?: string } = { port: DEFAULT_PORT }
  const options: Record<string, 'windows' | 'mac' | 'version' | 'date' | 'port'> = { '--windows': 'windows', '--mac': 'mac', '--version': 'version', '--date': 'date', '--port': 'port' }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    const option = options[arg]
    if (option !== undefined) {
      const value = args[index + 1]
      if (value === undefined) return `${arg} needs a value`
      index++
      if (option === 'port') {
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) return '--port must be a number between 1 and 65535'
        parsed.port = Number(value)
      } else {
        parsed[option] = value
      }
    } else if (arg.startsWith('-')) {
      return `unknown option ${JSON.stringify(arg).slice(0, 30)}`
    } else if (parsed.dir === undefined) {
      parsed.dir = arg
    } else {
      return 'only one folder can be named'
    }
  }
  if (parsed.dir === undefined) return 'name the folder the server serves'
  if (parsed.windows === undefined && parsed.mac === undefined) return 'give --mac <archive> and/or --windows <installer>'

  return parsed as TestManifestArguments
}

function readEntry(dir: string, file: string): TestEntry {
  const bundle = join(dir, file)
  const signature = join(dir, `${file}.sig`)
  for (const path of [bundle, signature]) {
    try {
      if (!statSync(path).isFile()) throw new Error('not a file')
    } catch {
      throw new Error(`${path} is not there (the folder needs the file and its .sig)`)
    }
  }

  return { file, signature: readFileSync(signature, 'utf8') }
}

/** Reads the files and signatures from the folder and writes `latest.json` beside them; returns what it wrote and the notes. */
export function writeTestManifest(args: TestManifestArguments, now: () => Date = () => new Date()): { manifest: TestManifest; notes: string[]; path: string } {
  const windows = args.windows === undefined ? undefined : readEntry(args.dir, args.windows)
  const mac = args.mac === undefined ? undefined : readEntry(args.dir, args.mac)
  // With no --version, the version the signatures carry (the macOS one first): the manifest then announces exactly what was signed.
  const signed = [mac, windows].map((entry) => (entry === undefined ? undefined : parseSignature(entry.signature.trim()))).find((parsed) => typeof parsed === 'object')
  const version = args.version ?? (typeof signed === 'object' ? signed.version : undefined)
  if (version === undefined) throw new Error('No version to announce: give --version, or a signature the version can be read from')

  const built = buildTestManifest({
    baseUrl: `http://127.0.0.1:${args.port}`,
    version,
    pubDate: args.date ?? `${now().toISOString().slice(0, 19)}Z`,
    windows,
    mac,
  })
  const path = join(args.dir, 'latest.json')
  writeFileSync(path, `${JSON.stringify(built.manifest, null, 2)}\n`)

  return { ...built, path }
}

if (isRunDirectly(import.meta.url)) {
  const parsed = parseTestManifestArguments(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(`${parsed}\nUsage: npm run updater:manifest -- <folder> [--mac <archive>] [--windows <installer>] [--version <v>] [--port ${DEFAULT_PORT}] [--date <UTC date and time>]`)
    process.exit(1)
  }
  try {
    const { manifest, notes, path } = writeTestManifest(parsed)
    console.log(`Wrote ${resolve(path)}:\n${JSON.stringify(manifest, null, 2)}`)
    for (const note of notes) console.log(`NOTE ${note}`)
    if (notes.length === 0) console.log('No notes: this manifest is consistent (version, file and signature agree).')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
