import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeKeyPair, signLikeTauri } from './minisignTesting.js'
import { verifyMinisign } from './minisignVerify.js'
import { isRunDirectly } from './runDirectly.js'
import { compareVersions, parseSignature } from './updateManifest.js'
import { buildTestManifest, type TestEntry } from './updaterTestManifest.js'
import { DEFAULT_PORT } from './updaterServe.js'
import { RELEASE_VERSION } from './versionSources.js'

/**
 * Builds the folders for the updater's two-version test (Phase 20, task 20.13b):
 * `npm run updater:kit -- <folder with the signed files> <new folder for the kit> --installed 1.0.0-rc.1`.
 *
 * The input is the Windows installer and the macOS archive of the NEWER test build (rc.2), each with the `.sig` the owner made with
 * the real updater key. The output is one folder per test case, each ready to serve (`npm run updater:serve -- <folder>`): the
 * files and the `latest.json` for that case. Every case is made from the same two real files, so what differs is exactly what the
 * case needs to be wrong (a changed byte, another key, an announced version that was not signed, the other system's entry, a
 * version that is not newer). The kit refuses to be built from signatures that do not verify against the app's real public key:
 * without that, "the update was refused" would prove nothing.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`
/**
 * The first version that is shipped. The test files are signed with the REAL key, and the plugin does not tie a signature to the file
 * it is for, so a test build signed for a shipped version could be offered to every install by whoever controls the endpoint
 * (20.14, SR-070). A signed version below this one is never offered to an install of it. Revisit: a separate test key (then this goes).
 */
const FIRST_RELEASE = '1.0.0'

export interface KitFile {
  name: string
  bytes: Buffer
  /** The content of its `.sig`. */
  signature: string
}

export interface KitInput {
  exe: KitFile
  archive: KitFile
  /** The version of the OLDER test build that is installed and is to be offered the update. */
  installed: string
  pubkey: string
  pubDate: string
}

export interface KitScenario {
  name: string
  files: Record<string, Buffer | string>
}

/** The bytes with one byte in the middle changed: the length is the same, so only the signature can tell. */
function tampered(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes)
  const middle = Math.floor(copy.length / 2)
  copy[middle] = copy[middle]! ^ 0xff

  return copy
}

export function buildKitScenarios(input: KitInput): KitScenario[] {
  if (!RELEASE_VERSION.test(input.installed)) throw new Error(`The installed version ${JSON.stringify(input.installed).slice(0, 40)} is not a version`)

  const signed = [input.exe, input.archive].map((file) => {
    const signature = file.signature.trim()
    const verdict = verifyMinisign(input.pubkey, signature, file.bytes)
    if (!verdict.ok) throw new Error(`${file.name}: ${verdict.reason}`)
    const parsed = parseSignature(signature)
    if (typeof parsed === 'string') throw new Error(`${file.name}: signature ${parsed}`)
    if (parsed.file !== file.name) throw new Error(`${file.name}: its signature covers ${parsed.file}`)

    return { ...file, signature, version: parsed.version }
  })
  const [exe, archive] = signed as [(typeof signed)[number], (typeof signed)[number]]
  if (exe.version !== archive.version) throw new Error(`The two files must be signed for the same version, not ${exe.version} and ${archive.version}`)
  const version = exe.version
  if (compareVersions(version, FIRST_RELEASE) >= 0) throw new Error(`The test files are signed for ${version}: with the real key, a test build must stay below ${FIRST_RELEASE} (a prerelease like ${FIRST_RELEASE}-rc.2)`)
  if (compareVersions(input.installed, version) >= 0) throw new Error(`The installed version ${input.installed} must be older than the signed version ${version}, or there is no update to test`)

  // Signatures by another key that are right in every other way: the same file and version in the trusted comment.
  const foreign = makeKeyPair('61BCBF5980E87475')
  const foreignSignature = (file: KitFile) => signLikeTauri(foreign.privateKey, foreign.keyIdBytes, file.bytes, `timestamp:1791734534\tfile:${file.name}\tversion:${version}`)

  const manifest = (announced: string, entries: { windows?: TestEntry; mac?: TestEntry }): string =>
    `${JSON.stringify(buildTestManifest({ baseUrl: BASE_URL, version: announced, pubDate: input.pubDate, ...entries }).manifest, null, 2)}\n`
  const real = { windows: { file: exe.name, signature: exe.signature }, mac: { file: archive.name, signature: archive.signature } }
  const realFiles = (): Record<string, Buffer | string> => ({ [exe.name]: exe.bytes, [`${exe.name}.sig`]: exe.signature, [archive.name]: archive.bytes, [`${archive.name}.sig`]: archive.signature })

  const wrongKeyExe = foreignSignature(exe)
  const wrongKeyArchive = foreignSignature(archive)

  return [
    { name: 'ok', files: { ...realFiles(), 'latest.json': manifest(version, real) } },
    {
      name: 'tampered',
      files: { ...realFiles(), [exe.name]: tampered(exe.bytes), [archive.name]: tampered(archive.bytes), 'latest.json': manifest(version, real) },
    },
    {
      name: 'wrong-key',
      files: {
        ...realFiles(),
        [`${exe.name}.sig`]: wrongKeyExe,
        [`${archive.name}.sig`]: wrongKeyArchive,
        'latest.json': manifest(version, { windows: { file: exe.name, signature: wrongKeyExe }, mac: { file: archive.name, signature: wrongKeyArchive } }),
      },
    },
    // Announces a version that was not the one signed, and a newer one so that only the signature's version can refuse it.
    { name: 'wrong-version', files: { ...realFiles(), 'latest.json': manifest('99.0.0', real) } },
    {
      name: 'other-os-mac',
      files: { [exe.name]: exe.bytes, [`${exe.name}.sig`]: exe.signature, 'latest.json': manifest(version, { windows: real.windows }) },
    },
    {
      name: 'other-os-windows',
      files: { [archive.name]: archive.bytes, [`${archive.name}.sig`]: archive.signature, 'latest.json': manifest(version, { mac: real.mac }) },
    },
    { name: 'same-version', files: { ...realFiles(), 'latest.json': manifest(input.installed, real) } },
    { name: 'lower-version', files: { ...realFiles(), 'latest.json': manifest('0.0.1', real) } },
  ]
}

