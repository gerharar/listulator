import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ciVerdict, listCiRuns, type CiRun } from './ciCheck.js'
import { askLine, readHiddenLine } from './hiddenPrompt.js'
import { REPO, createGhHost, nodeRunner, type Runner, type RunOptions } from './releaseSign.js'
import { createVerifyHost } from './releaseVerify.js'
import { runChecked } from './runChecked.js'
import { isRunDirectly } from './runDirectly.js'
import { assetName, compareVersions } from './updateManifest.js'
import { RELEASE_VERSION } from './versionSources.js'

/**
 * `npm run release:ship -- <tag> [--key-file <path>] [--tools-diff-reviewed <hash>] [--dry-run]` (Phase 31, task 31.5): the signing of a
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
 * The tagged tools are started with `node` and `tsx` directly, never through `npm run`: a `.npmrc` (`node-options`, `script-shell`), a
 * package script or a `node_modules/.bin` entry that shadows `gh` of a tagged tree would otherwise run with the passphrase at hand.
 *
 * The passphrase (rule S5): asked for only from a terminal; never an argument (npm writes every argument to its debug log), in no
 * environment variable of any process but the signer's, never written to a file; every line this tool prints, and every error it
 * reports, goes through one function that replaces it with `[passphrase]`, even what a program printed.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const VERIFY_TRIES = 3
// What each tagged tool prints when it did what it was asked to. An exit code of 0 is not enough: a script that did not run at all exits 0
// too (it did, once, through a symbolic link), so each step needs its positive sign.
const DRY_RUN_PASSED = /Dry run: everything checks out/
const UPLOADED = /Uploaded .* to the draft/
const VERIFIED = /: verified\s*$/m
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
  /** What in a commit's tree changes how the tools run and cannot be reviewed as a text diff: a `.npmrc`, a symbolic link or a submodule under the reviewed paths. */
  unsafeEntries(commit: string): Promise<string[]>
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

/** Text for the owner's screen: control characters, escape sequences, a carriage return and hidden or bidirectional characters can rewrite what is shown, so they are shown as what they are. */
export function visible(text: string): { text: string; replaced: boolean } {
  let replaced = false
  const shown = Array.from(text, (character) => {
    const code = character.codePointAt(0)!
    if (character === '\n' || character === '\t') return character
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      replaced = true

      return character === '\r' ? '\\r' : `\\x${code.toString(16).padStart(2, '0')}`
    }
    if ((code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2060 && code <= 0x2064) || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff) {
      replaced = true

      return `<U+${code.toString(16).toUpperCase().padStart(4, '0')}>`
    }

    return character
  })

  return { text: shown.join(''), replaced }
}

