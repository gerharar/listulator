import { describe, expect, it } from 'vitest'
import { createPrepareHost, parseReleasePrepareArguments, releasePrepare, type CiRun, type PrepareHost } from './releasePrepare.js'
import type { Runner } from './releaseSign.js'
import { VERSION_SOURCES } from './versionSources.js'

/**
 * `npm run release:prepare -- X.Y.Z [--dry-run] [--tag]` (31.3): everything before the tag of a release that a command can check or do.
 * Tested against a fake host that keeps a working tree in memory (what `git status` would say after each step), so the order of the
 * steps and what each one leaves behind is pinned. The property that matters most: a refusal, and a dry run, change NOTHING.
 */

const VERSION = '1.1.1'
const TAG = `v${VERSION}`
const HEAD = 'a'.repeat(40)
const VERSION_FILES = [...new Set(VERSION_SOURCES.map((source) => source.file))]
const NOTICES = 'THIRD-PARTY-NOTICES.txt'

const CHANGELOG = `# Changelog

## [${VERSION}] - 22 October 2026

- Fixed a thing.

## [1.1.0] - 19 October 2026

- Added stuff.
`

const green = (over: Partial<CiRun> = {}): CiRun => ({ id: 100, status: 'completed', conclusion: 'success', createdAt: '2026-10-21T13:59:51Z', headSha: HEAD, ...over })

interface World {
  branch: string
  /** `git status --porcelain` before anything is done. */
  status: string
  head: string
  remoteMain: string | Error
  ciRuns: CiRun[] | Error
  changelog: string
  currentVersion: string
  localTags: string[]
  remoteTags: string[]
  /** The files `version:set` rewrites. */
  versionChanges: string[]
  /** Whether `npm run notices` rewrites THIRD-PARTY-NOTICES.txt. */
  noticesChange: boolean
  setVersionFails: boolean
  noticesFails: boolean
  tagFails: boolean
  pushFails: boolean
  commitFails: boolean
  restoreFails: boolean
  /** Extra files `npm run notices` rewrites besides the notices. */
  untracked: string[]
}

function world(over: Partial<World> = {}): World {
  return {
    branch: 'main',
    status: '',
    head: HEAD,
    remoteMain: HEAD,
    ciRuns: [green()],
    changelog: CHANGELOG,
    currentVersion: '1.1.0',
    localTags: ['v1.0.2', 'v1.1.0'],
    remoteTags: ['v1.0.2', 'v1.1.0'],
    versionChanges: VERSION_FILES,
    noticesChange: false,
    setVersionFails: false,
    noticesFails: false,
    tagFails: false,
    pushFails: false,
    commitFails: false,
    restoreFails: false,
    untracked: [],
    ...over,
  }
}

interface Fake {
  host: PrepareHost
  calls: string[]
  /** The porcelain lines the tree has now. */
  tree: () => string
}

