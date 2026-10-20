import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyMinisign } from './minisignVerify.js'
import { isRunDirectly } from './runDirectly.js'
import { describeFindings, scanFiles } from './secretScan.js'
import { keyIdOfPublicKey, parseSignature } from './updateManifest.js'

/**
 * The three checks the updater test workflow makes around its THROW-AWAY key (Phase 31, task 31.6; docs/DECISIONS.md "Phase 31").
 * The workflow makes a key pair for the run, builds a test app that trusts only that key, signs the update installer with it, and throws
 * the private half away with the runner. Nothing here reads or prints a private key; the key's path is only handed to `staging` to look
 * for its text in what is about to be uploaded.
 *
 *   updater-test-config config  --pubkey-file <run.key.pub> --out <config.json>
 *       the committed test config plus the run's public key (refuses the app's real one), for `tauri build --config`.
 *   updater-test-config verify  --pubkey-file <run.key.pub> --installer <setup.exe> --version <v>
 *       the installer's `.sig` verifies against the run's key for that version, and FAILS against the real key.
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
  version: string
}

/** What is wrong with a signed test installer; empty when it is right. */
export function checkSignedInstaller(input: SignedInstaller): string[] {
  const parsed = parseSignature(input.signature.trim())
  if (typeof parsed === 'string') return [`the signature ${parsed}`]

  const problems: string[] = []
  const run = verifyMinisign(input.runPubkey.trim(), input.signature.trim(), input.installer)
  if (!run.ok) problems.push(`the signature does not verify against the run's public key: ${run.reason}`)
  if (parsed.version !== input.version) problems.push(`it is signed for version ${parsed.version}, not ${input.version}`)
  if (verifyMinisign(input.realPubkey.trim(), input.signature.trim(), input.installer).ok) {
    problems.push('the signature verifies against the real public key (a test build must never be signed for it)')
  }

  return problems
}

/** The paths of the files whose text holds `text` (surrounding whitespace ignored); an empty text matches nothing. */
export function filesHoldingText(files: { path: string; text: string }[], text: string): string[] {
  const needle = text.trim()
  if (needle === '') return []

  return files.filter((file) => file.text.includes(needle)).map((file) => file.path)
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

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)

    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

function main(args: string[]): number {
  const [command, ...rest] = args

  if (command === 'config') {
    const pubkey = readFileSync(option(rest, '--pubkey-file'), 'utf8')
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
    const paths = filesUnder(dir).map((path) => relative(dir, path))
    const holding = filesHoldingText(
      paths.map((path) => ({ path, text: readFileSync(join(dir, path), 'latin1') })),
      readFileSync(option(rest, '--key-file'), 'latin1'),
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