const isStableTag = (value: string): boolean => value.startsWith('v') && !value.includes('-') && RELEASE_VERSION.test(value.slice(1))
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const short = (commit: string): string => commit.slice(0, 12)
const isInside = (child: string, parent: string): boolean => {
  const path = relative(resolve(parent), resolve(child))

  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

export async function releaseShip(options: ReleaseShipOptions, host: ShipHost, io: ShipIo, log: (line: string) => void, note: (line: string) => void): Promise<ReleaseShipResult> {
  const { tag } = options
  if (!tag.startsWith('v') || !RELEASE_VERSION.test(tag.slice(1))) throw new Error(`${JSON.stringify(tag).slice(0, 40)} is not v + a version (like v1.1.1)`)
  const version = tag.slice(1)
  const pause = options.pause ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))

  // The ONE place the passphrase is kept, and the ONE function every line passes through before it is shown or reported.
  let secret = ''
  const redact = (text: string): string => (secret === '' ? text : text.split(secret).join('[passphrase]'))
  const say = (line: string) => log(visible(redact(line)).text)
  // What other programs printed, and the diff, go to the screen: redacted, and with every character that could rewrite it made visible.
  const show = (text: string) => {
    const { text: safe, replaced } = visible(redact(text))
    for (const line of safe.split('\n')) if (line.trim() !== '') note(line)
    if (replaced) note('The text above contained control or hidden characters; they are shown as \\x.. or <U+....>, so that they cannot rewrite the screen')
  }
  const failures: string[] = []
  const fail = (line: string) => failures.push(visible(redact(line).replace(/\s+/g, ' ').trim().slice(0, 600)).text)
  const state = { signed: false, published: false, verified: false }
  const result = (): ReleaseShipResult => ({ failures, ...state })

  // 1. The tag, and its CI.
  try {
    await host.fetchTags()
  } catch (error) {
    fail(`The tags could not be fetched: ${reason(error)}`)

    return result()
  }
  let commit: string
  try {
    commit = await host.tagCommit(tag)
  } catch (error) {
    fail(reason(error))

    return result()
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
    if (unsafe.length > 0) fail(`The tagged tree has files that change how the tools run and cannot be reviewed as text: ${unsafe.join(', ')}`)
  } catch (error) {
    fail(`The tagged tree could not be listed: ${reason(error)}`)
  }
  if (failures.length > 0) return result()

  // 2. What runs with the key, and the hash of what changed in it since the previous PUBLISHED release.
  const previous = (await host.publishedTags()).filter((candidate) => isStableTag(candidate) && compareVersions(candidate.slice(1), version) < 0).sort((a, b) => compareVersions(b.slice(1), a.slice(1)))[0]
  if (previous === undefined) note('No earlier release: there is no tools diff to read')
  else {
    let previousCommit: string
    try {
      previousCommit = await host.tagCommit(previous)
    } catch (error) {
      fail(reason(error))

      return result()
    }
    if (!(await host.isAncestor(previousCommit, commit))) {
      fail(`The previous release ${previous} (${short(previousCommit)}) is not an ancestor of ${tag}: the diff would not be what changed`)

      return result()
    }
    const diff = await host.toolsDiff(previousCommit, commit)
    if (diff.trim() === '') say(`The tools that see the key are unchanged since ${previous}`)
    else if (/^Binary files /m.test(diff)) {
      fail(`git shows a file of the reviewed paths as binary ("Binary files ... differ"), so the diff cannot be reviewed as text`)

      return result()
    } else {
      // Bound to both commits, so the same text between other commits, or on another clone's tags, does not fit.
      const hash = createHash('sha256').update(`${previousCommit}\n${commit}\n${diff}`).digest('hex').slice(0, 32)
      if (options.toolsDiffReviewed === hash) say(`The tools diff ${previous}..${tag} (hash ${hash}) was reviewed`)
      else {
        show(diff)
        note(`Tools diff ${previous}..${tag}: hash ${hash}`)
        fail(
          options.toolsDiffReviewed === undefined
            ? `The tools that see the key changed since ${previous} (the diff is above, hash ${hash}). Read it; when it is as it should be, run this again with --tools-diff-reviewed ${hash}`
            : `--tools-diff-reviewed ${options.toolsDiffReviewed} is not this diff's hash (${hash}): the tools changed again since it was read, or it was mistyped`,
        )

        return result()
      }
    }
  }

  // 3 to 6. In a worktree at the tag's commit, which is always removed.
  const base = await host.makeTempDir()
  const dir = join(base, 'work')
  let added = false
  try {
    await host.addWorktree(dir, commit)
    added = true
    const head = await host.worktreeHead(dir)
    if (head !== commit) {
      fail(`The worktree is at ${short(head)}, not ${short(commit)}: nothing was run in it`)

      return result()
    }
    note('Type nothing while this runs: the terminal keeps what you type, and the next question would read it.')
    note('Installing the tagged tools (npm ci --ignore-scripts) ...')
    await host.install(dir)

    note('Running the tagged release:sign --dry-run ...')
    const dry = await host.runScript(dir, 'release:sign', [tag, '--dry-run'])
    show(dry.output)
    if (dry.code !== 0) {
      fail('release:sign --dry-run refused (see above): nothing was signed')

      return result()
    }
    if (!DRY_RUN_PASSED.test(dry.output)) {
      fail('The dry run of release:sign exited 0 but did not say it checked the draft (see above): it may not have run at all, so nothing was signed')

      return result()
    }
    if (options.dryRun) {
      note('Dry run: the tagged release:sign accepts this draft. A real run would now ask for the key file and the passphrase, sign, and ask whether to publish.')

      return result()
    }

    // 4. The key file and the passphrase.
    const keyFile = resolve((options.keyFile ?? (await io.askKeyFile())).trim())
    if (isInside(keyFile, options.repoRoot) || isInside(keyFile, dir)) {
      fail(`The key file ${keyFile} is inside the repository: keep the key outside it, so it cannot be committed by accident`)

      return result()
    }
    const problem = await host.keyFileProblem(keyFile)
    if (problem !== undefined) {
      fail(problem)

      return result()
    }
    let passphrase: string
    try {
      passphrase = await io.askPassphrase()
    } catch (error) {
      fail(reason(error))

      return result()
    }
    if (passphrase === '') {
      fail('The passphrase is empty: nothing was signed')

      return result()
    }
    secret = passphrase

    // 5. The signing: the passphrase goes into this one process's environment.
    note('Signing ...')
    const signing = await host.runScript(dir, 'release:sign', [tag, '--key-file', keyFile, '--passphrase-stdin'], passphrase)
    passphrase = ''
    show(signing.output)
    if (signing.code !== 0) {
      fail('release:sign failed (see above): the draft is as it was')

      return result()
    }
    if (!UPLOADED.test(signing.output)) {
      fail('release:sign exited 0 but did not report an upload (see above): look at the draft before doing anything else')

      return result()
    }
    state.signed = true

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
      fail(`The draft does not hold exactly the signed release's files${missing.length > 0 ? `; missing: ${missing.join(', ')}` : ''}${unexpected.length > 0 ? `; unexpected: ${unexpected.join(', ')}` : ''}`)

      return result()
    }
    if (!view.isDraft) {
      fail(`The release ${tag} is not a draft any more: look at GitHub before doing anything else`)

      return result()
    }
    say(`The draft holds the ${expected.length} files of a signed release`)

    // Checked once more right before the question: the tagged release:sign re-verifies the checksums and the attestations of the files.
    const again = await host.runScript(dir, 'release:sign', [tag, '--dry-run'])
    if (again.code !== 0) {
      show(again.output)
      fail('The draft changed after the signing (see above): not published; the tagged release:sign --dry-run refuses it now')

      return result()
    }
    if (!DRY_RUN_PASSED.test(again.output)) {
      show(again.output)
      fail('The second dry run of release:sign exited 0 but did not say it checked the draft (see above): not published')

      return result()
    }

    const answer = (await io.askPublish(tag)).trim()
    if (!/^y(es)?$/i.test(answer)) {
      note(`Not published: the draft is signed. To publish: gh release edit ${tag} --repo ${REPO} --draft=false, then check the public files: npm run release:verify -- ${tag}`)

      return result()
    }
    try {
      await host.publish(tag)
    } catch (error) {
      fail(`Publishing failed: ${reason(error)}. The signed draft is still a draft: nothing is public`)

      return result()
    }
    state.published = true
    say(`${tag} is published`)

    // 6b. The public files, a few tries: GitHub takes a moment to serve a release that was just published.
    for (let attempt = 1; attempt <= VERIFY_TRIES && !state.verified; attempt++) {
      const verify = await host.runScript(dir, 'release:verify', [tag])
      show(verify.output)
      if (verify.code === 0 && VERIFIED.test(verify.output)) state.verified = true
      else if (attempt < VERIFY_TRIES) await pause(VERIFY_WAIT_MS)
    }
    if (!state.verified) fail(`The release ${tag} IS published but the public check failed (release:verify, ${VERIFY_TRIES} tries, see above): look at it now. To take it back to a draft: gh release edit ${tag} --repo ${REPO} --draft=true`)
    else say('release:verify passes on the public files')

    return result()
  } catch (error) {
    fail(`Stopped: ${reason(error)}`)

    return result()
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
 * (the signer's current and older names) and without NODE_OPTIONS, which would load code into every Node process. The passphrase is in
 * no environment: it goes to one process, on a pipe.
 */
function scrubbedEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^TAURI_(SIGNING|PRIVATE_KEY)/.test(name) && name !== 'NODE_OPTIONS'))
}

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
      const result = await exec('git ls-tree', 'git', ['ls-tree', '-r', '--full-tree', commit])
      const found: string[] = []
      for (const line of result.stdout.split('\n')) {
        const [meta, path] = line.split('\t') as [string, string | undefined]
        if (path === undefined) continue
        const mode = meta.split(' ')[0]
        const reviewed = TOOLS_PATHS.some((folder) => isUnder(path, folder))
        if (path === '.npmrc' || path.endsWith('/.npmrc')) found.push(path)
        else if (mode === '120000' && reviewed) found.push(`${path} (a symbolic link)`)
        else if (mode === '160000' && reviewed) found.push(`${path} (a submodule)`)
      }

      return found
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
  dryRun: boolean
}