function fake(w: World): Fake {
  const changed = new Set<string>()
  const calls: string[] = []
  const status = () => [...w.status.split('\n').filter((line) => line !== ''), ...[...changed].map((path) => ` M ${path}`), ...w.untracked.map((path) => `?? ${path}`)].join('\n')
  const host: PrepareHost = {
    branch: async () => w.branch,
    status: async () => status(),
    headCommit: async () => w.head,
    remoteMain: async () => {
      if (w.remoteMain instanceof Error) throw w.remoteMain

      return w.remoteMain
    },
    ciRuns: async () => {
      if (w.ciRuns instanceof Error) throw w.ciRuns

      return w.ciRuns
    },
    changelog: async () => w.changelog,
    currentVersion: async () => w.currentVersion,
    tagExists: async (tag) => ({ local: w.localTags.includes(tag), remote: w.remoteTags.includes(tag) }),
    setVersion: async (version) => {
      calls.push(`setVersion ${version}`)
      if (w.setVersionFails) {
        changed.add(VERSION_FILES[0]!)
        throw new Error('version:set failed halfway')
      }
      for (const path of w.versionChanges) changed.add(path)
    },
    generateNotices: async () => {
      calls.push('notices')
      if (w.noticesFails) throw new Error('licence texts could not be read')
      if (w.noticesChange) changed.add(NOTICES)
    },
    diff: async (path) => `diff --git a/${path} b/${path}\n-old licence\n+new licence`,
    restore: async (paths) => {
      calls.push(`restore ${[...paths].sort().join(',')}`)
      if (w.restoreFails) throw new Error('git checkout failed: index.lock exists')
      for (const path of paths) changed.delete(path)
    },
    commit: async (paths, subject, body) => {
      calls.push(`commit ${[...paths].sort().join(',')} | ${subject} | ${body}`)
      if (w.commitFails) throw new Error('pre-commit hook failed')
      changed.clear()

      return 'c'.repeat(40)
    },
    tag: async (tag, message) => {
      calls.push(`tag ${tag} | ${message}`)
      if (w.tagFails) throw new Error('tag already exists')
    },
    deleteLocalTag: async (tag) => {
      calls.push(`deleteTag ${tag}`)
    },
    push: async (tag) => {
      calls.push(`push ${tag}`)
      if (w.pushFails) throw new Error('remote rejected the push')
    },
  }

  return { host, calls, tree: status }
}

async function prepare(w: World, options: { version?: string; tag?: boolean; dryRun?: boolean } = {}) {
  const f = fake(w)
  const log: string[] = []
  const result = await releasePrepare({ version: options.version ?? VERSION, tag: options.tag ?? false, dryRun: options.dryRun ?? false }, f.host, (line) => log.push(line))

  return { ...f, result, log }
}

describe('a main that is ready for a release', () => {
  it('passes every check in a dry run, says what a real run would do, and writes nothing', async () => {
    const { result, calls, log } = await prepare(world(), { dryRun: true })

    expect(result.failures).toEqual([])
    expect(calls).toEqual([])
    expect(log.join('\n')).toMatch(/Dry run/)
    expect(log.join('\n')).toMatch(/version:set/)
    expect(log.join('\n')).toMatch(/notices/)
    expect(log.join('\n')).toMatch(/Version 1\.1\.1/)
  })

  it('says what each check found', async () => {
    const { log } = await prepare(world(), { dryRun: true })
    const text = log.join('\n')

    expect(text).toMatch(/on main/)
    expect(text).toMatch(/working tree is clean/)
    expect(text).toMatch(/aaaaaaaaaaaa.*origin\/main|origin\/main.*aaaaaaaaaaaa/)
    expect(text).toMatch(/ci\.yml.*run 100.*green|green.*run 100/i)
    expect(text).toMatch(/CHANGELOG\.md has an entry for 1\.1\.1/)
    expect(text).toMatch(/v1\.1\.1 does not exist/)
  })

  it('is a dry run when asked for both --dry-run and --tag: still nothing written', async () => {
    const { calls } = await prepare(world(), { dryRun: true, tag: true })

    expect(calls).toEqual([])
  })
})

