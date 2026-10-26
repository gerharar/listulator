import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ciVerdict, listCiRuns, type CiRun } from './ciCheck.js'
import { askLine, readHiddenLine } from './hiddenPrompt.js'
import { REPO, createGhHost, dryRunReported, nodeRunner, uploadReported, type Runner, type RunOptions } from './releaseSign.js'
import { createVerifyHost, verifiedReported } from './releaseVerify.js'
import { runChecked } from './runChecked.js'
import { isStableTag, reason, short } from './toolText.js'
import { interruptSignal } from './interrupt.js'
import { isRunDirectly } from './runDirectly.js'
import { assetName, compareVersions } from './updateManifest.js'
import { RELEASE_VERSION } from './versionSources.js'

/**
 * `npm run release:ship -- <tag> [--key-file <path>] [--tools-diff-reviewed <hash>] [--pubkey-from <tag> --new-key-id <ID>] [--dry-run]` (Phase 31, task 31.5): the signing of a
 * draft Release, from the owner's side one command, one passphrase and one "y". It is a wrapper: the tagged `release:sign` does the
 * checks and the signing, in a temporary worktree at the tag, so the code that sees the key and the passphrase is the tagged code that
 * the owner (or the reviewer) read the diff of (SR-070), and the owner's working copy is never touched.
 *
 *  1. The tag is fetched, is on origin at the commit it points at here, and that commit's latest `ci.yml` run is green. The tagged tree
 *     has no `.npmrc`, symbolic link or submodule where it would change how the tools run without showing in a text diff.
 *  2. The diff of the files that decide what runs with the key (the tools, the manifests and lockfile, the TypeScript and npm
 *     configuration, the workflows) since the previous PUBLISHED release is shown, control and hidden characters made visible, with a
 *     hash of both commits and the diff. The run stops unless the owner names that hash (`--tools-diff-reviewed`): the reviewer's
 *     reading is part of the record.
 *  3. A worktree made from the tag's commit (its HEAD is checked), `npm ci --ignore-scripts`, then the tagged `release:sign --dry-run`.
 *     `--dry-run` stops here.
 *  4. The key file's path (never read by this tool, never inside a repository) and the passphrase, asked ONCE in a hidden prompt.
 *  5. The tagged `release:sign` signs and uploads. The passphrase is written to that process's standard input (`--passphrase-stdin`),
 *     which hands it to the Tauri signer's environment: the one process that needs it.
 *  6. The draft must now hold exactly the seven files of a signed release, and the tagged `release:sign --dry-run` must accept it once
 *     more. Then "Publish? (y/N)": anything but y or yes publishes nothing. After a publish the tagged `release:verify` checks the
 *     public files (a few tries: GitHub takes a moment).
 *  7. The worktree is always removed.
 *
 * A key rotation (BL-122): the bridge release is signed with the OLD key, the one the installed apps trust, while its config carries the NEW one.
 * `--pubkey-from <tag> --new-key-id <ID>` name the older release whose key that is and the new key's ID; they are passed on, unchanged, to all
 * three tagged `release:sign` runs (which refuse a tag that does not carry exactly that new key) and, as `--pubkey-from`, to the public
 * `release:verify`. Without them nothing is passed and a normal release is exactly as before.
 *
 * The tagged tools are started with `node` and `tsx` directly, never through `npm run`: a `.npmrc` (`node-options`, `script-shell`), a
 * package script or a `node_modules/.bin` entry that shadows `gh` of a tagged tree would otherwise run with the passphrase at hand.
 *
 * The passphrase (rule S5): asked for only from a terminal; never an argument (npm writes every argument to its debug log), in no
 * environment variable of any process but the signer's, never written to a file; every line this tool prints, and every error it
 * reports, goes through one function that replaces it with `[passphrase]`, even what a program printed.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const VERIFY_TRIES = 3
const VERIFY_WAIT_MS = 5000

/**
 * Everything that decides what runs with the key and the passphrase: the tools, the manifests and the lockfile they run on, the
 * TypeScript and npm configuration that changes how they are loaded, the git attributes that change how a diff is shown, and the
 * workflows that build what is signed. The diff of these since the last release is the one to read.
 */
export const TOOLS_PATHS: readonly string[] = [
  'server/src/tools',
  'server/package.json',
  'server/tsconfig.json',
  'server/tsconfig.build.json',
  'tsconfig.base.json',
  'tsconfig.json',
  'package.json',
  'package-lock.json',
  'apps/desktop/package.json',
  '.npmrc',
  '.gitattributes',
  '.github/workflows',
]

