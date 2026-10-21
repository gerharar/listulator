import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ciVerdict, listCiRuns, type CiRun } from './ciCheck.js'
import { askLine, readHiddenLine } from './hiddenPrompt.js'
import { REPO, createGhHost, nodeRunner, type Runner, type RunOptions } from './releaseSign.js'
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
 *  1. The tag is fetched, is on origin at the commit it points at here, and that commit's latest `ci.yml` run is green.
 *  2. The diff of the tools that see the key since the previous release is shown with its hash, and the run stops unless the owner
 *     names that hash (`--tools-diff-reviewed`): the reviewer's reading is part of the record.
 *  3. A worktree at the tag, `npm ci --ignore-scripts`, then the tagged `release:sign --dry-run`. `--dry-run` stops here.
 *  4. The key file's path (never read by this tool, never inside a repository) and the passphrase, asked ONCE in a hidden prompt.
 *  5. The tagged `release:sign` signs and uploads. The passphrase is in the environment of that one process, as the one variable the
 *     signer reads it from.
 *  6. The draft must now hold exactly the seven files of a signed release. Then "Publish? (y/N)": anything but y or yes publishes
 *     nothing. After a publish the tagged `release:verify` checks the public files (a few tries: GitHub takes a moment).
 *  7. The worktree is always removed.
 *
 * The passphrase (rule S5): asked for only from a terminal; never an argument (npm writes every argument to its debug log), never in
 * the environment of any other process, never written to a file; every line this tool prints, and every error it reports, goes through
 * one function that replaces it with `[passphrase]`, even what a program printed.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const PASSPHRASE_VARIABLE = 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'
const VERIFY_TRIES = 3
const VERIFY_WAIT_MS = 5000

/** The tools that see the key and the passphrase, and what they run on: the diff of these since the last release is the one to read. */
export const TOOLS_PATHS: readonly string[] = ['server/src/tools', 'package.json', 'package-lock.json', 'apps/desktop/package.json']

/** What the tool needs from git, GitHub, npm and the disk, as intentions; `createShipHost` is the real one, the tests use a fake. */
export interface ShipHost {
  fetchTags(): Promise<void>
  tagCommit(tag: string): Promise<string>
  /** The commit the tag points at ON ORIGIN (an annotated tag's commit), or undefined when origin has no such tag. */
  remoteTagCommit(tag: string): Promise<string | undefined>
  localTags(): Promise<string[]>
  ciRuns(commit: string): Promise<CiRun[]>
  toolsDiff(from: string, to: string): Promise<string>
  makeTempDir(): Promise<string>
  removeTempDir(dir: string): Promise<void>
  addWorktree(dir: string, tag: string): Promise<void>
  removeWorktree(dir: string): Promise<void>
  /** `npm ci --ignore-scripts` in the worktree. */
  install(dir: string): Promise<void>
  /** `npm run <script> -- <args>` in the worktree. `passphrase` goes into the environment of THAT process and of nothing else. */
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
  const say = (line: string) => log(redact(line))
  const show = (text: string) => {
    for (const line of text.split('\n')) if (line.trim() !== '') note(redact(line))
  }
  const failures: string[] = []
  const fail = (line: string) => failures.push(redact(line).replace(/\s+/g, ' ').trim().slice(0, 600))
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
  if (failures.length > 0) return result()

  // 2. The tools that see the key, and the hash of what changed in them.
  const previous = (await host.localTags()).filter((candidate) => isStableTag(candidate) && compareVersions(candidate.slice(1), version) < 0).sort((a, b) => compareVersions(b.slice(1), a.slice(1)))[0]
  if (previous === undefined) note('No earlier release: there is no tools diff to read')
  else {
    const diff = await host.toolsDiff(previous, tag)
    if (diff.trim() === '') say(`The tools that see the key are unchanged since ${previous}`)
    else {
      const hash = createHash('sha256').update(diff).digest('hex').slice(0, 16)
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

  // 3 to 6. In a worktree at the tag, which is always removed.
  const base = await host.makeTempDir()
  const dir = join(base, 'work')
  let added = false
  try {
    await host.addWorktree(dir, tag)
    added = true
    note('Installing the tagged tools (npm ci --ignore-scripts) ...')
    await host.install(dir)

    note('Running the tagged release:sign --dry-run ...')
    const dry = await host.runScript(dir, 'release:sign', [tag, '--dry-run'])
    show(dry.output)
    if (dry.code !== 0) {
      fail('release:sign --dry-run refused (see above): nothing was signed')

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
    const signing = await host.runScript(dir, 'release:sign', [tag, '--key-file', keyFile], passphrase)
    passphrase = ''
    show(signing.output)
    if (signing.code !== 0) {
      fail('release:sign failed (see above): the draft is as it was')

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
      if (verify.code === 0) state.verified = true
      else if (attempt < VERIFY_TRIES) await pause(VERIFY_WAIT_MS)
    }
    if (!state.verified) fail(`The release ${tag} IS published but the public check failed (release:verify, ${VERIFY_TRIES} tries, see above): look at it now`)
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

/** The environment every process this tool starts gets: the owner's own, without an updater key or passphrase variable of their shell. */
function scrubbedEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('TAURI_SIGNING')))
}

/** The real calls, without a shell. Every process gets the scrubbed environment; only `runScript` may add the passphrase, to one process. */
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

    async localTags() {
      const result = await exec('git tag', 'git', ['tag', '--list', 'v*'])

      return result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('v') && RELEASE_VERSION.test(line.slice(1)))
    },

    async ciRuns(commit) {
      return listCiRuns(run, commit, repoRoot)
    },

    async toolsDiff(from, to) {
      // Fixed options, so the same two tags give the same text, and so the same hash, whatever the owner's git configuration says.
      return (await exec('git diff', 'git', ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', from, to, '--', ...TOOLS_PATHS])).stdout
    },

    async makeTempDir() {
      return mkdtempSync(join(tmpdir(), 'release-ship-'))
    },

    async removeTempDir(dir) {
      rmSync(dir, { recursive: true, force: true })
    },

    async addWorktree(dir, tag) {
      await exec('git worktree add', 'git', ['worktree', 'add', '--detach', dir, tag])
    },

    async removeWorktree(dir) {
      await exec('git worktree remove', 'git', ['worktree', 'remove', '--force', dir])
      await exec('git worktree prune', 'git', ['worktree', 'prune'])
    },

    async install(dir) {
      await exec('npm ci', 'npm', ['ci', '--ignore-scripts'], dir)
    },

    async runScript(dir, script, args, passphrase) {
      // The ONLY process that may get the passphrase, and only as the one variable the Tauri signer reads it from.
      const env = passphrase === undefined ? scrubbedEnvironment() : { ...scrubbedEnvironment(), [PASSPHRASE_VARIABLE]: passphrase }
      const result = await run('npm', ['run', '--silent', script, '--', ...args], { cwd: dir, env })

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
      else if (/^[0-9a-f]{16}$/.test(value)) toolsDiffReviewed = value
      else return '--tools-diff-reviewed needs the 16 hexadecimal digits the tools diff printed'
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