export interface WindowsKitInput {
  exe: KitFile
  /** The version of the OLDER test build that is installed. */
  installed: string
  /** The public key the app trusts, when it is known: the installer's signature is then checked against it. A run's key is not always at hand. */
  pubkey?: string
  pubDate: string
}

/**
 * The cases of the Windows update test (Phase 31, task 31.8): the same ones as above for a machine that has only the Windows installer,
 * signed with the key of its run. There is no macOS archive and no real key; the macOS entry of "the other system" is a stand-in that
 * no Windows app downloads. The other key (wrong-key) is made here, in memory, and signs nothing but this folder's installer.
 */
export function buildWindowsKitScenarios(input: WindowsKitInput): KitScenario[] {
  if (!RELEASE_VERSION.test(input.installed)) throw new Error(`The installed version ${JSON.stringify(input.installed).slice(0, 40)} is not a version`)
  const exe = { ...input.exe, signature: input.exe.signature.trim() }
  if (input.pubkey !== undefined) {
    const verdict = verifyMinisign(input.pubkey, exe.signature, exe.bytes)
    if (!verdict.ok) throw new Error(`${exe.name}: ${verdict.reason}`)
  }
  const parsed = parseSignature(exe.signature)
  if (typeof parsed === 'string') throw new Error(`${exe.name}: signature ${parsed}`)
  if (parsed.file !== exe.name) throw new Error(`${exe.name}: its signature covers ${parsed.file}`)
  const version = parsed.version
  if (compareVersions(input.installed, version) >= 0) throw new Error(`The installed version ${input.installed} must be older than the signed version ${version}, or there is no update to test`)

  const foreign = makeKeyPair('61BCBF5980E87475')
  const sign = (name: string, bytes: Buffer) => signLikeTauri(foreign.privateKey, foreign.keyIdBytes, bytes, `timestamp:1791734534\tfile:${name}\tversion:${version}`)
  const manifest = (announced: string, entries: { windows?: TestEntry; mac?: TestEntry }): string =>
    `${JSON.stringify(buildTestManifest({ baseUrl: BASE_URL, version: announced, pubDate: input.pubDate, ...entries }).manifest, null, 2)}\n`
  const real = { file: exe.name, signature: exe.signature }
  const foreignSignature = sign(exe.name, exe.bytes)
  const standIn = { name: 'ListulatorUpdaterTest.app.tar.gz', bytes: Buffer.from('a macOS archive that no Windows app downloads') }
  const files = (): Record<string, Buffer | string> => ({ [exe.name]: exe.bytes, [`${exe.name}.sig`]: exe.signature })

  return [
    { name: 'ok', files: { ...files(), 'latest.json': manifest(version, { windows: real }) } },
    { name: 'tampered', files: { ...files(), [exe.name]: tampered(exe.bytes), 'latest.json': manifest(version, { windows: real }) } },
    {
      name: 'wrong-key',
      files: { ...files(), [`${exe.name}.sig`]: foreignSignature, 'latest.json': manifest(version, { windows: { file: exe.name, signature: foreignSignature } }) },
    },
    // Announces a version that was not the one signed, and a newer one so that only the signature's version can refuse it.
    { name: 'wrong-version', files: { ...files(), 'latest.json': manifest('99.0.0', { windows: real }) } },
    {
      name: 'other-os-windows',
      files: { [standIn.name]: standIn.bytes, 'latest.json': manifest(version, { mac: { file: standIn.name, signature: sign(standIn.name, standIn.bytes) } }) },
    },
    { name: 'same-version', files: { ...files(), 'latest.json': manifest(input.installed, { windows: real }) } },
    { name: 'lower-version', files: { ...files(), 'latest.json': manifest('0.0.1', { windows: real }) } },
  ]
}