/** What the tool needs from git, GitHub, npm and the disk, as intentions; `createShipHost` is the real one, the tests use a fake. */
export interface ShipHost {
  fetchTags(): Promise<void>
  tagCommit(tag: string): Promise<string>
  /** The commit the tag points at ON ORIGIN (an annotated tag's commit), or undefined when origin has no such tag. */
  remoteTagCommit(tag: string): Promise<string | undefined>
  /** The tags of the published stable releases (drafts and pre-releases excluded). */
  publishedTags(): Promise<string[]>
  isAncestor(older: string, newer: string): Promise<boolean>
  /**
   * What in a commit's tree changes how the tools run and cannot be reviewed as a text diff (a `.npmrc`; a symbolic link or a submodule
   * that is, is under, or CONTAINS a reviewed path), and the scripts that run with the key if they are missing or not regular files.
   */
  unsafeEntries(commit: string): Promise<string[]>
  /** The reviewed paths of the owner's working copy that are not the tagged ones: another object in HEAD, or changed or new in the working tree. */
  checkoutDiffers(commit: string): Promise<string[]>
  /** Where a path really leads: a symbolic link is followed. The path itself when it does not exist. */
  realPath(path: string): Promise<string>
  ciRuns(commit: string): Promise<CiRun[]>
  toolsDiff(from: string, to: string): Promise<string>
  makeTempDir(): Promise<string>
  removeTempDir(dir: string): Promise<void>
  /** A detached worktree at a COMMIT (not a tag name, which could move between two looks). */
  addWorktree(dir: string, commit: string): Promise<void>
  worktreeHead(dir: string): Promise<string>
  removeWorktree(dir: string): Promise<void>
  /** `npm ci --ignore-scripts` in the worktree. */
  install(dir: string): Promise<void>
  /** The tagged script, run with node and tsx in the worktree. `passphrase` is written to THAT process's standard input and goes nowhere else. */
  runScript(dir: string, script: 'release:sign' | 'release:verify', args: string[], passphrase?: string): Promise<{ code: number; output: string }>
  releaseAssets(tag: string): Promise<{ isDraft: boolean; assets: string[] }>
  publish(tag: string): Promise<void>
  /** A sentence if `path` is not a usable file; only its metadata is looked at, never its content. */
  keyFileProblem(path: string): Promise<string | undefined>
}

/** The terminal: three questions, as the owner answers them. */
export interface ShipIo {
  askKeyFile(): Promise<string>
  /** The passphrase, from a hidden prompt. */
  askPassphrase(): Promise<string>
  askPublish(tag: string): Promise<string>
}

export interface ReleaseShipOptions {
  tag: string
  keyFile?: string | undefined
  /** The hash of the tools diff the owner (or the reviewer) has read. */
  toolsDiffReviewed?: string | undefined
  /**
   * Aborted by Ctrl-C (BL-126). Checked between the steps: the run takes no further one, forgets the passphrase, removes the worktree as it does
   * at the end of any run, and never publishes. A draft that was already signed stays a signed draft, and the owner is told so.
   */
  signal?: AbortSignal | undefined
  /** A key rotation's bridge release: the older release whose key (the one the installed apps trust) signs it, and the ID of the new key the tag carries. Both or neither. */
  pubkeyFrom?: string | undefined
  newKeyId?: string | undefined
  dryRun: boolean
  /** The owner's working copy: a key file must not be inside it. */
  repoRoot: string
  /** Waits between the tries of the public check. */
  pause?: (ms: number) => Promise<void>
}

export interface ReleaseShipResult {
  /** One sentence per thing that stopped it; empty when it did everything it was asked to. */
  failures: string[]
  signed: boolean
  published: boolean
  verified: boolean
}

/** The characters that are shown as they are: ASCII, the Latin letters and symbols of Latin-1 and Latin Extended, and the usual typographic ones. */
const PLAIN_EXTRA = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212])
const isPlain = (code: number): boolean => (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0x24f && code !== 0xad) || PLAIN_EXTRA.has(code)

/**
 * Text for the owner's screen. Control characters, escape sequences and a carriage return can rewrite what is shown, and a hidden,
 * bidirectional or LOOKALIKE character (a Cyrillic or Greek letter that is the same on the screen as a Latin one) can make code say
 * something else than it reads as: so everything that is not on the short list of plain characters is shown as what it is. A list of
 * what is allowed cannot be walked around by a character nobody thought of.
 */
export function visible(text: string): { text: string; replaced: boolean } {
  let replaced = false
  const shown = Array.from(text, (character) => {
    const code = character.codePointAt(0)!
    if (character === '\n' || character === '\t' || isPlain(code)) return character
    replaced = true
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return character === '\r' ? '\\r' : `\\x${code.toString(16).padStart(2, '0')}`

    return `<U+${code.toString(16).toUpperCase().padStart(4, '0')}>`
  })

  return { text: shown.join(''), replaced }
}