describe('what it refuses, and that a refusal changes nothing', () => {
  const refuses = async (w: World, pattern: RegExp) => {
    const { result, calls } = await prepare(w, { tag: true })

    expect(result.failures.some((line) => pattern.test(line))).toBe(true)
    expect(calls).toEqual([])
    expect(result.commit).toBeUndefined()
  }

  it.each([
    ['another branch', 'release-prep'],
    ['a detached HEAD', 'HEAD'],
  ])('refuses %s', async (_name, branch) => {
    await refuses(world({ branch }), /not on main/i)
  })

  it('refuses a modified file, naming it', async () => {
    await refuses(world({ status: ' M web/src/App.tsx' }), /working tree.*web\/src\/App\.tsx/i)
  })

  it('refuses an untracked file (it is part of the tree too)', async () => {
    await refuses(world({ status: '?? notes.txt' }), /working tree.*notes\.txt/i)
  })

  it('refuses a staged change', async () => {
    await refuses(world({ status: 'M  package.json' }), /working tree.*package\.json/i)
  })

  it('names at most five of many changed files and counts the rest', async () => {
    const status = Array.from({ length: 9 }, (_, index) => ` M file${index}.ts`).join('\n')
    const { result } = await prepare(world({ status }))
    const line = result.failures.find((entry) => /working tree/i.test(entry))!

    expect(line).toMatch(/file0\.ts/)
    expect(line).toMatch(/file4\.ts/)
    expect(line).not.toMatch(/file5\.ts/)
    expect(line).toMatch(/and 4 more/)
  })

  it('refuses a HEAD that is not the commit origin/main is at (unpushed or behind), naming both', async () => {
    await refuses(world({ remoteMain: 'b'.repeat(40) }), /aaaaaaaaaaaa.*bbbbbbbbbbbb/)
  })

  it('refuses when origin/main cannot be read', async () => {
    await refuses(world({ remoteMain: new Error('git ls-remote failed') }), /origin\/main.*could not be read.*ls-remote/i)
  })

  it('refuses a commit that no ci.yml run has been made for, and says how to get one', async () => {
    await refuses(world({ ciRuns: [] }), /no ci\.yml run.*aaaaaaaaaaaa/i)
  })

  it.each([
    ['queued', { status: 'queued', conclusion: '' }, /queued/],
    ['in progress', { status: 'in_progress', conclusion: '' }, /in_progress/],
    ['failed', { conclusion: 'failure' }, /failure/],
    ['cancelled', { conclusion: 'cancelled' }, /cancelled/],
    ['timed out', { conclusion: 'timed_out' }, /timed_out/],
  ])('refuses a latest CI run that is %s', async (_name, run, pattern) => {
    await refuses(world({ ciRuns: [green(run)] }), pattern)
  })

  it('judges by the LATEST run: an older green one does not save a newer red one, and an older red one does not matter', async () => {
    const red = await prepare(world({ ciRuns: [green({ id: 1, createdAt: '2026-10-21T10:00:00Z' }), green({ id: 2, createdAt: '2026-10-21T12:00:00Z', conclusion: 'failure' })] }))
    const fixed = await prepare(world({ ciRuns: [green({ id: 1, createdAt: '2026-10-21T10:00:00Z', conclusion: 'failure' }), green({ id: 2, createdAt: '2026-10-21T12:00:00Z' })] }))

    expect(red.result.failures.some((line) => /run 2/.test(line) && /failure/.test(line))).toBe(true)
    expect(fixed.result.failures).toEqual([])
  })

  it('ignores a run of another commit, even if the host hands one over', async () => {
    await refuses(world({ ciRuns: [green({ headSha: 'd'.repeat(40) })] }), /no ci\.yml run/i)
  })

  it('refuses when the CI runs cannot be listed', async () => {
    await refuses(world({ ciRuns: new Error('gh: not logged in') }), /ci\.yml.*could not be read.*not logged in/i)
  })

  it('refuses a CHANGELOG with no entry for the version', async () => {
    await refuses(world({ changelog: CHANGELOG.replace(`## [${VERSION}]`, '## [1.1.2]') }), /CHANGELOG\.md has no entry for 1\.1\.1/)
  })

  it('does not take 1.1.10 for 1.1.1', async () => {
    await refuses(world({ changelog: CHANGELOG.replace(`## [${VERSION}]`, '## [1.1.10]') }), /no entry for 1\.1\.1/)
  })

  it('does not take a mention in the text for a heading', async () => {
    await refuses(world({ changelog: `# Changelog\n\nWatch for [1.1.1] soon.\n\n## [1.1.0] - 19 October 2026\n\n- x\n` }), /no entry for 1\.1\.1/)
  })

  it('refuses an entry with nothing under it', async () => {
    await refuses(world({ changelog: `# Changelog\n\n## [${VERSION}] - 22 October 2026\n\n## [1.1.0] - 19 October 2026\n\n- Added stuff.\n` }), /entry for 1\.1\.1 is empty/i)
  })

  it('accepts the heading with or without a date', async () => {
    const bare = await prepare(world({ changelog: `## [${VERSION}]\n\n- x\n` }), { dryRun: true })

    expect(bare.result.failures).toEqual([])
  })

  it.each([
    ['the version the app has now', '1.1.0'],
    ['an older version', '1.0.9'],
  ])('refuses %s', async (_name, version) => {
    const { result, calls } = await prepare(world({ changelog: CHANGELOG.replace(`## [${VERSION}]`, `## [${version}]`) }), { version, tag: true })

    expect(result.failures.some((line) => /not newer than 1\.1\.0/.test(line))).toBe(true)
    expect(calls).toEqual([])
  })

  it.each([
    ['locally', { localTags: ['v1.1.0', TAG] }, /already exists locally/],
    ['on origin', { remoteTags: ['v1.1.0', TAG] }, /already exists on origin/],
  ])('refuses a tag that exists %s', async (_name, over, pattern) => {
    await refuses(world(over), pattern)
  })

  it('says every refusal at once, not only the first', async () => {
    const { result } = await prepare(world({ branch: 'x', status: ' M a.ts', ciRuns: [], changelog: '' }))

    expect(result.failures.length).toBeGreaterThanOrEqual(4)
    expect(result.failures.every((line) => !line.includes('\n'))).toBe(true)
  })

  it('refuses a version that is not a version', async () => {
    await expect(prepare(world(), { version: '1.1' })).rejects.toThrow(/not a version/i)
  })
})

