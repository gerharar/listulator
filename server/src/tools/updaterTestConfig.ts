import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyMinisign } from './minisignVerify.js'
import { isRunDirectly } from './runDirectly.js'
import { describeFindings, scanFiles } from './secretScan.js'
import { compareVersions, keyIdOfPublicKey, parseSignature } from './updateManifest.js'

/**
 * The three checks the updater test workflow makes around its THROW-AWAY key (Phase 31, task 31.6; docs/DECISIONS.md "Phase 31").
 * The workflow makes a key pair for the run, builds a test app that trusts only that key, signs the update installer with it, and throws
 * the private half away with the runner. Nothing here reads or prints a private key; the key's path is only handed to `staging` to look
 * for its text in what is about to be uploaded.
 *
 *   updater-test-config config  --pubkey-file <run.key.pub> --out <config.json>
 *       the committed test config plus the run's public key (refuses the app's real one), for `tauri build --config`.
 *   updater-test-config verify  --pubkey-file <run.key.pub> --installer <setup.exe> --version <v> [--installed-version <v>]
 *       the installer's `.sig` verifies against the run's key for that version, FAILS against the real key, and (with
 *       --installed-version) the update is newer than the app it is offered to.
 *   updater-test-config staging --dir <upload folder> --key-file <run.key>
 *       no file in the folder holds the key's text, and none looks like a key or a secret.
 */

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The test config with the run's public key in its updater block. The key belongs to the run: the committed config must carry none. */
export function withRunPublicKey(testConfig: Json, runPubkey: string, realPubkey: string): Json {
  const run = runPubkey.trim()
  const runId = keyIdOfPublicKey(run)
  if (runId === undefined) throw new Error('the run public key is not a minisign public key')
  if (run === realPubkey.trim() || runId === keyIdOfPublicKey(realPubkey.trim())) {
    throw new Error('the run public key is the real public key: a test app must never trust the real key')
  }

  const plugins = testConfig['plugins']
  const updater = isRecord(plugins) ? plugins['updater'] : undefined
  if (!isRecord(plugins) || !isRecord(updater)) throw new Error('the test config has no plugins.updater block to put the key in')
  if ('pubkey' in updater) throw new Error('the test config already has a pubkey: the key belongs to the run, not to the repository')

  return { ...testConfig, plugins: { ...plugins, updater: { ...updater, pubkey: run } } }
}

export interface SignedInstaller {
  runPubkey: string
  realPubkey: string
  installer: Uint8Array
  /** The content of the installer's `.sig` file. */
  signature: string
  /** The version the update is signed for. */
  version: string
  /** The version of the test app the update is offered to; the update must be newer than it. */
  installedVersion?: string
}

/** What is wrong with a signed test installer; empty when it is right. */
export function checkSignedInstaller(input: SignedInstaller): string[] {
  const parsed = parseSignature(input.signature.trim())
  if (typeof parsed === 'string') return [`the signature ${parsed}`]

  const problems: string[] = []
  const run = verifyMinisign(input.runPubkey.trim(), input.signature.trim(), input.installer)
  if (!run.ok) problems.push(`the signature does not verify against the run's public key: ${run.reason}`)
  if (parsed.version !== input.version) problems.push(`it is signed for version ${parsed.version}, not ${input.version}`)
  if (input.installedVersion !== undefined && compareVersions(input.version, input.installedVersion) <= 0) {
    problems.push(`the update ${input.version} is not newer than the installed ${input.installedVersion}`)
  }
  if (verifyMinisign(input.realPubkey.trim(), input.signature.trim(), input.installer).ok) {
    problems.push('the signature verifies against the real public key (a test build must never be signed for it)')
  }

  return problems
}

/** The least a key file can be for a search for its text to mean anything (a real one is 348 characters). */
const MIN_KEY_TEXT = 32

/** Why a key file cannot be searched for; undefined when it can. An empty needle would match everything or nothing. */
export function keyTextProblem(text: string): string | undefined {
  return text.trim().length < MIN_KEY_TEXT ? 'the key file is empty or too short to search for' : undefined
}

/** The embedded key must be a PUBLIC key file: a private key file cannot be the one named. */
export function pubkeyFileProblem(path: string): string | undefined {
  return path.endsWith('.pub') ? undefined : 'the public key file must end in .pub (a private key file cannot be the one embedded)'
}