export interface WriteKitOptions {
  inDir: string
  outDir: string
  installed: string
  pubkey: string
  now?: () => Date
}

function findInput(dir: string): { exe: KitFile; archive: KitFile } {
  const names = readdirSync(dir)
  const exes = names.filter((name) => /^ListulatorUpdaterTest_.+_x64-setup\.exe$/.test(name))
  const archive = 'ListulatorUpdaterTest.app.tar.gz'
  if (exes.length !== 1) throw new Error(`${dir} needs exactly one ListulatorUpdaterTest_<version>_x64-setup.exe and its .sig (found ${exes.length})`)
  if (!names.includes(archive)) throw new Error(`${dir} needs ${archive} and its .sig`)

  const read = (name: string): KitFile => {
    if (!names.includes(`${name}.sig`)) throw new Error(`${dir} needs ${name}.sig (sign ${name} with the updater key first)`)

    return { name, bytes: readFileSync(join(dir, name)), signature: readFileSync(join(dir, `${name}.sig`), 'utf8') }
  }

  return { exe: read(exes[0]!), archive: read(archive) }
}

export function writeKit(options: WriteKitOptions): { scenarios: KitScenario[] } {
  const now = options.now ?? (() => new Date())
  if (existsSync(options.outDir) && readdirSync(options.outDir).length > 0) throw new Error(`${options.outDir} is not empty: use a new folder, so two kits are never mixed`)

  const { exe, archive } = findInput(options.inDir)
  const scenarios = buildKitScenarios({ exe, archive, installed: options.installed, pubkey: options.pubkey, pubDate: `${now().toISOString().slice(0, 19)}Z` })
  for (const scenario of scenarios) {
    const dir = join(options.outDir, scenario.name)
    mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(scenario.files)) writeFileSync(join(dir, name), content)
  }

  return { scenarios }
}

export interface KitArguments {
  inDir: string
  outDir: string
  installed: string
}

/** The command line as a value, or a sentence saying what is wrong with it. */
export function parseKitArguments(args: readonly string[]): KitArguments | string {
  const folders: string[] = []
  let installed: string | undefined

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--installed') {
      installed = args[index + 1]
      if (installed === undefined) return '--installed needs a version'
      index++
    } else if (arg.startsWith('-')) return `unknown option ${JSON.stringify(arg).slice(0, 30)}`
    else folders.push(arg)
  }
  if (folders.length !== 2) return 'name two folders: the one with the signed files, and a new one for the kit'
  if (installed === undefined) return 'give the version of the installed (older) test build with --installed'

  return { inDir: folders[0]!, outDir: folders[1]!, installed }
}

if (isRunDirectly(import.meta.url)) {
  const parsed = parseKitArguments(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(`${parsed}\nUsage: npm run updater:kit -- <folder with the signed files> <new folder for the kit> --installed <version>`)
    process.exit(1)
  }
  try {
    const config = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')) as { plugins: { updater: { pubkey: string } } }
    const { scenarios } = writeKit({ ...parsed, pubkey: config.plugins.updater.pubkey })
    console.log(`Wrote ${scenarios.length} folders into ${resolve(parsed.outDir)}:`)
    for (const scenario of scenarios) console.log(`  ${scenario.name}: ${Object.keys(scenario.files).join(', ')}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