describe('a real run', () => {
  it('sets the version, regenerates the notices, commits only the version files, and stops there without --tag', async () => {
    const { result, calls, log } = await prepare(world())

    expect(result.failures).toEqual([])
    expect(calls).toEqual([`setVersion ${VERSION}`, 'notices', `commit ${[...VERSION_FILES].sort().join(',')} | Version ${VERSION} | npm run version:set -w @listulator/server -- ${VERSION} (${VERSION_FILES.length} files, version lines only).`])
    expect(result).toMatchObject({ commit: 'c'.repeat(40), tagged: false, pushed: false })
    expect(log.join('\n')).toMatch(/not pushed/i)
    expect(log.join('\n')).toContain(`git tag -a ${TAG} -m "Listulator ${VERSION}" && git push --atomic origin main ${TAG}`)
  })

  it('with --tag also tags the commit (annotated, "Listulator X.Y.Z") and pushes commit and tag together', async () => {
    const { result, calls, log } = await prepare(world(), { tag: true })

    expect(result.failures).toEqual([])
    expect(calls.slice(-2)).toEqual([`tag ${TAG} | Listulator ${VERSION}`, `push ${TAG}`])
    expect(result).toMatchObject({ tagged: true, pushed: true })
    expect(log.join('\n')).toMatch(/Release.*run|release:audit/i)
  })

  it('stops when the notices change, shows the diff, and puts every file back as it was', async () => {
    const { result, calls, log } = await prepare(world({ noticesChange: true }), { tag: true })

    expect(result.failures.some((line) => /THIRD-PARTY-NOTICES\.txt changed/.test(line))).toBe(true)
    expect(log.join('\n')).toMatch(/-old licence/)
    expect(log.join('\n')).toMatch(/\+new licence/)
    expect(calls.at(-1)).toBe(`restore ${[...VERSION_FILES, NOTICES].sort().join(',')}`)
    expect(calls.some((call) => call.startsWith('commit'))).toBe(false)
    expect(result.commit).toBeUndefined()
  })

  it('stops and restores when version:set changes a file that is not one of the version files', async () => {
    const { result, calls } = await prepare(world({ versionChanges: [...VERSION_FILES, 'package-lock.json.orig', 'web/src/App.tsx'] }), { tag: true })

    // It stops right after version:set, blaming version:set, before the notices tool runs on a tree that is already wrong.
    expect(result.failures).toEqual([expect.stringMatching(/^version:set changed a file that is not a version file: .*web\/src\/App\.tsx/)])
    expect(calls).toEqual([`setVersion ${VERSION}`, expect.stringMatching(/^restore /)])
    expect(calls.some((call) => call.startsWith('commit') || call.startsWith('tag'))).toBe(false)
  })

  it('stops when version:set changes nothing', async () => {
    const { result, calls } = await prepare(world({ versionChanges: [] }), { tag: true })

    expect(result.failures.some((line) => /version:set changed nothing/.test(line))).toBe(true)
    expect(calls.some((call) => call.startsWith('commit'))).toBe(false)
  })

  it('restores what a failed version:set left behind, and says it failed', async () => {
    const { result, calls } = await prepare(world({ setVersionFails: true }), { tag: true })

    expect(result.failures.some((line) => /version:set.*failed halfway/.test(line))).toBe(true)
    expect(calls.at(-1)).toBe(`restore ${VERSION_FILES[0]}`)
  })

  it('restores when the notices tool fails', async () => {
    const { result, calls } = await prepare(world({ noticesFails: true }), { tag: true })

    expect(result.failures.some((line) => /notices.*licence texts could not be read/.test(line))).toBe(true)
    expect(calls.at(-1)).toBe(`restore ${[...VERSION_FILES].sort().join(',')}`)
    expect(calls.some((call) => call.startsWith('commit'))).toBe(false)
  })

  it('stops when a new untracked file appears, and does not delete it', async () => {
    const { result, calls } = await prepare(world({ untracked: ['licences.tmp'] }), { tag: true })

    // The untracked file is there before the run starts, so the tree is not clean: refused before anything is written.
    expect(result.failures.some((line) => /licences\.tmp/.test(line))).toBe(true)
    expect(calls).toEqual([])
  })

  it('when the commit is refused (a hook), puts the files back and tags and pushes nothing', async () => {
    const { result, calls } = await prepare(world({ commitFails: true }), { tag: true })

    expect(result.failures.some((line) => /commit failed.*pre-commit hook failed/.test(line))).toBe(true)
    expect(calls.at(-1)).toBe(`restore ${[...VERSION_FILES].sort().join(',')}`)
    expect(calls.some((call) => call.startsWith('tag') || call.startsWith('push'))).toBe(false)
    expect(result.commit).toBeUndefined()
  })

  it('when putting the files back fails too, keeps BOTH reasons and says how to do it by hand', async () => {
    const { result } = await prepare(world({ noticesChange: true, restoreFails: true }), { tag: true })

    expect(result.failures.some((line) => /THIRD-PARTY-NOTICES\.txt changed/.test(line))).toBe(true)
    expect(result.failures.some((line) => /could not be put back.*index\.lock/.test(line) && /git checkout --/.test(line))).toBe(true)
  })

  it('when the push fails: takes the local tag away again, keeps the commit, and says how things stand', async () => {
    const { result, calls } = await prepare(world({ pushFails: true }), { tag: true })

    expect(result.failures.some((line) => /push.*remote rejected the push/.test(line))).toBe(true)
    expect(result.failures.some((line) => /cccccccccccc/.test(line) && /local/i.test(line))).toBe(true)
    expect(calls.slice(-3)).toEqual([`tag ${TAG} | Listulator ${VERSION}`, `push ${TAG}`, `deleteTag ${TAG}`])
    expect(result).toMatchObject({ commit: 'c'.repeat(40), tagged: false, pushed: false })
  })

  it('when the tag cannot be made: does not push', async () => {
    const { result, calls } = await prepare(world({ tagFails: true }), { tag: true })

    expect(result.failures.some((line) => /tag already exists/.test(line))).toBe(true)
    expect(calls.some((call) => call.startsWith('push'))).toBe(false)
  })
})

