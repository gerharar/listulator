import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The parts of `release:audit` (Phase 31, task 31.10) that need no network, no disk image and no installed tool, so they are tested
 * on their own (`releaseAudit.ts` does the downloading, unpacking and mounting, and calls these). None of them prints or returns a
 * secret: the owner's `.env` values are looked for in files and only the NAME of a value that was found comes back.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// Files that must not be in a release

const FORBIDDEN_NAME = [/^\.env/i, /\.sqlite/i, /\.(db|map|key|pem|p12|pfx|keystore)$/i, /^id_(rsa|ed25519|ecdsa)/i, /^\.listulator-updater/i]
const FORBIDDEN_FOLDER = new Set(['lists', 'node_modules', '.git'])

/** The paths (forward or back slashes) that are a secret, a database, a source map, a key, curated lists or a repository's own files. */
export function forbiddenPaths(paths: readonly string[]): string[] {
  return paths.filter((path) => {
    const parts = path.split(/[\\/]/).filter((part) => part !== '')
    const name = parts.at(-1) ?? ''

    return FORBIDDEN_NAME.some((pattern) => pattern.test(name)) || parts.slice(0, -1).some((part) => FORBIDDEN_FOLDER.has(part.toLowerCase()) || part.toLowerCase().startsWith('.listulator-updater'))
  })
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The owner's .env values

export interface EnvEntry {
  name: string
  value: string
}

const MIN_SECRET_LENGTH = 8

/** The entries of a `.env` text whose value is 8 or more characters (shorter ones, like a port, are not secrets and would match anything). */
export function parseEnvValues(text: string): EnvEntry[] {
  const entries: EnvEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (match === null) continue
    let value = match[2]!.trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '').trim()
    if (value.length >= MIN_SECRET_LENGTH) entries.push({ name: match[1]!, value })
  }

  return entries
}

/** The NAMES of the entries whose value is in `data`, as text or as UTF-16 text (a Windows program holds strings both ways). Never a value. */
export function valueHits(entries: readonly EnvEntry[], data: Buffer): string[] {
  return entries.filter((entry) => data.includes(Buffer.from(entry.value)) || data.includes(Buffer.from(entry.value, 'utf16le'))).map((entry) => entry.name)
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The app's plist, signature and processor

export interface PlistExpectation {
  identifier: string
  version: string
  minimumSystemVersion: string
}

/** What is wrong with the app's `Info.plist` (as JSON, from `plutil`), against what the tagged config says. */
export function plistProblems(info: unknown, expected: PlistExpectation): string[] {
  if (typeof info !== 'object' || info === null || Array.isArray(info)) return ['Info.plist is not a dictionary']
  const plist = info as Record<string, unknown>
  const problems: string[] = []
  const check = (key: string, wanted: string) => {
    if (plist[key] !== wanted) problems.push(`${key} is ${JSON.stringify(plist[key]) ?? 'missing'}, not ${JSON.stringify(wanted)}`)
  }
  check('CFBundleIdentifier', expected.identifier)
  check('CFBundleShortVersionString', expected.version)
  check('LSMinimumSystemVersion', expected.minimumSystemVersion)
  for (const key of Object.keys(plist)) {
    if (/^NS.*UsageDescription$/.test(key)) problems.push(`${key} is set: the app would ask for a permission nobody decided on`)
  }

  return problems
}

const CPU_NAMES: Record<number, string> = { 0x07: 'i386', 0x0c: 'arm', 0x01000007: 'x86_64', 0x0100000c: 'arm64' }

function cpuName(cpu: number, subtype: number): string {
  if (cpu === 0x0100000c && (subtype & 0xff) === 2) return 'arm64e'

  return CPU_NAMES[cpu] ?? `cpu-0x${cpu.toString(16)}`
}

/** The processors a Mach-O program is for (thin or universal), or undefined when the bytes are not one. */
export function machoArchs(data: Buffer): string[] | undefined {
  if (data.length < 12) return undefined
  const little = data.readUInt32LE(0)
  if (little === 0xfeedfacf || little === 0xfeedface) return [cpuName(data.readUInt32LE(4), data.readUInt32LE(8))]
  if (data.readUInt32BE(0) !== 0xcafebabe) return undefined
  // A Java class file starts with the same four bytes; a universal program is followed by a small count of 20-byte entries.
  const count = data.readUInt32BE(4)
  if (count < 1 || count > 8 || data.length < 8 + count * 20) return undefined

  return Array.from({ length: count }, (_, index) => cpuName(data.readUInt32BE(8 + index * 20), data.readUInt32BE(12 + index * 20)))
}

export interface CodesignFindings {
  identifier: string | undefined
  flags: string | undefined
  adhoc: boolean
  team: string | undefined
}

/** The facts in the text `codesign -dv --verbose=4` prints. */
export function codesignFindings(text: string): CodesignFindings {
  const line = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim()
  const flags = /flags=(0x[0-9a-f]+(?:\([^)]*\))?)/i.exec(text)?.[1]
  const team = line('TeamIdentifier')

  return {
    identifier: line('Identifier'),
    flags,
    adhoc: line('Signature') === 'adhoc' || /\(([^)]*,)?adhoc[,)]/.test(flags ?? ''),
    team: team === undefined || team === 'not set' ? undefined : team,
  }
}