const isInside = (child: string, parent: string): boolean => {
  const path = relative(resolve(parent), resolve(child))

  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

export async function releaseShip(options: ReleaseShipOptions, host: ShipHost, io: ShipIo, log: (line: string) => void, note: (line: string) => void): Promise<ReleaseShipResult> {
  const { tag } = options
  if (!tag.startsWith('v') || !RELEASE_VERSION.test(tag.slice(1))) throw new Error(`${JSON.stringify(tag).slice(0, 40)} is not v + a version (like v1.1.1)`)
  const version = tag.slice(1)
  if ((options.pubkeyFrom === undefined) !== (options.newKeyId === undefined)) throw new Error('--pubkey-from and --new-key-id go together (a key rotation)')
  // What the tagged scripts are told about a rotation; nothing at all for a normal release.
  const rotationArgs = options.pubkeyFrom === undefined || options.newKeyId === undefined ? [] : ['--pubkey-from', options.pubkeyFrom, '--new-key-id', options.newKeyId]
  const verifyArgs = options.pubkeyFrom === undefined ? [tag] : [tag, '--pubkey-from', options.pubkeyFrom]
  const pause = options.pause ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))

  // The ONE place the passphrase is kept, and the ONE function every line passes through before it is shown or reported.
  let secret = ''
  const redact = (text: string): string => (secret === '' ? text : text.split(secret).join('[passphrase]'))
  const say = (line: string) => log(visible(redact(line)).text)
  // What other programs printed, and the diff, go to the screen: redacted, and with every character that could rewrite it made visible.
  const show = (text: string) => {
    const { text: safe, replaced } = visible(redact(text))
    for (const line of safe.split('\n')) if (line.trim() !== '') note(line)
    if (replaced) note('The text above contained control, hidden or non-Latin characters (a lookalike letter can change what code does); they are shown as \\x.. or <U+....>, so that they cannot rewrite the screen or pass for another letter')
  }
  const failures: string[] = []
  const fail = (line: string) => failures.push(visible(redact(line).replace(/\s+/g, ' ').trim().slice(0, 600)).text)
  const state = { signed: false, published: false, verified: false }
  const result = (): ReleaseShipResult => ({ failures, ...state })
  /** Reports why it stops, and stops. */
  const stop = (line: string): ReleaseShipResult => {
    fail(line)

    return result()
  }
  const interrupted = (): boolean => options.signal?.aborted === true
  /** What Ctrl-C ends: said once, with what is left behind (a signed draft is not published). */
  const interruption = (where: string): ReleaseShipResult => {
    if (state.signed && !state.published) {
      note(`Not published: the draft is signed. To publish: gh release edit ${tag} --repo ${REPO} --draft=false, then check the public files: npm run release:verify -- ${tag}${options.pubkeyFrom === undefined ? '' : ` --pubkey-from ${options.pubkeyFrom}`}`)
    }

    return stop(`Interrupted ${where}${state.signed && !state.published ? ': the draft is signed and NOT published' : state.published ? ': it IS published' : ': nothing was signed or published'}`)
  }

  // 1. The tag, and its CI.
  try {
    await host.fetchTags()
  } catch (error) {
    return stop(`The tags could not be fetched: ${reason(error)}`)
  }
  let commit: string
  try {
    commit = await host.tagCommit(tag)
  } catch (error) {
    return stop(reason(error))
  }
  try {
    const remote = await host.remoteTagCommit(tag)
    if (remote === undefined) fail(`The tag ${tag} is not on origin: push it first`)
    else if (remote !== commit) fail(`The tag ${tag} points at ${short(commit)} here but at ${short(remote)} on origin: this clone has a stale or moved tag`)
    else say(`${tag} is on origin at ${short(commit)}`)
  } catch (error) {
    fail(`The tag ${tag} could not be looked up on origin: ${reason(error)}`)
  }
  try {
    const verdict = ciVerdict(await host.ciRuns(commit), commit)
    if ('run' in verdict) say(`The latest ci.yml run on ${short(commit)} (run ${verdict.run.id}) is green`)
    else fail(verdict.problem)
  } catch (error) {
    fail(`The ci.yml runs of ${short(commit)} could not be read: ${reason(error)}`)
  }
  try {
    const unsafe = await host.unsafeEntries(commit)
    if (unsafe.length > 0) fail(`The tagged tree cannot be reviewed as text, or lacks what must run: ${unsafe.join(', ')}`)
  } catch (error) {
    fail(`The tagged tree could not be listed: ${reason(error)}`)
  }
  try {
    // The program that asks for the passphrase is the one in the owner's working copy: it has to be the reviewed code too.
    const differs = await host.checkoutDiffers(commit)
    if (differs.length > 0) fail(`The tools in your working copy are not the tagged ones (${differs.join(', ')}): the program that asks for the passphrase must be the reviewed code. Run git checkout ${tag} and start this again`)
  } catch (error) {
    fail(`Your working copy could not be compared with the tag: ${reason(error)}`)
  }
  if (failures.length > 0) return result()
  if (interrupted()) return interruption('before anything was done')

  // 2. What runs with the key, and the hash of what changed in it since the previous PUBLISHED release.
  const previous = (await host.publishedTags()).filter((candidate) => isStableTag(candidate) && compareVersions(candidate.slice(1), version) < 0).sort((a, b) => compareVersions(b.slice(1), a.slice(1)))[0]
  if (previous === undefined) note('No earlier release: there is no tools diff to read')
  else {
    let previousCommit: string
    try {
      previousCommit = await host.tagCommit(previous)
    } catch (error) {
      return stop(reason(error))
    }
    if (!(await host.isAncestor(previousCommit, commit))) {
      return stop(`The previous release ${previous} (${short(previousCommit)}) is not an ancestor of ${tag}: the diff would not be what changed`)
    }
    const diff = await host.toolsDiff(previousCommit, commit)
    if (diff.trim() === '') say(`The tools that see the key are unchanged since ${previous}`)
    else if (/^Binary files /m.test(diff)) {
      return stop(`git shows a file of the reviewed paths as binary ("Binary files ... differ"), so the diff cannot be reviewed as text`)
    } else {
      // Bound to both commits, so the same text between other commits, or on another clone's tags, does not fit.
      const hash = createHash('sha256').update(`${previousCommit}\n${commit}\n${diff}`).digest('hex').slice(0, 32)
      if (options.toolsDiffReviewed === hash) say(`The tools diff ${previous}..${tag} (hash ${hash}) was reviewed`)
      else {
        show(diff)
        note(`Tools diff ${previous}..${tag}: hash ${hash}`)

        return stop(
          options.toolsDiffReviewed === undefined
            ? `The tools that see the key changed since ${previous} (the diff is above, hash ${hash}). Read it; when it is as it should be, run this again with --tools-diff-reviewed ${hash}`
            : `--tools-diff-reviewed ${options.toolsDiffReviewed} is not this diff's hash (${hash}): the tools changed again since it was read, or it was mistyped`,
        )
      }
    }
  }

  if (interrupted()) return interruption('while the tools diff was read')

  // 3 to 6. In a worktree at the tag's commit, which is always removed.
  const base = await host.makeTempDir()
  const dir = join(base, 'work')
  let added = false
  try {
    await host.addWorktree(dir, commit)
    added = true
    const head = await host.worktreeHead(dir)
    if (head !== commit) {
      return stop(`The worktree is at ${short(head)}, not ${short(commit)}: nothing was run in it`)
    }
    note('Type nothing while this runs: the terminal keeps what you type, and the next question would read it.')
    note('Installing the tagged tools (npm ci --ignore-scripts) ...')
    await host.install(dir)
    if (interrupted()) return interruption('while the tagged tools were installed')

    if (options.pubkeyFrom !== undefined) note(`Key rotation: ${tag} is signed with the key of ${options.pubkeyFrom} (the one the installed apps trust); the tag must carry the new key ${options.newKeyId}`)
    note('Running the tagged release:sign --dry-run ...')
    const dry = await host.runScript(dir, 'release:sign', [tag, '--dry-run', ...rotationArgs])
    show(dry.output)
    if (interrupted()) return interruption('during the dry run')
    if (dry.code !== 0) {
      return stop('release:sign --dry-run refused (see above): nothing was signed')
    }
    if (!dryRunReported(dry.output)) {
      return stop('The dry run of release:sign exited 0 but did not say it checked the draft (see above): it may not have run at all, so nothing was signed')
    }
    if (options.dryRun) {
      note('Dry run: the tagged release:sign accepts this draft. A real run would now ask for the key file and the passphrase, sign, and ask whether to publish.')

      return result()
    }

    // 4. The key file and the passphrase.
    const keyFile = resolve((options.keyFile ?? (await io.askKeyFile())).trim())
    if (interrupted()) return interruption('at the key file')
    const [keyReal, repoReal, dirReal] = await Promise.all([host.realPath(keyFile), host.realPath(options.repoRoot), host.realPath(dir)])
    if (isInside(keyFile, options.repoRoot) || isInside(keyFile, dir) || isInside(keyReal, repoReal) || isInside(keyReal, dirReal)) {
      return stop(`The key file ${keyFile} is inside the repository: keep the key outside it, so it cannot be committed by accident`)
    }
    const problem = await host.keyFileProblem(keyFile)
    if (interrupted()) return interruption('before the passphrase was asked for')
    if (problem !== undefined) {
      return stop(problem)
    }
    let passphrase: string
    try {
      passphrase = await io.askPassphrase()
    } catch (error) {
      return stop(reason(error))
    }
    if (passphrase === '') {
      return stop('The passphrase is empty: nothing was signed')
    }
    secret = passphrase
    // Typed as Ctrl-C came: it signs nothing. The plain text is dropped now, the redaction (`secret`) stays for the lines the cleanup prints.
    if (interrupted()) {
      passphrase = ''

      return interruption('as the passphrase was typed')
    }

    // 5. The signing: the passphrase is written to this one process's standard input (never an argument, in no environment variable).
    note('Signing ...')
    const signing = await host.runScript(dir, 'release:sign', [tag, '--key-file', keyFile, '--passphrase-stdin', ...rotationArgs], passphrase)
    passphrase = ''
    show(signing.output)
    if (signing.code !== 0) {
      return stop('release:sign failed (see above): nothing was published; if it failed while uploading, the draft may hold some of the signatures, so look at the draft before signing again')
    }
    if (!uploadReported(signing.output)) {
      return stop('release:sign exited 0 but did not report an upload (see above): look at the draft before doing anything else')
    }
    state.signed = true
    if (interrupted()) return interruption('after the signing')

    // 6. What the draft holds now, and the question.
    const view = await host.releaseAssets(tag).catch((error: unknown) => {
      fail(`The draft's files could not be read: ${reason(error)}`)

      return undefined
    })
    if (view === undefined) return result()
    const exe = assetName('windows-x86_64', version)
    const archive = assetName('darwin-aarch64', version)
    const expected = [exe, `Listulator_${version}_aarch64.dmg`, archive, 'SHA256SUMS', `${exe}.sig`, `${archive}.sig`, 'latest.json']
    const missing = expected.filter((name) => !view.assets.includes(name))
    const unexpected = view.assets.filter((name) => !expected.includes(name))
    if (missing.length > 0 || unexpected.length > 0) {
      return stop(`The draft does not hold exactly the signed release's files${missing.length > 0 ? `; missing: ${missing.join(', ')}` : ''}${unexpected.length > 0 ? `; unexpected: ${unexpected.join(', ')}` : ''}`)
    }
    if (!view.isDraft) {
      return stop(`The release ${tag} is not a draft any more: look at GitHub before doing anything else`)
    }
    say(`The draft holds the ${expected.length} files of a signed release`)

    const answer = (await io.askPublish(tag)).trim()
    if (interrupted()) return interruption('at the question whether to publish')
    if (!/^y(es)?$/i.test(answer)) {
      note(`Not published: the draft is signed. To publish: gh release edit ${tag} --repo ${REPO} --draft=false, then check the public files: npm run release:verify -- ${tag}`)

      return result()
    }

    // Checked once more AFTER the answer and right before publishing, so a file swapped while the owner was deciding is found: the tagged
    // release:sign re-verifies the checksums and the attestations of the files.
    const again = await host.runScript(dir, 'release:sign', [tag, '--dry-run', ...rotationArgs])
    if (again.code !== 0) {
      show(again.output)
      return stop('The draft changed after the signing (see above): not published; the tagged release:sign --dry-run refuses it now')
    }
    if (!dryRunReported(again.output)) {
      show(again.output)
      return stop('The second dry run of release:sign exited 0 but did not say it checked the draft (see above): not published')
    }
    // The last look before the only step that cannot be taken back: an interrupted run never publishes.
    if (interrupted()) return interruption('after the second dry run')
    try {
      await host.publish(tag)
    } catch (error) {
      return stop(`Publishing failed: ${reason(error)}. The signed draft is still a draft: nothing is public`)
    }
    state.published = true
    say(`${tag} is published`)

    // 6b. The public files, a few tries: GitHub takes a moment to serve a release that was just published.
    for (let attempt = 1; attempt <= VERIFY_TRIES && !state.verified; attempt++) {
      const verify = await host.runScript(dir, 'release:verify', verifyArgs)
      show(verify.output)
      if (verify.code === 0 && verifiedReported(verify.output)) state.verified = true
      else if (attempt < VERIFY_TRIES) await pause(VERIFY_WAIT_MS)
    }
    if (!state.verified) fail(`The release ${tag} IS published but the public check failed (release:verify, ${VERIFY_TRIES} tries, see above): look at it now. To take it back to a draft: gh release edit ${tag} --repo ${REPO} --draft=true`)
    else say('release:verify passes on the public files')

    return result()
  } catch (error) {
    return stop(`Stopped: ${reason(error)}`)
  } finally {
    // 7. The worktree is always removed; the passphrase is forgotten only after the last line that could hold it.
    let removed = true
    if (added) {
      try {
        await host.removeWorktree(dir)
      } catch (error) {
        removed = false
        fail(`The worktree ${dir} could not be removed (${reason(error)}): run git worktree remove --force ${dir}, then remove ${base}`)
      }
    }
    if (removed) await host.removeTempDir(base).catch((error: unknown) => fail(`The temporary folder ${base} could not be removed (${reason(error)})`))
    secret = ''
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The real git, gh, npm and disk

/**
 * The environment every process this tool starts gets: the owner's own, without an updater key or passphrase variable of their shell
 * (the signer's current and older names) and without the variables that make a Node program load other code than the tagged one
 * (NODE_OPTIONS, NODE_PATH, ESBUILD_BINARY_PATH, TSX_*). The passphrase is in no environment: it goes to one process, on a pipe.
 */
function scrubbedEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^TAURI_(SIGNING|PRIVATE_KEY)|^TSX_/.test(name) && !LOADER_VARIABLES.has(name)))
}