describe('the command line', () => {
  it('takes a version, and --dry-run and --tag in any order', () => {
    expect(parseReleasePrepareArguments(['1.1.1'])).toEqual({ version: '1.1.1', tag: false, dryRun: false })
    expect(parseReleasePrepareArguments(['--tag', '1.1.1'])).toEqual({ version: '1.1.1', tag: true, dryRun: false })
    expect(parseReleasePrepareArguments(['1.1.1', '--dry-run', '--tag'])).toEqual({ version: '1.1.1', tag: true, dryRun: true })
  })

  it('says to leave the v off, since the tag is made from the version', () => {
    expect(parseReleasePrepareArguments(['v1.1.1'])).toMatch(/without the v/i)
  })

  it.each([
    ['no version', []],
    ['only flags', ['--tag']],
    ['a word', ['latest']],
    ['two versions', ['1.1.1', '1.1.2']],
    ['an unknown option', ['1.1.1', '--force']],
    ['a path-like version', ['1.1.1/../x']],
  ])('refuses %s, in words', (_name, args) => {
    expect(typeof parseReleasePrepareArguments(args)).toBe('string')
  })
})

describe('the real git, gh and npm commands, as they are run (no shell)', () => {
  interface Call {
    command: string
    args: string[]
  }

  function recorder(answer: (call: Call) => { code: number; stdout?: string; stderr?: string } = () => ({ code: 0 })) {
    const calls: Call[] = []
    const runner: Runner = async (command, args) => {
      const call = { command, args }
      calls.push(call)
      const { code, stdout = '', stderr = '' } = answer(call)

      return { code, stdout, stderr }
    }

    return { calls, runner }
  }
  const files: Record<string, string> = { '/repo/CHANGELOG.md': CHANGELOG, '/repo/package.json': '{"name":"listulator","version":"1.1.0"}' }
  const host = (runner: Runner) => createPrepareHost(runner, '/repo', (path) => files[path]!)

  it('reads the branch, and says HEAD when detached', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: 'main\n' }))

    expect(await host(runner).branch()).toBe('main')
    expect(calls[0]).toEqual({ command: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'] })
  })

  it('reads the status with untracked files named one by one', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: ' M a.ts\n?? b/c.ts\n' }))

    expect(await host(runner).status()).toBe(' M a.ts\n?? b/c.ts\n')
    expect(calls[0]!.args).toEqual(['status', '--porcelain', '--untracked-files=all'])
  })

  it('reads origin/main from the remote itself (ls-remote), not from a fetched copy', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: `${HEAD}\trefs/heads/main\n` }))

    expect(await host(runner).remoteMain()).toBe(HEAD)
    expect(calls[0]!.args).toEqual(['ls-remote', 'origin', 'refs/heads/main'])
    await expect(host(recorder(() => ({ code: 0, stdout: '' })).runner).remoteMain()).rejects.toThrow(/refs\/heads\/main/)
    await expect(host(recorder(() => ({ code: 128, stderr: 'fatal: could not read' })).runner).remoteMain()).rejects.toThrow(/could not read/)
  })

  it('lists the ci.yml runs of one commit, as numbers', async () => {
    const answer = JSON.stringify([{ databaseId: 7, status: 'completed', conclusion: 'success', createdAt: '2026-10-21T13:59:51Z', headSha: HEAD }])
    const { calls, runner } = recorder(() => ({ code: 0, stdout: answer }))

    expect(await host(runner).ciRuns(HEAD)).toEqual([{ id: 7, status: 'completed', conclusion: 'success', createdAt: '2026-10-21T13:59:51Z', headSha: HEAD }])
    expect(calls[0]).toEqual({ command: 'gh', args: ['run', 'list', '--repo', 'gerharar/listulator', '--workflow', 'ci.yml', '--commit', HEAD, '--json', 'databaseId,status,conclusion,createdAt,headSha', '--limit', '20'] })
  })

  it('says so when gh cannot list the runs', async () => {
    await expect(host(recorder(() => ({ code: 1, stderr: 'gh: not logged in' })).runner).ciRuns(HEAD)).rejects.toThrow(/not logged in/)
  })

  it('reads CHANGELOG.md and the current version from the files, and never writes either', async () => {
    const { runner } = recorder()
    const h = host(runner)

    expect(await h.changelog()).toBe(CHANGELOG)
    expect(await h.currentVersion()).toBe('1.1.0')
    expect(Object.keys(h)).not.toContain('writeChangelog')
  })

  it('asks whether a tag exists here (rev-parse) and on origin (ls-remote)', async () => {
    const { calls, runner } = recorder((call) => (call.args[0] === 'ls-remote' ? { code: 0, stdout: `${HEAD}\trefs/tags/${TAG}\n` } : { code: 1 }))

    expect(await host(runner).tagExists(TAG)).toEqual({ local: false, remote: true })
    expect(calls.map((call) => call.args)).toEqual([['rev-parse', '--verify', '--quiet', `refs/tags/${TAG}`], ['ls-remote', '--tags', 'origin', `refs/tags/${TAG}`]])
  })

  it('runs version:set and the notices through npm, naming the workspace', async () => {
    const { calls, runner } = recorder()

    await host(runner).setVersion(VERSION)
    await host(runner).generateNotices()

    expect(calls[0]).toEqual({ command: 'npm', args: ['run', 'version:set', '-w', '@listulator/server', '--', VERSION] })
    expect(calls[1]).toEqual({ command: 'npm', args: ['run', 'notices'] })
  })

  it('says what a failed npm step printed', async () => {
    await expect(host(recorder(() => ({ code: 1, stderr: 'ENOENT: no licence file' })).runner).generateNotices()).rejects.toThrow(/ENOENT/)
  })

  it('shows a file’s diff and puts files back with checkout', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: 'a diff' }))

    expect(await host(runner).diff(NOTICES)).toBe('a diff')
    await host(runner).restore(['a.json', 'b.toml'])

    expect(calls[0]!.args).toEqual(['diff', '--', NOTICES])
    expect(calls[1]!.args).toEqual(['checkout', '--', 'a.json', 'b.toml'])
  })

  it('commits by adding the named files only, with a subject and a body, and never skips the hooks', async () => {
    const { calls, runner } = recorder((call) => (call.args[0] === 'rev-parse' ? { code: 0, stdout: `${'c'.repeat(40)}\n` } : { code: 0 }))

    const sha = await host(runner).commit(['a.json', 'b.toml'], 'Version 1.1.1', 'the body')

    expect(sha).toBe('c'.repeat(40))
    expect(calls.map((call) => call.args)).toEqual([['add', '--', 'a.json', 'b.toml'], ['commit', '-m', 'Version 1.1.1', '-m', 'the body'], ['rev-parse', 'HEAD']])
    expect(calls.flatMap((call) => call.args)).not.toContain('--no-verify')
    expect(calls.flatMap((call) => call.args)).not.toContain('-a')
  })

  it('takes the files out of the index again when the commit is refused, and says why', async () => {
    const { calls, runner } = recorder((call) => (call.args[0] === 'commit' ? { code: 1, stderr: 'hook: lint failed' } : { code: 0 }))

    await expect(host(runner).commit(['a.json'], 'Version 1.1.1', 'body')).rejects.toThrow(/lint failed/)

    expect(calls.map((call) => call.args)).toEqual([['add', '--', 'a.json'], ['commit', '-m', 'Version 1.1.1', '-m', 'body'], ['reset', '-q', 'HEAD', '--', 'a.json']])
  })

  it('makes an annotated tag, deletes a local tag, and pushes the commit and the tag atomically', async () => {
    const { calls, runner } = recorder()

    await host(runner).tag(TAG, `Listulator ${VERSION}`)
    await host(runner).deleteLocalTag(TAG)
    await host(runner).push(TAG)

    expect(calls.map((call) => call.args)).toEqual([['tag', '-a', TAG, '-m', `Listulator ${VERSION}`], ['tag', '-d', TAG], ['push', '--atomic', 'origin', 'main', `refs/tags/${TAG}`]])
    expect(calls.flatMap((call) => call.args)).not.toContain('--no-verify')
    expect(calls.flatMap((call) => call.args)).not.toContain('--force')
  })

  it('says what a failed git command printed', async () => {
    await expect(host(recorder(() => ({ code: 1, stderr: 'remote: rejected' })).runner).push(TAG)).rejects.toThrow(/rejected/)
  })
})