export interface CodesignExpectation {
  identifier: string
  /** The tagged config's `signingIdentity` is `-` (ad hoc): the app is expected to carry an ad hoc signature and no team. */
  expectAdhoc: boolean
}

export function codesignProblems(findings: CodesignFindings, expected: CodesignExpectation): string[] {
  const problems: string[] = []
  if (findings.identifier !== expected.identifier) problems.push(`The code signature's identifier is ${JSON.stringify(findings.identifier) ?? 'missing'}, not ${JSON.stringify(expected.identifier)}`)
  if (expected.expectAdhoc && !findings.adhoc) problems.push('The signature is not ad hoc, but the tagged config asks for ad hoc ("-")')
  if (!expected.expectAdhoc && findings.adhoc) problems.push('The signature is ad hoc, but the tagged config names a signing identity')

  return problems
}

/** Whether the entitlements plist `codesign -d --entitlements :-` printed holds any entitlement. */
export function hasEntitlements(text: string): boolean {
  return /<key>/.test(text)
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Whether two copies of an app are the same

export type TreeEntry = { kind: 'dir' } | { kind: 'file'; sha256: string; size: number; executable: boolean } | { kind: 'link'; target: string }
export type Tree = Map<string, TreeEntry>

/** Every file, folder and symbolic link under `root` (links are read, never followed), keyed by its path below `root` with forward slashes. */
export function readTree(root: string): Tree {
  const tree: Tree = new Map()
  const walk = (relative: string): void => {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const path = relative === '' ? name : `${relative}/${name}`
      const full = join(root, path)
      const stat = lstatSync(full)
      if (stat.isSymbolicLink()) tree.set(path, { kind: 'link', target: readlinkSync(full) })
      else if (stat.isDirectory()) {
        tree.set(path, { kind: 'dir' })
        walk(path)
      } else {
        const bytes = readFileSync(full)
        tree.set(path, { kind: 'file', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, executable: (stat.mode & 0o111) !== 0 })
      }
    }
  }
  walk('')

  return tree
}

const sameEntry = (a: TreeEntry, b: TreeEntry): boolean => JSON.stringify(a) === JSON.stringify(b)

/** What makes two copies differ, one line per path, in path order; empty when they are the same bytes, links and executable bits. */
export function compareTrees(a: Tree, b: Tree, labelA: string, labelB: string): string[] {
  const lines: string[] = []
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const left = a.get(path)
    const right = b.get(path)
    if (left === undefined) lines.push(`only in ${labelB}: ${path}`)
    else if (right === undefined) lines.push(`only in ${labelA}: ${path}`)
    else if (!sameEntry(left, right)) lines.push(`differs: ${path}`)
  }

  return lines
}

// ---------------------------------------------------------------------------------------------------------------------------------
// What changed since the last release

export interface DiffArea {
  area: string
  files: number
  insertions: number
  deletions: number
}

export interface DiffSummary {
  files: number
  insertions: number
  deletions: number
  areas: DiffArea[]
}

/** `git diff --numstat` summed up, and by the first two folders (a file in the root by its own name), the most changed lines first. */
export function diffSummary(numstat: string): DiffSummary {
  const summary: DiffSummary = { files: 0, insertions: 0, deletions: 0, areas: [] }
  const areas = new Map<string, DiffArea>()
  for (const line of numstat.split('\n')) {
    const [added, removed, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (added === undefined || removed === undefined || path === '') continue
    // A binary file has "-" for both: it counts as a file, with no lines.
    const insertions = added === '-' ? 0 : Number(added)
    const deletions = removed === '-' ? 0 : Number(removed)
    const parts = path.split('/')
    const key = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : path
    const area = areas.get(key) ?? { area: key, files: 0, insertions: 0, deletions: 0 }
    area.files++
    area.insertions += insertions
    area.deletions += deletions
    areas.set(key, area)
    summary.files++
    summary.insertions += insertions
    summary.deletions += deletions
  }
  summary.areas = [...areas.values()].sort((x, y) => y.insertions + y.deletions - (x.insertions + x.deletions))

  return summary
}

const count = (n: number, word: string): string => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`

/** The summary in words: one line for the whole change, then one for each area. */
export function formatDiffSummary(summary: DiffSummary): string[] {
  const lines = (files: number, insertions: number, deletions: number) => `${count(files, 'file')}, +${insertions.toLocaleString('en-US')} −${deletions.toLocaleString('en-US')}`

  return [lines(summary.files, summary.insertions, summary.deletions), ...summary.areas.map((area) => `  ${area.area}: ${lines(area.files, area.insertions, area.deletions)}`)]
}

/** The paths whose change the owner has to read before signing: what runs with the key, and what decides what the app may do. */
export const WATCHED_PATHS: readonly string[] = [
  'server/src/tools',
  'package.json',
  'package-lock.json',
  'apps/desktop/package.json',
  'apps/desktop/src-tauri/tauri.conf.json',
  'apps/desktop/src-tauri/capabilities',
]

/** For each watched path (a file, or a folder and everything below it) the changed files under it; paths with no change are left out. */
export function changedAmong(names: readonly string[], watched: readonly string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const path of watched) {
    const changed = names.filter((name) => name === path || name.startsWith(`${path}/`))
    if (changed.length > 0) result[path] = changed
  }

  return result
}