/** Variables that make a Node program load or run other code than the tagged one: a preload, a module path, another esbuild, a weakened TLS check. */
const LOADER_VARIABLES = new Set(['NODE_OPTIONS', 'NODE_PATH', 'ESBUILD_BINARY_PATH', 'NODE_TLS_REJECT_UNAUTHORIZED'])

/** The scripts that run with the key: they must be in the tagged tree, as regular files. */
const REQUIRED_SCRIPTS = ['server/src/tools/releaseSign.ts', 'server/src/tools/releaseVerify.ts']

const isUnder = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`)

/** The real calls, without a shell. Every process gets the scrubbed environment; the passphrase is handed to one process only, as its input. */
export function createShipHost(rawRun: Runner, repoRoot: string): ShipHost {
  const run: Runner = (command, args, options: RunOptions = {}) => rawRun(command, args, { ...options, env: options.env ?? scrubbedEnvironment() })
  const exec = (what: string, command: string, args: string[], cwd = repoRoot) => runChecked(run, what, command, args, { cwd })
  const gh = createGhHost(run, repoRoot)

  return {
    async fetchTags() {
      await exec('git fetch', 'git', ['fetch', 'origin', '--tags'])
    },

    async tagCommit(tag) {
      const result = await run('git', ['rev-parse', '--verify', '--quiet', `${tag}^{commit}`], { cwd: repoRoot })
      const commit = result.stdout.trim()
      if (result.code !== 0 || !/^[0-9a-f]{40}$/.test(commit)) throw new Error(`The tag ${tag} is not in this clone, even after fetching: it does not exist on origin`)

      return commit
    },

    async remoteTagCommit(tag) {
      const result = await exec('git ls-remote', 'git', ['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`])
      const refs = new Map(result.stdout.split('\n').filter((line) => line !== '').map((line) => line.split('\t') as [string, string]).map(([commit, ref]) => [ref, commit]))

      // An annotated tag is listed twice: the tag object, and (with ^{}) the commit it points at.
      return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`)
    },

    async publishedTags() {
      return createVerifyHost(run).publishedTags()
    },

    async isAncestor(older, newer) {
      const result = await run('git', ['merge-base', '--is-ancestor', older, newer], { cwd: repoRoot })
      if (result.code === 0) return true
      if (result.code === 1) return false

      throw new Error(`git merge-base failed: ${(result.stderr || result.stdout).trim().slice(0, 300)}`)
    },

    async unsafeEntries(commit) {
      // -z: git does not quote a path with a space, a line break or odd characters, so every path is read as it is.
      const result = await exec('git ls-tree', 'git', ['ls-tree', '-r', '-z', '--full-tree', commit])
      const found: string[] = []
      const regular = new Set<string>()
      for (const record of result.stdout.split('\0')) {
        const tab = record.indexOf('\t')
        if (tab < 0) continue
        const mode = record.slice(0, record.indexOf(' '))
        const path = record.slice(tab + 1)
        if (mode === '100644' || mode === '100755') regular.add(path)
        // A link that IS a reviewed path, is under one, or CONTAINS one (server/src, apps/desktop, .github) would show in the diff only as deletions.
        const concerned = TOOLS_PATHS.some((folder) => isUnder(path, folder) || isUnder(folder, path))
        if (path === '.npmrc' || path.endsWith('/.npmrc')) found.push(path)
        else if (mode === '120000' && concerned) found.push(`${path} (a symbolic link)`)
        else if (mode === '160000' && concerned) found.push(`${path} (a submodule)`)
      }
      for (const script of REQUIRED_SCRIPTS) if (!regular.has(script)) found.push(`${script} (missing in the tagged tree)`)

      return found
    },

    async checkoutDiffers(commit) {
      const objectOf = async (revision: string, path: string) => {
        const result = await run('git', ['rev-parse', '--verify', '--quiet', `${revision}:${path}`], { cwd: repoRoot })

        return result.code === 0 ? result.stdout.trim() : ''
      }
      const differs: string[] = []
      for (const path of TOOLS_PATHS) if ((await objectOf('HEAD', path)) !== (await objectOf(commit, path))) differs.push(path)
      const status = await exec('git status', 'git', ['status', '--porcelain', '--untracked-files=all', '--', ...TOOLS_PATHS])
      for (const line of status.stdout.split('\n')) {
        const path = line.slice(3).replace(/^"|"$/g, '')
        if (line.length > 3 && TOOLS_PATHS.some((folder) => isUnder(path, folder))) differs.push(`${path} (uncommitted)`)
      }

      return differs
    },

    async realPath(path) {
      try {
        return realpathSync(path)
      } catch {
        return resolve(path)
      }
    },

    async ciRuns(commit) {
      return listCiRuns(run, commit, repoRoot)
    },

    async toolsDiff(from, to) {
      // Fixed options, so the same two tags give the same text, and so the same hash, whatever the owner's git configuration says.
      // --text: a `-diff` in a .gitattributes cannot turn the diff into "Binary files differ".
      return (await exec('git diff', 'git', ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--text', from, to, '--', ...TOOLS_PATHS])).stdout
    },

    async makeTempDir() {
      // By its real path: macOS's temporary folder is reached through a symbolic link, and a script started through one silently does nothing.
      return realpathSync(mkdtempSync(join(tmpdir(), 'release-ship-')))
    },

    async removeTempDir(dir) {
      rmSync(dir, { recursive: true, force: true })
    },

    async addWorktree(dir, commit) {
      await exec('git worktree add', 'git', ['worktree', 'add', '--detach', dir, commit])
    },

    async worktreeHead(dir) {
      return (await exec('git rev-parse', 'git', ['rev-parse', 'HEAD'], dir)).stdout.trim()
    },

    async removeWorktree(dir) {
      await exec('git worktree remove', 'git', ['worktree', 'remove', '--force', dir])
      await exec('git worktree prune', 'git', ['worktree', 'prune'])
    },

    async install(dir) {
      await exec('npm ci', 'npm', ['ci', '--ignore-scripts'], dir)
    },

    async runScript(dir, script, args, passphrase) {
      // node and tsx directly, not `npm run`: nothing of the tagged tree (.npmrc, a package script, node_modules/.bin on PATH) stands
      // between the passphrase and the tool. The passphrase is this process's standard input, in no argument and no environment.
      const entry = join(dir, 'server', 'src', 'tools', script === 'release:sign' ? 'releaseSign.ts' : 'releaseVerify.ts')
      const result = await run(process.execPath, [join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), entry, ...args], { cwd: dir, env: scrubbedEnvironment(), ...(passphrase === undefined ? {} : { input: `${passphrase}\n` }) })

      return { code: result.code, output: `${result.stdout}${result.stderr}` }
    },

    async releaseAssets(tag) {
      return gh.viewRelease(tag)
    },

    async publish(tag) {
      await exec('gh release edit', 'gh', ['release', 'edit', tag, '--repo', REPO, '--draft=false'])
    },

    async keyFileProblem(path) {
      try {
        if (statSync(path).isFile()) return undefined
      } catch {
        // missing or not readable: the same sentence
      }

      return `The key file ${path} is not a file`
    },
  }
}

export interface ReleaseShipArguments {
  tag: string
  keyFile?: string
  toolsDiffReviewed?: string
  pubkeyFrom?: string
  newKeyId?: string
  dryRun: boolean
}

/** The command line as a value, or a sentence saying what is wrong with it. There is no passphrase option, on purpose. */
export function parseReleaseShipArguments(args: readonly string[]): ReleaseShipArguments | string {
  let tag: string | undefined
  let keyFile: string | undefined
  let toolsDiffReviewed: string | undefined
  let pubkeyFrom: string | undefined
  let newKeyId: string | undefined
  let dryRun = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--key-file' || arg === '--tools-diff-reviewed' || arg === '--pubkey-from' || arg === '--new-key-id') {
      const value = args[index + 1]
      if (value === undefined) return `${arg} needs a value`
      index++
      if (arg === '--key-file') keyFile = value
      else if (arg === '--pubkey-from' || arg === '--new-key-id') {
        if ((arg === '--pubkey-from' ? pubkeyFrom : newKeyId) !== undefined) return `${arg} can be given only once`
        if (arg === '--pubkey-from') pubkeyFrom = value
        else newKeyId = value
      } else if (/^[0-9a-f]{32}$/.test(value)) toolsDiffReviewed = value
      else return '--tools-diff-reviewed needs the 32 hexadecimal digits the tools diff printed'
    } else if (/^-{1,2}(p|pass\w*)(=|$)/i.test(arg)) return `the passphrase is asked for in a hidden prompt, never given as an option (${JSON.stringify(arg.split('=')[0]).slice(0, 20)})`
    else if (arg.startsWith('-')) return `unknown option ${JSON.stringify(arg).slice(0, 30)}`
    else if (tag === undefined) tag = arg
    else return 'only one tag can be shipped at a time'
  }
  if (tag === undefined) return 'name the tag whose draft is to be signed (like v1.1.1)'
  if (!tag.startsWith('v') || !RELEASE_VERSION.test(tag.slice(1))) return `${JSON.stringify(tag).slice(0, 40)} is not a tag (like v1.1.1)`
  if ((pubkeyFrom === undefined) !== (newKeyId === undefined)) return pubkeyFrom === undefined ? '--new-key-id goes with --pubkey-from (a key rotation)' : '--pubkey-from needs --new-key-id (a key rotation)'
  if (pubkeyFrom !== undefined && !(pubkeyFrom.startsWith('v') && RELEASE_VERSION.test(pubkeyFrom.slice(1)))) return `--pubkey-from needs a tag (like v1.1.0), not ${JSON.stringify(pubkeyFrom).slice(0, 40)}`
  if (newKeyId !== undefined && !/^[0-9A-Fa-f]{16}$/.test(newKeyId)) return '--new-key-id needs the 16 hexadecimal digits of the key ID'

  return {
    tag,
    dryRun,
    ...(keyFile === undefined ? {} : { keyFile }),
    ...(toolsDiffReviewed === undefined ? {} : { toolsDiffReviewed }),
    ...(pubkeyFrom === undefined ? {} : { pubkeyFrom }),
    ...(newKeyId === undefined ? {} : { newKeyId: newKeyId.toUpperCase() }),
  }
}

if (isRunDirectly(import.meta.url)) {
  const parsed = parseReleaseShipArguments(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(`${parsed}\nUsage: npm run release:ship -- <tag> [--key-file <path>] [--tools-diff-reviewed <hash>] [--pubkey-from <tag> --new-key-id <ID>] [--dry-run]`)
    process.exit(1)
  }
  if (!parsed.dryRun && process.stdin.isTTY !== true) {
    console.error('release:ship asks for the passphrase in a hidden prompt, so it has to run in a terminal window')
    process.exit(1)
  }

  const streams = { input: process.stdin, output: process.stdout }
  // Ctrl-C ends the run where it is, with the worktree removed and nothing published (BL-126); a second one stops the process at once.
  const interrupt = interruptSignal(process, (line) => console.error(line))
  const io: ShipIo = {
    askKeyFile: () => askLine('Path of the updater key file: ', streams, interrupt.signal),
    askPassphrase: () => readHiddenLine('Updater key passphrase (what you type is not shown): ', streams),
    askPublish: (tag) => askLine(`Publish ${tag} now? (y/N) `, streams, interrupt.signal),
  }

  try {
    const result = await releaseShip({ ...parsed, repoRoot: REPO_ROOT, signal: interrupt.signal }, createShipHost(nodeRunner, REPO_ROOT), io, (line) => console.log(`ok    ${line}`), (line) => console.log(line))
    interrupt.dispose()
    for (const failure of result.failures) console.error(`FAIL  ${failure}`)
    if (interrupt.signal.aborted) process.exit(130)
    if (result.failures.length > 0) {
      console.error(`${parsed.tag}: ${result.failures.length} problem${result.failures.length === 1 ? '' : 's'}`)
      process.exit(1)
    }
    console.log(result.published ? `${parsed.tag}: signed, published and verified` : result.signed ? `${parsed.tag}: signed (not published)` : `${parsed.tag}: ready to sign (dry run)`)
  } catch (error) {
    console.error(visible(reason(error)).text)
    process.exit(1)
  }
}
