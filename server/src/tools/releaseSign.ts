import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve, isAbsolute } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { verifyMinisign } from './minisignVerify.js'
import { KEY_ROTATION_PATH, declaredSignerOf } from './keyRotation.js'
import { isRunDirectly } from './runDirectly.js'
import { assetName, buildManifest, keyIdOfPublicKey, manifestProblems, serializeManifest, type PlatformKey } from './updateManifest.js'
import { RELEASE_VERSION } from './versionSources.js'

/**
 * `npm run release:sign -- <tag> [--dry-run] [--key-file <path>] [--current <version>] [--pubkey-from <tag> --new-key-id <ID>]` (Phase 20, task 20.12c). Run by the owner,
 * on their own machine, after the release workflow has drafted a Release (docs/release-runbook.md; design: docs/security-review.md
 * section 13). The updater key never leaves this machine and never reaches CI, so this is the step that makes an update
 * installable, and the one that must not sign anything it has not checked:
 *
 *  0. The tag is in this clone, its commit is on `origin/main`, and (for a real run) it is the commit checked out, with no changes in the
 *     working tree: the tools below (this script, `tsx`, the Tauri CLI) run on the key machine, so they have to be the tagged, built ones.
 *  1. The tag is a draft Release holding exactly the files the workflow makes (and at most the signatures and manifest of an earlier run).
 *  2. Its files are downloaded and match SHA256SUMS.
 *  3. Every file (installer, disk image, update archive) has a build attestation from THIS repository's release workflow on THIS tag
 *     and on the tag's commit.
 *  4. Only then are the two update files signed, with the Tauri signer, bound to the tag's version. The key file's path is handed to
 *     the signer; this script never reads the key. The passphrase is the signer's: asked for on the terminal, or handed over in the
 *     environment by `release:ship` (31.5); never an argument, never logged.
 *  5. Every signature is verified against the public key built into the app, the manifest is built and checked again
 *     (`updateManifest.ts`), and its signatures once more.
 *  6. Only then are the two signatures and `latest.json` uploaded to the draft. Publishing the Release stays a click on GitHub.
 *
 * `--dry-run` does 1 to 3 and stops: no key, no signature, no upload. A run that stops anywhere leaves the draft as it was.
 */

export const REPO = 'gerharar/listulator'
const RELEASE_WORKFLOW = `${REPO}/.github/workflows/release.yml`
export const CONFIG_PATH = 'apps/desktop/src-tauri/tauri.conf.json'
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * How this tool says it did what it was asked to. `release:ship` reads these as the sign that the script ran at all: an exit code of 0 is
 * not enough, a script that never ran exits 0 too (it did, through a symbolic link). They are recognised HERE, next to the lines they
 * recognise, and tested against the tool's real output, so rewording a line cannot silently break the wrapper.
 */
const DRY_RUN_REPORT = 'Dry run: everything checks out'
export const dryRunReported = (output: string): boolean => output.includes(DRY_RUN_REPORT)
export const uploadReported = (output: string): boolean => /^Uploaded .* to the draft /m.test(output)

/** What the script needs from GitHub, the signer and the disk, as intentions; `createGhHost` is the real one, the tests use a fake. */
export interface TagState {
  /** The full commit the tag points at. */
  commit: string
  /** The commit is on `origin/main`. */
  onMain: boolean
  /** The commit is the one checked out in the repository folder. */
  checkedOut: boolean
  /** The working tree has no changes (untracked files count). */
  clean: boolean
}

export interface ReleaseHost {
  /** Where the tag is in this clone; throws if the tag is not here. */
  tagState(tag: string): Promise<TagState>
  viewRelease(tag: string): Promise<{ isDraft: boolean; assets: string[] }>
  /** The version (no `v`) of the latest published stable release, if there is one. */
  latestPublished(): Promise<string | undefined>
  download(tag: string, names: string[], dir: string): Promise<void>
  verifyAttestation(file: string, tag: string, commit: string): Promise<boolean>
  /** Signs `file` with the key in `keyFile`, bound to `version`, writing `file.sig`. The passphrase is asked for by the signer itself. */
  signFile(file: string, keyFile: string, version: string): Promise<void>
  upload(tag: string, files: string[]): Promise<void>
}

