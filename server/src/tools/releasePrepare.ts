import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ciVerdict, listCiRuns, type CiRun } from './ciCheck.js'
import { nodeRunner, type Runner } from './releaseSign.js'
import { runChecked } from './runChecked.js'
import { reason, short } from './toolText.js'
import { isRunDirectly } from './runDirectly.js'
import { compareVersions } from './updateManifest.js'
import { RELEASE_VERSION, VERSION_SOURCES } from './versionSources.js'

/**
 * `npm run release:prepare -- X.Y.Z [--dry-run] [--tag]` (Phase 31, task 31.3): everything before the Release run of a release that a
 * command can check or do, so the owner's part is the CHANGELOG entry and the word "go". It refuses, all at once and before it
 * writes anything, unless:
 *
 *  - the branch is `main`, the working tree is clean (untracked files count) and HEAD is the commit `origin/main` is at;
 *  - the latest `ci.yml` run on HEAD is green (CI only runs on pushed commits, so an unpushed HEAD has none);
 *  - `CHANGELOG.md` has a `## [X.Y.Z]` entry with something under it (that file is the owner's: this tool only reads it);
 *  - X.Y.Z is newer than the version the app has now, and the tag `vX.Y.Z` exists neither here nor on origin.
 *
 * Then it runs `version:set`, then `npm run notices`, and commits the version files as "Version X.Y.Z" (the title of every version commit
 * so far). The commit differs from the CI-tested HEAD in version lines only, which is enforced: only the files `version:set` owns may
 * change, and if the notices change, everything is put back and the diff is shown (the committed notices are out of date: that is a
 * commit of its own first). Without `--tag` it stops there, nothing pushed. With `--tag` (the owner's "go") it makes the annotated tag
 * and pushes the commit and the tag in ONE atomic push, so the Release run starts from a tag whose commit is on `main`. `--dry-run`
 * does the checks and writes nothing: it reads the remote with `git ls-remote`, which fetches nothing.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const NOTICES = 'THIRD-PARTY-NOTICES.txt'
const VERSION_FILES: ReadonlySet<string> = new Set(VERSION_SOURCES.map((source) => source.file))
const MAX_LISTED = 5
const MAX_DIFF_LINES = 200

/** What the tool needs from git, GitHub, npm and the disk, as intentions; `createPrepareHost` is the real one, the tests use a fake. */
export interface PrepareHost {
  /** The current branch's name; `HEAD` when detached. */
  branch(): Promise<string>
  /** `git status --porcelain` with every untracked file named. */
  status(): Promise<string>
  headCommit(): Promise<string>
  /** The commit `main` is at ON ORIGIN, read from the remote itself. */
  remoteMain(): Promise<string>
  /** The `ci.yml` runs of one commit. */
  ciRuns(commit: string): Promise<CiRun[]>
  /** `CHANGELOG.md`. There is no way to write it: it is the owner's file. */
  changelog(): Promise<string>
  /** The version the root `package.json` has now. */
  currentVersion(): Promise<string>
  tagExists(tag: string): Promise<{ local: boolean; remote: boolean }>
  setVersion(version: string): Promise<void>
  generateNotices(): Promise<void>
  diff(path: string): Promise<string>
  /** Puts tracked files back as they are in HEAD. */
  restore(paths: readonly string[]): Promise<void>
  /** Commits exactly `paths`; returns the new commit. */
  commit(paths: readonly string[], subject: string, body: string): Promise<string>
  tag(tag: string, message: string): Promise<void>
  deleteLocalTag(tag: string): Promise<void>
  /** Pushes `main` and the tag in one atomic push. */
  push(tag: string): Promise<void>
}

export interface ReleasePrepareOptions {
  /** `X.Y.Z`, no `v`. */
  version: string
  /** Make the tag and push (only on the owner's go). */
  tag: boolean
  dryRun: boolean
}