/** The command line as a value, or a sentence saying what is wrong with it. There is no passphrase option, on purpose. */
export function parseReleaseShipArguments(args: readonly string[]): ReleaseShipArguments | string {
  let tag: string | undefined
  let keyFile: string | undefined
  let toolsDiffReviewed: string | undefined
  let dryRun = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--key-file' || arg === '--tools-diff-reviewed') {
      const value = args[index + 1]
      if (value === undefined) return `${arg} needs a value`
      index++
      if (arg === '--key-file') keyFile = value
      else if (/^[0-9a-f]{32}$/.test(value)) toolsDiffReviewed = value
      else return '--tools-diff-reviewed needs the 32 hexadecimal digits the tools diff printed'
    } else if (/^-{1,2}(p|pass\w*)(=|$)/i.test(arg)) return `the passphrase is asked for in a hidden prompt, never given as an option (${JSON.stringify(arg.split('=')[0]).slice(0, 20)})`
    else if (arg.startsWith('-')) return `unknown option ${JSON.stringify(arg).slice(0, 30)}`
    else if (tag === undefined) tag = arg
    else return 'only one tag can be shipped at a time'
  }
  if (tag === undefined) return 'name the tag whose draft is to be signed (like v1.1.1)'
  if (!tag.startsWith('v') || !RELEASE_VERSION.test(tag.slice(1))) return `${JSON.stringify(tag).slice(0, 40)} is not a tag (like v1.1.1)`

  return { tag, dryRun, ...(keyFile === undefined ? {} : { keyFile }), ...(toolsDiffReviewed === undefined ? {} : { toolsDiffReviewed }) }
}