export interface ReleaseSignOptions {
  tag: string
  dryRun: boolean
  keyFile?: string | undefined
  /** The public key built into the app (`plugins.updater.pubkey`) of the tagged commit. */
  pubkey: string
  /** The repository folder, which the key file must not be inside. */
  repoRoot: string
  /** The version the manifest has to beat; by default the latest published stable release's. */
  current?: string | undefined
  /**
   * A key rotation: `pubkey` is then the OLD key (what the installed apps trust and what signs), and the tag's own key is
   * `newPubkey`. The owner names the new key's ID, so a changed key in a commit nobody looked at cannot be signed through.
   */
  rotation?: { newPubkey: string; newKeyId: string; /** The older release whose key `pubkey` is (`--pubkey-from`). */ from: string } | undefined
  /** The older release the tagged TREE declares the tag was signed with (`keyRotation.json`, BL-141), or undefined when it declares nothing for this tag. */
  declaredFrom?: string | undefined
  now?: () => Date
}

export interface ReleaseSignResult {
  dryRun: boolean
  uploaded: string[]
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

/** Where a path really leads (a symbolic link is followed); the path itself when it does not exist. */
const realOrResolved = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

const isInside = (child: string, parent: string): boolean => {
  const path = relative(realOrResolved(parent), realOrResolved(child))

  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

/** The lines of a `SHA256SUMS` file (`<hash>  <name>`) as a map; undefined if any line is not of that form. */
export function parseSums(text: string): Map<string, string> | undefined {
  const sums = new Map<string, string>()
  for (const line of text.split('\n').filter((entry) => entry !== '')) {
    const match = /^([0-9a-f]{64}) [ *]([^/\\\s]+)$/.exec(line)
    if (match === null || sums.has(match[2]!)) return undefined
    sums.set(match[2]!, match[1]!)
  }

  return sums
}

export async function releaseSign(options: ReleaseSignOptions, host: ReleaseHost, log: (line: string) => void): Promise<ReleaseSignResult> {
  const { tag, dryRun, keyFile, pubkey, repoRoot } = options
  const now = options.now ?? (() => new Date())
  if (!tag.startsWith('v') || !RELEASE_VERSION.test(tag.slice(1))) throw new Error(`The tag ${JSON.stringify(tag).slice(0, 40)} is not v + a version (like v1.0.0)`)
  const version = tag.slice(1)

  const keyId = keyIdOfPublicKey(pubkey)
  if (keyId === undefined) throw new Error('The public key in the app’s config is not a minisign public key, so signatures could not be checked')
  if (!dryRun) {
    if (keyFile === undefined) throw new Error('Name the updater key file (--key-file <path>)')
    if (!existsSync(keyFile) || !statSync(keyFile).isFile()) throw new Error(`The key file ${keyFile} is not a file`)
    if (isInside(keyFile, repoRoot)) throw new Error(`The key file ${keyFile} is inside the repository: keep the key outside it, so it cannot be committed by accident`)
  }

  if (options.rotation !== undefined) {
    const newId = keyIdOfPublicKey(options.rotation.newPubkey)
    if (newId === undefined) throw new Error('The new public key in the tagged config is not a minisign public key')
    if (newId === keyId) throw new Error(`This is no rotation: the tag carries the same key as the installed apps trust (ID ${keyId})`)
    if (newId !== options.rotation.newKeyId.toUpperCase()) throw new Error(`The tag carries the public key ID ${newId}, not ${options.rotation.newKeyId.toUpperCase()}, the one you named`)
  }

  // The bridge release is declared in its own tree (BL-141), so that the public check and the canary judge it by the same key as this signing.
  // Both ways are refused: a rotation the tree does not declare, and a declared one signed as a normal release.
  const declaration = `"bridges": { "${tag}": { "signedWithKeyOf": "<the older release>" } }`
  if (options.rotation !== undefined && options.declaredFrom !== options.rotation.from) {
    throw new Error(
      `${KEY_ROTATION_PATH} of ${tag} must declare this bridge release (${declaration.replace('<the older release>', options.rotation.from)}), but it ${options.declaredFrom === undefined ? 'declares nothing for it' : `declares ${options.declaredFrom}`}: without it the public check and the daily canary would judge the release by its own new key. Commit it with the release, tag again, and start over`,
    )
  }
  if (options.rotation === undefined && options.declaredFrom !== undefined) {
    throw new Error(`${tag} is declared a bridge release in ${KEY_ROTATION_PATH} (signed with the key of ${options.declaredFrom}) but no --pubkey-from and --new-key-id were given: signing it with its own key would contradict the declaration`)
  }

  const state = await host.tagState(tag)
  if (!state.onMain) throw new Error(`The commit tagged ${tag} is not on main (origin/main): run git fetch --tags, and release only what is on main`)
  if (!dryRun) {
    if (!state.checkedOut) throw new Error(`Signing runs the tools in this folder with your key, so they must be the tagged ones. Run: git checkout ${tag} && npm ci --ignore-scripts`)
    if (!state.clean) throw new Error(`The working tree has changes (see git status --short). Signing runs the tools in it with your key: remove the changes, or check out the tag in a clean clone, and run: npm ci --ignore-scripts`)
  }

  const exe = assetName('windows-x86_64', version)
  const archive = assetName('darwin-aarch64', version)
  const dmg = `Listulator_${version}_aarch64.dmg`
  const required = [exe, dmg, archive, 'SHA256SUMS']
  const earlierRun = [`${exe}.sig`, `${archive}.sig`, 'latest.json']

  const release = await host.viewRelease(tag).catch(() => {
    throw new Error(`There is no release for the tag ${tag}`)
  })
  if (!release.isDraft) throw new Error(`The release ${tag} is not a draft: only a draft's files are signed`)
  const missing = required.filter((name) => !release.assets.includes(name))
  if (missing.length > 0) throw new Error(`The draft lacks ${missing.join(', ')}`)
  const unexpected = release.assets.filter((name) => !required.includes(name) && !earlierRun.includes(name))
  if (unexpected.length > 0) throw new Error(`The draft has files nobody expected, which were not checked: ${unexpected.join(', ')}`)

  const dir = mkdtempSync(join(tmpdir(), 'release-sign-'))
  try {
    await host.download(tag, required, dir)
    const bytes = new Map(required.map((name) => [name, readFileSync(join(dir, name))]))

    const sums = parseSums(bytes.get('SHA256SUMS')!.toString('utf8'))
    const checked = [exe, dmg, archive]
    if (sums === undefined || sums.size !== checked.length || checked.some((name) => !sums.has(name))) {
      throw new Error(`SHA256SUMS does not list exactly ${checked.join(', ')}`)
    }
    for (const name of checked) {
      const actual = sha256(bytes.get(name)!)
      if (actual !== sums.get(name)) throw new Error(`${name} does not match its checksum in SHA256SUMS`)
      log(`${name}  sha256 ${actual}`)
    }

    for (const name of checked) {
      if (!(await host.verifyAttestation(join(dir, name), tag, state.commit))) {
        throw new Error(`${name}: no valid build attestation from this repository's release workflow on ${tag} (commit ${state.commit.slice(0, 12)})`)
      }
      log(`${name}  built by ${RELEASE_WORKFLOW} on ${tag}`)
    }

    if (dryRun) {
      log(`${DRY_RUN_REPORT}. A real run would sign ${exe} and ${archive} with the updater key (ID ${keyId}), then upload ${exe}.sig, ${archive}.sig and latest.json to the draft ${tag}.`)
      return { dryRun: true, uploaded: [] }
    }

    const current = options.current ?? (await host.latestPublished())
    log(`Signing for the app's key ID ${keyId}, version ${version}${current === undefined ? ' (no earlier release)' : ` (the latest release is ${current})`}`)

    const signatures = {} as Record<PlatformKey, string>
    for (const [platform, name] of [['windows-x86_64', exe], ['darwin-aarch64', archive]] as const) {
      const file = join(dir, name)
      await host.signFile(file, keyFile!, version)
      signatures[platform] = readFileSync(`${file}.sig`, 'utf8').trim()
      const verdict = verifyMinisign(pubkey, signatures[platform], bytes.get(name)!)
      if (!verdict.ok) throw new Error(`${name}: the signature just made does not verify against the app's public key: ${verdict.reason}`)
      log(`${name}  signed (${verdict.trustedComment.replace(/\t/g, ' ')})`)
    }

    const manifest = buildManifest({ tag, pubDate: `${now().toISOString().slice(0, 19)}Z`, signatures, keyId, ...(current === undefined ? {} : { current }) })
    const manifestText = serializeManifest(manifest)
    // The manifest as it will be read by an app: parsed again, judged again, and every signature in it verified against the files once more.
    const reread = JSON.parse(manifestText) as typeof manifest
    const problems = manifestProblems(reread, { tag, keyId, ...(current === undefined ? {} : { current }) })
    if (problems.length > 0) throw new Error(`The manifest as written breaks ${problems.length} rule(s):\n${problems.join('\n')}`)
    for (const [platform, name] of [['windows-x86_64', exe], ['darwin-aarch64', archive]] as const) {
      const again = verifyMinisign(pubkey, reread.platforms[platform].signature, bytes.get(name)!)
      if (!again.ok) throw new Error(`${name}: the signature in the manifest does not verify: ${again.reason}`)
    }

    const manifestPath = join(dir, 'latest.json')
    writeFileSync(manifestPath, manifestText)
    const uploads = [`${join(dir, exe)}.sig`, `${join(dir, archive)}.sig`, manifestPath]
    await host.upload(tag, uploads)
    log(`Uploaded ${uploads.map((file) => basename(file)).join(', ')} to the draft ${tag}. Publishing it is yours to do on GitHub.`)

    return { dryRun: false, uploaded: uploads.map((file) => basename(file)) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The real GitHub CLI, Tauri signer and git

export interface RunOptions {
  /** Hand the terminal to the command (the signer asks for the passphrase on it). */
  inherit?: boolean
  env?: Record<string, string | undefined>
  cwd?: string
  /** Written to the program's standard input, which is then closed: how a secret reaches a program without an argument or an environment variable. */
  input?: string
}

export type Runner = (command: string, args: string[], options?: RunOptions) => Promise<{ code: number; stdout: string; stderr: string }>

/** Runs a command without a shell: the arguments go to the program as they are. */
export const nodeRunner: Runner = (command, args, options = {}) =>
  new Promise((resolvePromise, reject) => {
    if (options.inherit && options.input !== undefined) {
      reject(new Error('A command cannot be given input and the terminal both'))

      return
    }
    const child = spawn(command, args, {
      stdio: options.inherit ? 'inherit' : [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    })
    if (options.input !== undefined) {
      // A program that ends without reading its input is not an error of ours.
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(options.input)
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }))
  })

/** The environment variables the Tauri signer reads its key or passphrase from, under its current and its older names. */
const isSigningVariable = (name: string): boolean => name.startsWith('TAURI_SIGNING') || name.startsWith('TAURI_PRIVATE_KEY')

/** Removes every such variable from `env` (default: this process's) and returns their NAMES. No program this one starts then inherits one. */
export function scrubSigningEnvironment(env: Record<string, string | undefined> = process.env): string[] {
  const names = Object.keys(env).filter(isSigningVariable)
  for (const name of names) delete env[name]

  return names
}

/**
 * `passphrase`: the updater key's passphrase, when `release:ship` handed it over on a pipe (`--passphrase-stdin`). It is given to the
 * signer's environment (the one variable the signer reads it from) and to nothing else; without it the signer asks on the terminal.
 */
export function createGhHost(run: Runner, repoRoot: string, passphrase?: string): ReleaseHost {
  const git = (args: string[]) => run('git', args, { cwd: repoRoot })

  return {
    async tagState(tag) {
      const tagged = await git(['rev-parse', '--verify', '--quiet', `${tag}^{commit}`])
      const commit = tagged.stdout.trim()
      if (tagged.code !== 0 || !/^[0-9a-f]{40}$/.test(commit)) throw new Error(`The tag ${tag} is not in this clone: run git fetch --tags`)
      const head = await git(['rev-parse', 'HEAD'])
      const status = await git(['status', '--porcelain'])
      const ancestor = await git(['merge-base', '--is-ancestor', commit, 'origin/main'])

      return { commit, onMain: ancestor.code === 0, checkedOut: head.code === 0 && head.stdout.trim() === commit, clean: status.code === 0 && status.stdout.trim() === '' }
    },

    async viewRelease(tag) {
      const result = await run('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'isDraft,assets'])
      if (result.code !== 0) throw new Error(`gh could not read the release ${tag}`)
      const parsed = JSON.parse(result.stdout) as { isDraft: boolean; assets: { name: string }[] }

      return { isDraft: parsed.isDraft, assets: parsed.assets.map((asset) => asset.name) }
    },

    async latestPublished() {
      const result = await run('gh', ['release', 'list', '--repo', REPO, '--exclude-drafts', '--exclude-pre-releases', '--limit', '1', '--json', 'tagName'])
      if (result.code !== 0) throw new Error('gh could not list the published releases')
      const tagName = (JSON.parse(result.stdout) as { tagName: string }[])[0]?.tagName

      return tagName !== undefined && tagName.startsWith('v') && RELEASE_VERSION.test(tagName.slice(1)) ? tagName.slice(1) : undefined
    },

    async download(tag, names, dir) {
      const result = await run('gh', ['release', 'download', tag, '--repo', REPO, '--dir', dir, ...names.flatMap((name) => ['--pattern', name])])
      if (result.code !== 0) throw new Error(`gh could not download the files of ${tag}: ${result.stderr.trim().slice(0, 200)}`)
    },

    async verifyAttestation(file, tag, commit) {
      // Made by THIS repository's release workflow on THIS tag and the tag's commit: an attestation from some other workflow of the
      // repository, from another ref, or from a build of another commit (a tag moved or a workflow edited on a branch) does not count.
      const result = await run('gh', ['attestation', 'verify', file, '--repo', REPO, '--signer-workflow', RELEASE_WORKFLOW, '--source-ref', `refs/tags/${tag}`, '--source-digest', commit])

      return result.code === 0
    },

    async signFile(file, keyFile, version) {
      // The signer is started directly with node, not through npm: no `.npmrc`, no package script and no `node_modules/.bin` on PATH of
      // the tagged tree stands between the passphrase and the signer. No updater KEY variable reaches it (its content or a path), so a
      // stray one cannot be what signs: only the file named here does. The passphrase is never an argument (npm writes every argument
      // to its debug log); it is only in the signer's own environment, or asked for on the terminal this command is given.
      const env: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).filter(([name]) => !isSigningVariable(name)))
      if (passphrase !== undefined) env['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'] = passphrase
      const signer = join(repoRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
      const result = await run(process.execPath, [signer, 'signer', 'sign', '-f', keyFile, '--app-version', version, file], { inherit: true, env, cwd: repoRoot })
      if (result.code !== 0) throw new Error(`The Tauri signer failed to sign ${basename(file)} (exit ${result.code}): wrong passphrase or key file?`)
    },

    async upload(tag, files) {
      const result = await run('gh', ['release', 'upload', tag, ...files, '--repo', REPO, '--clobber'])
      if (result.code !== 0) throw new Error(`gh could not upload to the draft ${tag}: ${result.stderr.trim().slice(0, 200)}`)
    },
  }
}

/** The public key of the tagged commit (that is what the app was built with). The tag must be in this clone: no other source is trusted. */
export async function readPubkey(tag: string, run: Runner, repoRoot: string): Promise<{ pubkey: string; source: string }> {
  const fromTag = await run('git', ['show', `${tag}:${CONFIG_PATH}`], { cwd: repoRoot })
  if (fromTag.code !== 0) throw new Error(`The tag ${tag} is not in this clone: run git fetch --tags`)
  const text = fromTag.stdout
  const pubkey = (JSON.parse(text) as { plugins?: { updater?: { pubkey?: string } } }).plugins?.updater?.pubkey
  if (typeof pubkey !== 'string') throw new Error(`No updater public key in ${CONFIG_PATH}`)

  return { pubkey, source: `the tag ${tag}` }
}

/** The bridge declaration of the tagged tree: what it says about the tag, or a thrown sentence when the file is wrong. A tree with no such file declares nothing. */
export async function readDeclaredFrom(tag: string, run: Runner, repoRoot: string): Promise<string | undefined> {
  const shown = await run('git', ['show', `${tag}:${KEY_ROTATION_PATH}`], { cwd: repoRoot })
  const declared = declaredSignerOf(shown.code === 0 ? shown.stdout : undefined, tag)
  if ('problem' in declared) throw new Error(declared.problem)

  return declared.from
}

/** The passphrase, from a pipe (`--passphrase-stdin`): all of it, without its line break. Never from a terminal, and never echoed in an error. */
export async function readPassphrase(input: NodeJS.ReadableStream & { isTTY?: boolean }): Promise<string> {
  if (input.isTTY === true) throw new Error('--passphrase-stdin reads a pipe, not a terminal: release:ship gives it, nobody types it here')
  input.setEncoding('utf8')
  let text = ''
  for await (const chunk of input) text += String(chunk)
  const passphrase = text.replace(/\r?\n$/, '')
  if (passphrase === '') throw new Error('The passphrase on the pipe is empty')

  return passphrase
}

export interface ReleaseSignArguments {
  tag: string
  dryRun: boolean
  keyFile?: string
  current?: string
  /** A key rotation: the tag whose public key the INSTALLED apps trust (the tagged release itself carries the new key). */
  pubkeyFrom?: string
  /** A key rotation: the ID (upper case) of the new key, which the tag must carry. */
  newKeyId?: string
  /** The passphrase comes on standard input, from `release:ship`. */
  passphraseStdin?: boolean
}

/** The command line as a value, or a sentence saying what is wrong with it. There is no password option, on purpose. */
export function parseReleaseSignArguments(args: readonly string[]): ReleaseSignArguments | string {
  let tag: string | undefined
  let dryRun = false
  let keyFile: string | undefined
  let current: string | undefined
  let pubkeyFrom: string | undefined
  let newKeyId: string | undefined
  let passphraseStdin = false

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--passphrase-stdin') passphraseStdin = true
    else if (arg === '--key-file' || arg === '--current' || arg === '--pubkey-from' || arg === '--new-key-id') {
      const value = args[index + 1]
      if (value === undefined) return `${arg} needs a value`
      index++
      if (arg === '--key-file') keyFile = value
      else if (arg === '--current') current = value
      else if (arg === '--pubkey-from') pubkeyFrom = value
      else newKeyId = value
    } else if (arg.startsWith('-')) return `unknown option ${JSON.stringify(arg.split('=')[0]).slice(0, 30)} (the passphrase is asked for by the signer, never given here)`
    else if (tag === undefined) tag = arg
    else return 'only one tag can be signed at a time'
  }
  if (tag === undefined) return 'name the tag whose draft is to be signed (like v1.0.0)'
  if (passphraseStdin && dryRun) return '--passphrase-stdin is for a real signing: a dry run asks for no passphrase'
  if (passphraseStdin && keyFile === undefined) return '--passphrase-stdin needs --key-file: standard input is the passphrase, so nothing can ask for the path'
  if ((pubkeyFrom === undefined) !== (newKeyId === undefined)) return pubkeyFrom === undefined ? '--new-key-id goes with --pubkey-from (a key rotation)' : '--pubkey-from needs --new-key-id: the ID of the new key, from its .pub file'
  if (pubkeyFrom !== undefined && !(pubkeyFrom.startsWith('v') && RELEASE_VERSION.test(pubkeyFrom.slice(1)))) return `--pubkey-from needs a tag (like v1.0.0), not ${JSON.stringify(pubkeyFrom).slice(0, 40)}`
  if (newKeyId !== undefined && !/^[0-9A-Fa-f]{16}$/.test(newKeyId)) return '--new-key-id needs the 16 hexadecimal digits of the key ID'

  return {
    tag,
    dryRun,
    ...(keyFile === undefined ? {} : { keyFile }),
    ...(current === undefined ? {} : { current }),
    ...(pubkeyFrom === undefined ? {} : { pubkeyFrom }),
    ...(newKeyId === undefined ? {} : { newKeyId: newKeyId.toUpperCase() }),
    ...(passphraseStdin ? { passphraseStdin } : {}),
  }
}

if (isRunDirectly(import.meta.url)) {
  // First of all: no updater key or passphrase variable of the shell is used, and no program started below inherits one.
  const ignored = scrubSigningEnvironment()
  if (ignored.length > 0) console.error(`Ignoring ${ignored.join(', ')} in the environment: the key is the file given with --key-file, and the passphrase is asked for by the signer`)
  const parsed = parseReleaseSignArguments(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(`${parsed}\nUsage: npm run release:sign -- <tag> [--dry-run] [--key-file <path>] [--current <version>] [--pubkey-from <tag> --new-key-id <ID>] [--passphrase-stdin]`)
    process.exit(1)
  }

  try {
    let keyFile = parsed.keyFile
    if (!parsed.dryRun && keyFile === undefined) {
      const terminal = createInterface({ input: process.stdin, output: process.stdout })
      keyFile = (await terminal.question('Path of the updater key file: ')).trim()
      terminal.close()
    }
    const { pubkey, source } = await readPubkey(parsed.pubkeyFrom ?? parsed.tag, nodeRunner, REPO_ROOT)
    console.log(`Public key read from ${source}${parsed.pubkeyFrom === undefined ? '' : ' (key rotation: signing for the apps that are installed)'}`)
    const rotation = parsed.newKeyId === undefined || parsed.pubkeyFrom === undefined ? undefined : { newPubkey: (await readPubkey(parsed.tag, nodeRunner, REPO_ROOT)).pubkey, newKeyId: parsed.newKeyId, from: parsed.pubkeyFrom }
    const declaredFrom = await readDeclaredFrom(parsed.tag, nodeRunner, REPO_ROOT)

    const passphrase = parsed.passphraseStdin === true ? await readPassphrase(process.stdin) : undefined
    const host = createGhHost(nodeRunner, REPO_ROOT, passphrase)
    const result = await releaseSign({ tag: parsed.tag, dryRun: parsed.dryRun, keyFile, pubkey, repoRoot: REPO_ROOT, current: parsed.current, rotation, declaredFrom }, host, (line) => console.log(line))
    if (!result.dryRun) {
      const after = await host.viewRelease(parsed.tag)
      console.log(`The draft now holds:\n${after.assets.map((name) => `  ${name}`).join('\n')}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