export interface ReleasePrepareResult {
  /** One sentence per thing that stopped it; empty when it did everything it was asked to. */
  failures: string[]
  /** The version commit, if one was made. */
  commit?: string
  tagged: boolean
  pushed: boolean
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

interface StatusEntry {
  path: string
  untracked: boolean
}

/** The files a `git status --porcelain` text names (a rename by its new name). */
function statusEntries(porcelain: string): StatusEntry[] {
  return porcelain
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => {
      const path = line.slice(3)
      const renamed = path.includes(' -> ') ? path.slice(path.indexOf(' -> ') + 4) : path

      return { path: renamed.replace(/^"|"$/g, ''), untracked: line.startsWith('??') }
    })
}

/** Why `CHANGELOG.md` is not ready for `version`, or undefined when it is. Only a `## [version]` heading at the start of a line counts. */
function changelogProblem(text: string, version: string): string | undefined {
  const lines = text.split('\n')
  const heading = new RegExp(`^##[ \\t]+\\[${escapeRegExp(version)}\\](?:[ \\t].*)?$`)
  const start = lines.findIndex((line) => heading.test(line.replace(/\r$/, '')))
  if (start === -1) return `CHANGELOG.md has no entry for ${version} (a "## [${version}]" heading): write it first; this tool never edits that file`
  const next = lines.findIndex((line, index) => index > start && /^##[ \t]/.test(line))
  const body = lines.slice(start + 1, next === -1 ? undefined : next)
  if (body.every((line) => line.trim() === '')) return `The CHANGELOG.md entry for ${version} is empty`

  return undefined
}

export async function releasePrepare(options: ReleasePrepareOptions, host: PrepareHost, log: (line: string) => void, note: (line: string) => void = log): Promise<ReleasePrepareResult> {
  const { version } = options
  if (!RELEASE_VERSION.test(version)) throw new Error(`${JSON.stringify(version).slice(0, 40)} is not a version (like 1.1.1)`)
  const tag = `v${version}`
  const failures: string[] = []
  const fail = (line: string) => failures.push(line.replace(/\s+/g, ' ').trim().slice(0, 500))
  const check = async (what: string, step: () => Promise<void>) => {
    try {
      await step()
    } catch (error) {
      fail(`The check of ${what} failed: ${reason(error)}`)
    }
  }

  // 1. The checks. All of them run, so one run says everything that is wrong; none of them writes.
  await check('the branch', async () => {
    const branch = await host.branch()
    if (branch === 'main') log('You are on main')
    else fail(`Not on main: ${branch === 'HEAD' ? 'HEAD is detached' : `the branch is ${JSON.stringify(branch)}`}`)
  })

  await check('the working tree', async () => {
    const entries = statusEntries(await host.status())
    if (entries.length === 0) log('The working tree is clean')
    else fail(`The working tree has changes: ${entries.slice(0, MAX_LISTED).map((entry) => entry.path).join(', ')}${entries.length > MAX_LISTED ? ` and ${entries.length - MAX_LISTED} more` : ''}`)
  })

  let head: string | undefined
  await check('HEAD', async () => {
    head = await host.headCommit()
    let remote: string
    try {
      remote = await host.remoteMain()
    } catch (error) {
      fail(`origin/main could not be read: ${reason(error)}`)

      return
    }
    if (head === remote) log(`HEAD ${short(head)} is the commit origin/main is at`)
    else fail(`HEAD (${short(head)}) is not the commit origin/main is at (${short(remote)}): push or pull until they are the same`)
  })

  if (head !== undefined) {
    const commit = head
    await check('CI', async () => {
      let runs: CiRun[]
      try {
        runs = await host.ciRuns(commit)
      } catch (error) {
        fail(`The ci.yml runs of ${short(commit)} could not be read: ${reason(error)}`)

        return
      }
      const verdict = ciVerdict(runs, commit)
      if ('run' in verdict) log(`The latest ci.yml run on ${short(commit)} (run ${verdict.run.id}) is green`)
      else fail(verdict.problem)
    })
  }

  await check('CHANGELOG.md', async () => {
    const problem = changelogProblem(await host.changelog(), version)
    if (problem === undefined) log(`CHANGELOG.md has an entry for ${version}`)
    else fail(problem)
  })

  await check('the version', async () => {
    const current = await host.currentVersion()
    if (compareVersions(version, current) <= 0) fail(`${version} is not newer than ${current}, the version the app has now`)
    else log(`${version} is newer than ${current}, the version the app has now`)
    const exists = await host.tagExists(tag)
    if (exists.local) fail(`The tag ${tag} already exists locally`)
    if (exists.remote) fail(`The tag ${tag} already exists on origin`)
    if (!exists.local && !exists.remote) log(`${tag} does not exist yet, here or on origin`)
  })

  if (failures.length > 0) return { failures, tagged: false, pushed: false }

  const plan = `run version:set ${version} (the version files only), run npm run notices (and stop if it changes anything), and commit the version files as "Version ${version}"`
  if (options.dryRun) {
    note(`Dry run: every check passes and nothing was written. A real run would ${plan}${options.tag ? `, then make the annotated tag ${tag} ("Listulator ${version}") and push the commit and the tag together` : '; with --tag it would also make the tag and push'}.`)

    return { failures, tagged: false, pushed: false }
  }

  // 2. The writes. The tree was clean when the checks ran, but that was a while ago: look again right before the first write.
  const changedFiles = async () => statusEntries(await host.status()).filter((entry) => !entry.untracked).map((entry) => entry.path)
  const late = statusEntries(await host.status())
  if (late.length > 0) {
    fail(`The working tree changed while the checks ran: ${late.slice(0, MAX_LISTED).map((entry) => entry.path).join(', ')}${late.length > MAX_LISTED ? ` and ${late.length - MAX_LISTED} more` : ''}`)

    return { failures, tagged: false, pushed: false }
  }

  // After each write only the files it owns may have changed. A failure puts back what THIS tool may have changed and nothing else:
  // a change in any other file can be the owner's own edit (the notices take a while), and `git checkout` would throw it away.
  const ours = [...VERSION_FILES, NOTICES]
  const putBack = async () => {
    let changed: string[]
    try {
      changed = await changedFiles()
    } catch {
      changed = ours // it cannot ask which files changed: put back every file it could have changed
    }
    const paths = changed.filter((path) => ours.includes(path))
    if (paths.length > 0) await host.restore(paths)
  }
  const stop = async (line: string): Promise<ReleasePrepareResult> => {
    fail(line)
    try {
      await putBack()
    } catch (error) {
      fail(`The changed files could not be put back (${reason(error)}): look at git status and run git checkout -- on the files it lists`)
    }

    return { failures, tagged: false, pushed: false }
  }
  const foreignNote = 'The version files were put back; any other changed file was left as it is (it may be your own edit)'

  /** The version commit, or the sentence for what stopped it (the caller then puts the files back). */
  const bump = async (): Promise<{ commit: string; files: number } | string> => {
    note(`Running version:set ${version} ...`)
    try {
      await host.setVersion(version)
    } catch (error) {
      return `version:set failed: ${reason(error)}`
    }
    const afterVersion = await changedFiles()
    if (afterVersion.length === 0) return 'version:set changed nothing: the version is already set, or it did not run'
    const foreign = afterVersion.filter((path) => !VERSION_FILES.has(path))
    if (foreign.length > 0) return `version:set changed a file that is not a version file: ${foreign.join(', ')}. ${foreignNote}`

    note('Running npm run notices (this takes a while) ...')
    try {
      await host.generateNotices()
    } catch (error) {
      return `npm run notices failed: ${reason(error)}`
    }
    const afterNotices = await changedFiles()
    if (afterNotices.includes(NOTICES)) {
      for (const line of (await host.diff(NOTICES)).split('\n').slice(0, MAX_DIFF_LINES)) note(line)

      return `${NOTICES} changed when it was regenerated, so the committed one is out of date (the diff is above): commit the regenerated file on its own, wait for CI, then run this again. What this tool changed was put back`
    }
    const unexpected = afterNotices.filter((path) => !VERSION_FILES.has(path))
    if (unexpected.length > 0) return `npm run notices changed a file that is not a version file: ${unexpected.join(', ')}. ${foreignNote}`

    try {
      return { commit: await host.commit(afterNotices, `Version ${version}`, `npm run version:set -w @listulator/server -- ${version} (${afterNotices.length} files, version lines only).`), files: afterNotices.length }
    } catch (error) {
      return `The commit failed: ${reason(error)}`
    }
  }

  let outcome: { commit: string; files: number } | string
  try {
    outcome = await bump()
  } catch (error) {
    outcome = `Unexpected error while writing: ${reason(error)}`
  }
  if (typeof outcome === 'string') return stop(outcome)
  const { commit } = outcome
  log(`Committed ${short(commit)}: "Version ${version}", ${outcome.files} files, version lines only`)

  // 3. The tag and the push, only on the owner's go.
  if (!options.tag) {
    note(`Not pushed. To publish: git tag -a ${tag} -m "Listulator ${version}" && git push --atomic origin main ${tag}`)

    return { failures, commit, tagged: false, pushed: false }
  }
  try {
    await host.tag(tag, `Listulator ${version}`)
  } catch (error) {
    fail(`The tag ${tag} could not be made: ${reason(error)}. The commit ${short(commit)} is local and was not pushed`)

    return { failures, commit, tagged: false, pushed: false }
  }
  try {
    await host.push(tag)
  } catch (error) {
    // An error does not say the server refused: look at origin before saying that anything is undone.
    const landed = await host.tagExists(tag).then((exists) => exists.remote, () => undefined)
    if (landed === true) {
      fail(`The push reported an error (${reason(error)}), but ${tag} IS on origin: look at GitHub (the commit on main, the Release run) before doing anything else. The local tag was kept`)

      return { failures, commit, tagged: true, pushed: true }
    }
    if (landed === undefined) {
      fail(`The push failed (${reason(error)}) and origin could not be asked whether it arrived: look at GitHub before trying again. The commit ${short(commit)} and the tag ${tag} are local`)

      return { failures, commit, tagged: true, pushed: false }
    }
    const removal = await host.deleteLocalTag(tag).then(() => undefined, (problem: unknown) => reason(problem))
    fail(`The push failed: ${reason(error)}. The commit ${short(commit)} is local and was not pushed, and ${removal === undefined ? 'the local tag was removed again' : `the local tag could not be removed (${removal}): run git tag -d ${tag}`}`)

    return { failures, commit, tagged: false, pushed: false }
  }
  note(`Pushed the commit and ${tag} together. The Release run on GitHub now builds the draft; when it is green: npm run release:audit -- ${tag}, then release:sign.`)

  return { failures, commit, tagged: true, pushed: true }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The real git, gh and npm

/** The real calls, without a shell. `read` reads a text file; the tool has no way to write `CHANGELOG.md`. */
export function createPrepareHost(run: Runner, repoRoot: string, read: (path: string) => string = (path) => readFileSync(path, 'utf8')): PrepareHost {
  const git = (args: string[]) => run('git', args, { cwd: repoRoot })
  const must = (what: string, command: string, args: string[]) => runChecked(run, what, command, args, { cwd: repoRoot })

  return {
    async branch() {
      return (await must('git rev-parse', 'git', ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
    },

    async status() {
      return (await must('git status', 'git', ['status', '--porcelain', '--untracked-files=all'])).stdout
    },

    async headCommit() {
      return (await must('git rev-parse', 'git', ['rev-parse', 'HEAD'])).stdout.trim()
    },

    async remoteMain() {
      const result = await must('git ls-remote', 'git', ['ls-remote', 'origin', 'refs/heads/main'])
      const [commit, ref] = result.stdout.split('\n')[0]?.split('\t') ?? []
      if (commit === undefined || !/^[0-9a-f]{40}$/.test(commit) || ref !== 'refs/heads/main') throw new Error('origin has no refs/heads/main')

      return commit
    },

    async ciRuns(commit) {
      return listCiRuns(run, commit, repoRoot)
    },

    async changelog() {
      return read(join(repoRoot, 'CHANGELOG.md'))
    },

    async currentVersion() {
      return (JSON.parse(read(join(repoRoot, 'package.json'))) as { version: string }).version
    },

    async tagExists(tag) {
      const local = await git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])
      const remote = await must('git ls-remote', 'git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])

      return { local: local.code === 0, remote: remote.stdout.trim() !== '' }
    },

    async setVersion(version) {
      await must('version:set', 'npm', ['run', 'version:set', '-w', '@listulator/server', '--', version])
    },

    async generateNotices() {
      await must('npm run notices', 'npm', ['run', 'notices'])
    },

    async diff(path) {
      return (await must('git diff', 'git', ['diff', '--', path])).stdout
    },

    async restore(paths) {
      if (paths.length > 0) await must('git checkout', 'git', ['checkout', '--', ...paths])
    },

    async commit(paths, subject, body) {
      await must('git add', 'git', ['add', '--', ...paths])
      try {
        // The pathspec makes it commit those files and nothing else, whatever else happens to be staged.
        await must('git commit', 'git', ['commit', '-m', subject, '-m', body, '--', ...paths])
      } catch (error) {
        // A hook may have refused: take the files out of the index again, so putting them back is one checkout.
        await git(['reset', '-q', 'HEAD', '--', ...paths])
        throw error
      }

      return (await must('git rev-parse', 'git', ['rev-parse', 'HEAD'])).stdout.trim()
    },

    async tag(tag, message) {
      await must('git tag', 'git', ['tag', '-a', tag, '-m', message])
    },

    async deleteLocalTag(tag) {
      await must('git tag -d', 'git', ['tag', '-d', tag])
    },

    async push(tag) {
      await must('git push', 'git', ['push', '--atomic', 'origin', 'main', `refs/tags/${tag}`])
    },
  }
}

/** The command line as a value, or a sentence saying what is wrong with it. */
export function parseReleasePrepareArguments(args: readonly string[]): ReleasePrepareOptions | string {
  let version: string | undefined
  let tag = false
  let dryRun = false
  for (const arg of args) {
    if (arg === '--tag') tag = true
    else if (arg === '--dry-run') dryRun = true
    else if (arg.startsWith('-')) return `unknown option ${JSON.stringify(arg).slice(0, 30)} (this tool takes a version, --dry-run and --tag)`
    else if (version !== undefined) return 'only one version can be prepared at a time'
    else version = arg
  }
  if (version === undefined) return 'name the version to prepare (like 1.1.1)'
  if (version.startsWith('v') && RELEASE_VERSION.test(version.slice(1))) return `give the version without the v (${version.slice(1)}): the tag is made from it`
  if (!RELEASE_VERSION.test(version)) return `${JSON.stringify(version).slice(0, 40)} is not a version (like 1.1.1)`

  return { version, tag, dryRun }
}

if (isRunDirectly(import.meta.url)) {
  const parsed = parseReleasePrepareArguments(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(`${parsed}\nUsage: npm run release:prepare -- <version> [--dry-run] [--tag]`)
    process.exit(1)
  }

  try {
    const result = await releasePrepare(parsed, createPrepareHost(nodeRunner, REPO_ROOT), (line) => console.log(`ok    ${line}`), (line) => console.log(line))
    for (const failure of result.failures) console.error(`FAIL  ${failure}`)
    if (result.failures.length > 0) {
      console.error(`Not prepared: ${result.failures.length} problem${result.failures.length === 1 ? '' : 's'}`)
      process.exit(1)
    }
  } catch (error) {
    console.error(reason(error))
    process.exit(1)
  }
}