/**
 * The paths of the files whose text holds `text` (surrounding whitespace ignored): as it is, encoded once more as base64, as the bytes it
 * decodes to (a key file is itself base64) and as UTF-16. Files are read as latin1, so every byte is one character. It does NOT see through
 * compressed data (an installer's payload is LZMA): what keeps a key out of that is that no build step is given its text, and the guard on
 * the workflow, not this search. An empty text matches nothing.
 */
export function filesHoldingText(files: { path: string; text: string }[], text: string): string[] {
  const needle = text.trim()
  if (needle === '') return []

  const forms = [needle, Buffer.from(needle).toString('base64'), Buffer.from(needle, 'utf16le').toString('latin1')]
  const decoded = Buffer.from(needle, 'base64')
  if (decoded.length >= 16 && decoded.toString('base64') === needle) forms.push(decoded.toString('latin1'))

  return files.filter((file) => forms.some((form) => file.text.includes(form))).map((file) => file.path)
}

/** The files under `dir` (absolute paths), not following links: a link back up would never end, and a link out would read what is not ours. */
export function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) return []

    return entry.isDirectory() ? filesIn(path) : entry.isFile() ? [path] : []
  })
}

// ---------------------------------------------------------------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const TEST_CONFIG = join(REPO_ROOT, 'apps/desktop/src-tauri/tauri.updater-test.conf.json')
const RELEASE_CONFIG = join(REPO_ROOT, 'apps/desktop/src-tauri/tauri.conf.json')

function option(args: string[], name: string): string {
  const at = args.indexOf(name)
  const value = at === -1 ? undefined : args[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)

  return value
}

function realPublicKey(): string {
  const release = JSON.parse(readFileSync(RELEASE_CONFIG, 'utf8')) as { plugins?: { updater?: { pubkey?: string } } }
  const pubkey = release.plugins?.updater?.pubkey
  if (typeof pubkey !== 'string') throw new Error('the release config has no updater public key')

  return pubkey
}

function main(args: string[]): number {
  const [command, ...rest] = args

  if (command === 'config') {
    const pubkeyFile = option(rest, '--pubkey-file')
    const refused = pubkeyFileProblem(pubkeyFile)
    if (refused !== undefined) throw new Error(refused)
    const pubkey = readFileSync(pubkeyFile, 'utf8')
    const config = withRunPublicKey(JSON.parse(readFileSync(TEST_CONFIG, 'utf8')) as Json, pubkey, realPublicKey())
    writeFileSync(option(rest, '--out'), `${JSON.stringify(config, null, 2)}\n`)
    console.log(`The test app will trust the run's key ${keyIdOfPublicKey(pubkey.trim())} (the real key is ${keyIdOfPublicKey(realPublicKey())}).`)

    return 0
  }

  if (command === 'verify') {
    const installer = option(rest, '--installer')
    const problems = checkSignedInstaller({
      runPubkey: readFileSync(option(rest, '--pubkey-file'), 'utf8'),
      realPubkey: realPublicKey(),
      installer: readFileSync(installer),
      signature: readFileSync(`${installer}.sig`, 'utf8'),
      version: option(rest, '--version'),
      installedVersion: rest.includes('--installed-version') ? option(rest, '--installed-version') : undefined,
    })
    if (problems.length > 0) {
      console.error(`The signed installer is wrong:\n${problems.map((problem) => `  ${problem}`).join('\n')}`)

      return 1
    }
    console.log(`The installer verifies against the run's key for ${option(rest, '--version')} and not against the real key.`)

    return 0
  }

  if (command === 'staging') {
    const dir = option(rest, '--dir')
    const keyText = readFileSync(option(rest, '--key-file'), 'latin1')
    const unusable = keyTextProblem(keyText)
    if (unusable !== undefined) throw new Error(unusable)
    const paths = filesIn(dir).map((path) => relative(dir, path))
    const holding = filesHoldingText(
      paths.map((path) => ({ path, text: readFileSync(join(dir, path), 'latin1') })),
      keyText,
    )
    const findings = scanFiles(dir, paths)
    if (holding.length > 0 || findings.length > 0) {
      console.error(`Do not upload this folder (the text is not printed):\n${holding.map((path) => `${path}  holds the run's key`).join('\n')}\n${describeFindings(findings)}`)

      return 1
    }
    console.log(`${paths.length} files to upload; none holds the run's key and none looks like a key or a secret.`)

    return 0
  }

  console.error('Usage: updater-test-config config|verify|staging (see the header of this file)')

  return 1
}

if (isRunDirectly(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