if (isRunDirectly(import.meta.url)) {
  const parsed = parseReleaseShipArguments(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(`${parsed}\nUsage: npm run release:ship -- <tag> [--key-file <path>] [--tools-diff-reviewed <hash>] [--dry-run]`)
    process.exit(1)
  }
  if (!parsed.dryRun && process.stdin.isTTY !== true) {
    console.error('release:ship asks for the passphrase in a hidden prompt, so it has to run in a terminal window')
    process.exit(1)
  }

  const streams = { input: process.stdin, output: process.stdout }
  const io: ShipIo = {
    askKeyFile: () => askLine('Path of the updater key file: ', streams),
    askPassphrase: () => readHiddenLine('Updater key passphrase (what you type is not shown): ', streams),
    askPublish: (tag) => askLine(`Publish ${tag} now? (y/N) `, streams),
  }

  try {
    const result = await releaseShip({ ...parsed, repoRoot: REPO_ROOT }, createShipHost(nodeRunner, REPO_ROOT), io, (line) => console.log(`ok    ${line}`), (line) => console.log(line))
    for (const failure of result.failures) console.error(`FAIL  ${failure}`)
    if (result.failures.length > 0) {
      console.error(`${parsed.tag}: ${result.failures.length} problem${result.failures.length === 1 ? '' : 's'}`)
      process.exit(1)
    }
    console.log(result.published ? `${parsed.tag}: signed, published and verified` : result.signed ? `${parsed.tag}: signed (not published)` : `${parsed.tag}: ready to sign (dry run)`)
  } catch (error) {
    console.error(reason(error))
    process.exit(1)
  }
}
