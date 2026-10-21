import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CiRun } from './ciCheck.js'
import { TOOLS_PATHS, createShipHost, parseReleaseShipArguments, releaseShip, type ShipHost, type ShipIo } from './releaseShip.js'
import type { Runner } from './releaseSign.js'

/**
 * `npm run release:ship -- <tag>` (31.5): the whole signing of a draft in one command. Tested against a fake host and a fake terminal.
 * What these tests hold on to, above all (rule S5): the updater passphrase is asked for ONCE, goes into the environment of ONE
 * process (the real signing), and appears nowhere else: not in an argument, not in the dry run, not in a log line, a note, a failure
 * or an error message, even when a program deliberately echoes it. And every stop leaves the owner's working copy alone and removes the
 * temporary worktree.
 */

const TAG = 'v1.1.1'
const VERSION = '1.1.1'
const PREVIOUS = 'v1.1.0'
const COMMIT = 'a'.repeat(40)
const SECRET = 'Sh1p-Sentinel-Passphrase-77123'
const BASE = '/tmp/ship-base'
const WORK = `${BASE}/work`
const KEY = '/keys/updater.key'
const REPO = '/repo'
const EXE = `Listulator_${VERSION}_x64-setup.exe`
const DMG = `Listulator_${VERSION}_aarch64.dmg`
const TAR = 'Listulator.app.tar.gz'
const SIGNED_DRAFT = [EXE, DMG, TAR, 'SHA256SUMS', `${EXE}.sig`, `${TAR}.sig`, 'latest.json']
const DIFF = 'diff --git a/server/src/tools/x.ts b/server/src/tools/x.ts\n-old\n+new\n'
const HASH = createHash('sha256').update(DIFF).digest('hex').slice(0, 16)

const green = (over: Partial<CiRun> = {}): CiRun => ({ id: 9, status: 'completed', conclusion: 'success', createdAt: '2026-10-22T10:00:00Z', headSha: COMMIT, ...over })

interface World {
  fetchFails: boolean
  remoteTag: string | undefined
  ci: CiRun[]
  diff: string
  localTags: string[]
  addFails: boolean
  installFails: boolean
  dry: { code: number; output: string }
  sign: { code: number; output: string }
  assets: string[]
  isDraft: boolean
  publishFails: boolean
  /** Exit codes of the successive `release:verify` runs. */
  verify: number[]
  removeFails: boolean
  keyProblem: string | undefined
  /** What the owner types at the passphrase prompt, or an error. */
  passphrase: string | Error
  publishAnswer: string
  keyAnswer: string
  /** Every program that sees the passphrase echoes it into its output and its error messages. */
  hostile: boolean
}

const world = (over: Partial<World> = {}): World => ({
  fetchFails: false,
  remoteTag: COMMIT,
  ci: [green()],
  diff: DIFF,
  localTags: ['v1.0.2', PREVIOUS, TAG],
  addFails: false,
  installFails: false,
  dry: { code: 0, output: 'Dry run: everything checks out.' },
  sign: { code: 0, output: 'Uploaded the signatures.' },
  assets: SIGNED_DRAFT,
  isDraft: true,
  publishFails: false,
  verify: [0],
  removeFails: false,
  keyProblem: undefined,
  passphrase: SECRET,
  publishAnswer: 'y',
  keyAnswer: KEY,
  hostile: false,
  ...over,
})

interface Call {
  name: string
  args: unknown[]
}

interface Fake {
  host: ShipHost
  io: ShipIo
  calls: Call[]
  names: () => string[]
  scripts: { script: string; args: string[]; passphrase: string | undefined }[]
  asked: { key: number; passphrase: number; publish: number }
  slept: number[]
}

function fake(w: World): Fake {
  const calls: Call[] = []
  const scripts: Fake['scripts'] = []
  const asked = { key: 0, passphrase: 0, publish: 0 }
  const slept: number[] = []
  let seen: string | undefined
  let verifyRuns = 0
  const rec = (name: string, ...args: unknown[]) => calls.push({ name, args })
  // A hostile program that has been handed the passphrase repeats it wherever it can.
  const echo = (text: string) => (w.hostile && seen !== undefined ? `${text} [${seen}]` : text)

  const host: ShipHost = {
    fetchTags: async () => {
      rec('fetchTags')
      if (w.fetchFails) throw new Error('git fetch failed: could not resolve host')
    },
    tagCommit: async (tag) => {
      rec('tagCommit', tag)

      return COMMIT
    },
    remoteTagCommit: async (tag) => {
      rec('remoteTagCommit', tag)

      return w.remoteTag
    },
    localTags: async () => w.localTags,
    ciRuns: async (commit) => {
      rec('ciRuns', commit)

      return w.ci
    },
    toolsDiff: async (from, to) => {
      rec('toolsDiff', from, to)

      return w.diff
    },
    makeTempDir: async () => {
      rec('makeTempDir')

      return BASE
    },
    removeTempDir: async (dir) => {
      rec('removeTempDir', dir)
    },
    addWorktree: async (dir, tag) => {
      rec('addWorktree', dir, tag)
      if (w.addFails) throw new Error('git worktree add failed: invalid reference')
    },
    removeWorktree: async (dir) => {
      rec('removeWorktree', dir)
      if (w.removeFails) throw new Error(echo('git worktree remove failed: directory is busy'))
    },
    install: async (dir) => {
      rec('install', dir)
      if (w.installFails) throw new Error('npm ci failed: ERESOLVE')
    },
    runScript: async (dir, script, args, passphrase) => {
      scripts.push({ script, args, passphrase })
      rec('runScript', dir, script, args)
      if (passphrase !== undefined) seen = passphrase
      if (script === 'release:verify') return { code: w.verify[Math.min(verifyRuns++, w.verify.length - 1)]!, output: echo('ok    verified') }
      if (args.includes('--dry-run')) return { ...w.dry, output: echo(w.dry.output) }

      return { ...w.sign, output: echo(w.sign.output) }
    },
    releaseAssets: async (tag) => {
      rec('releaseAssets', tag)

      return { isDraft: w.isDraft, assets: w.assets }
    },
    publish: async (tag) => {
      rec('publish', tag)
      if (w.publishFails) throw new Error(echo('gh release edit failed: HTTP 502'))
    },
    keyFileProblem: async (path) => {
      rec('keyFileProblem', path)

      return w.keyProblem
    },
  }
  const io: ShipIo = {
    askKeyFile: async () => {
      asked.key++

      return w.keyAnswer
    },
    askPassphrase: async () => {
      asked.passphrase++
      if (w.passphrase instanceof Error) throw w.passphrase

      return w.passphrase
    },
    askPublish: async () => {
      asked.publish++

      return w.publishAnswer
    },
  }

  return { host, io, calls, names: () => calls.map((call) => call.name), scripts, asked, slept }
}

interface RunOptions {
  tag?: string
  keyFile?: string
  toolsDiffReviewed?: string | undefined
  dryRun?: boolean
}

async function ship(w: World, options: RunOptions = {}) {
  const f = fake(w)
  const log: string[] = []
  const notes: string[] = []
  const reviewed = 'toolsDiffReviewed' in options ? options.toolsDiffReviewed : HASH
  const result = await releaseShip(
    { tag: options.tag ?? TAG, keyFile: options.keyFile, toolsDiffReviewed: reviewed, dryRun: options.dryRun ?? false, repoRoot: REPO, pause: async (ms) => void f.slept.push(ms) },
    f.host,
    f.io,
    (line) => log.push(line),
    (line) => notes.push(line),
  )

  return { ...f, result, log, notes }
}

const everything = (r: { result: { failures: string[] }; log: string[]; notes: string[] }) => [...r.result.failures, ...r.log, ...r.notes].join('\n')

describe('a release that is ready to ship', () => {
  it('signs and publishes it, and says so', async () => {
    const r = await ship(world(), { keyFile: KEY })

    expect(r.result).toEqual({ failures: [], signed: true, published: true, verified: true })
  })

  it('does its steps in the order the routine has them, and leaves no worktree behind', async () => {
    const r = await ship(world(), { keyFile: KEY })

    expect(r.names()).toEqual([
      'fetchTags', 'tagCommit', 'remoteTagCommit', 'ciRuns', 'toolsDiff',
      'makeTempDir', 'addWorktree', 'install', 'runScript', // the dry run
      'keyFileProblem', 'runScript', // the signing
      'releaseAssets', 'publish', 'runScript', // the public check
      'removeWorktree', 'removeTempDir',
    ])
  })

  it('works in a worktree at the tag, never in the owner’s working copy', async () => {
    const r = await ship(world(), { keyFile: KEY })

    expect(r.calls.find((call) => call.name === 'addWorktree')!.args).toEqual([WORK, TAG])
    expect(r.calls.find((call) => call.name === 'install')!.args).toEqual([WORK])
    expect(r.calls.filter((call) => call.name === 'runScript').every((call) => call.args[0] === WORK)).toBe(true)
  })

  it('runs the dry run first with no passphrase, then the real signing with the key FILE’s path', async () => {
    const r = await ship(world(), { keyFile: KEY })

    expect(r.scripts[0]).toEqual({ script: 'release:sign', args: [TAG, '--dry-run'], passphrase: undefined })
    expect(r.scripts[1]).toEqual({ script: 'release:sign', args: [TAG, '--key-file', KEY], passphrase: SECRET })
  })

  it('asks for the passphrase ONCE, after the dry run has passed, and hands it to ONE process only', async () => {
    const r = await ship(world(), { keyFile: KEY })

    expect(r.asked.passphrase).toBe(1)
    expect(r.scripts.filter((entry) => entry.passphrase !== undefined)).toHaveLength(1)
    expect(r.scripts.findIndex((entry) => entry.passphrase !== undefined)).toBe(1)
  })

  it('never puts the passphrase in an argument, a call, a log line or a note', async () => {
    const r = await ship(world(), { keyFile: KEY })

    expect(JSON.stringify(r.calls)).not.toContain(SECRET)
    expect(JSON.stringify(r.scripts.map((entry) => entry.args))).not.toContain(SECRET)
    expect(everything(r)).not.toContain(SECRET)
    expect(Object.values(process.env).join('\n')).not.toContain(SECRET)
  })

  it('asks for the key file’s path when it was not given, and does not read the file: it only asks the host whether it is a usable file', async () => {
    const r = await ship(world({ keyAnswer: '/keys/other.key' }))

    expect(r.asked.key).toBe(1)
    expect(r.calls.find((call) => call.name === 'keyFileProblem')!.args).toEqual(['/keys/other.key'])
    expect(r.scripts[1]!.args).toEqual([TAG, '--key-file', '/keys/other.key'])
  })

  it('does not ask for the path when it was given', async () => {
    const r = await ship(world(), { keyFile: KEY })

    expect(r.asked.key).toBe(0)
  })

  it('checks the public files after publishing: the tagged release:verify, with no passphrase', async () => {
    const r = await ship(world(), { keyFile: KEY })

    expect(r.scripts.at(-1)).toEqual({ script: 'release:verify', args: [TAG], passphrase: undefined })
  })
})

describe('what it checks before it touches anything', () => {
  const refusesBeforeTheWorktree = async (w: World, pattern: RegExp, options: RunOptions = { keyFile: KEY }) => {
    const r = await ship(w, options)

    expect(r.result.failures.some((line) => pattern.test(line))).toBe(true)
    expect(r.result).toMatchObject({ signed: false, published: false })
    expect(r.names()).not.toContain('makeTempDir')
    expect(r.names()).not.toContain('addWorktree')
    expect(r.asked).toEqual({ key: 0, passphrase: 0, publish: 0 })
  }

  it('refuses a tag that is no version tag', async () => {
    await expect(ship(world(), { tag: 'main', keyFile: KEY })).rejects.toThrow(/not v \+ a version/)
  })

  it('refuses when the tags cannot be fetched', async () => {
    await refusesBeforeTheWorktree(world({ fetchFails: true }), /fetch.*could not resolve host/i)
  })

  it('refuses a tag that is not on origin', async () => {
    await refusesBeforeTheWorktree(world({ remoteTag: undefined }), /v1\.1\.1 is not on origin/)
  })

  it('refuses a tag that points elsewhere here than on origin (a stale or moved tag), naming both commits', async () => {
    await refusesBeforeTheWorktree(world({ remoteTag: 'b'.repeat(40) }), /aaaaaaaaaaaa here but at bbbbbbbbbbbb on origin/)
  })

  it.each([
    ['no run', [], /No ci\.yml run/],
    ['a run still going', [green({ status: 'in_progress', conclusion: '' })], /in_progress/],
    ['a red run', [green({ conclusion: 'failure' })], /failure/],
  ])('refuses a tagged commit whose CI is %s', async (_name, ci, pattern) => {
    await refusesBeforeTheWorktree(world({ ci }), pattern)
  })

  it('stops at the tools diff, showing it with its hash, unless the owner named that hash', async () => {
    const r = await ship(world(), { keyFile: KEY, toolsDiffReviewed: undefined })

    expect(r.result.failures).toEqual([expect.stringMatching(new RegExp(`tools that see the key changed since ${PREVIOUS}.*--tools-diff-reviewed ${HASH}`))])
    expect(r.notes.join('\n')).toContain('+new')
    expect(r.notes.join('\n')).toContain(HASH)
    expect(r.names()).not.toContain('makeTempDir')
    expect(r.asked).toEqual({ key: 0, passphrase: 0, publish: 0 })
  })

  it('stops when the hash named is not this diff’s, and says what this diff’s hash is', async () => {
    const r = await ship(world(), { keyFile: KEY, toolsDiffReviewed: '0'.repeat(16) })

    expect(r.result.failures[0]).toMatch(new RegExp(`not this diff's hash \\(${HASH}\\)`))
    expect(r.names()).not.toContain('makeTempDir')
  })

  it('compares the tools between the two tags it names, from the previous release by version', async () => {
    const r = await ship(world({ localTags: ['v1.0.2', 'v1.1.0', 'v1.1.0-rc.1', TAG, 'v1.1.2'] }), { keyFile: KEY })

    expect(r.calls.find((call) => call.name === 'toolsDiff')!.args).toEqual([PREVIOUS, TAG])
  })

  it('goes on without a flag when the tools did not change, and says so', async () => {
    const r = await ship(world({ diff: '' }), { keyFile: KEY, toolsDiffReviewed: undefined })

    expect(r.result.failures).toEqual([])
    expect(r.log.join('\n')).toMatch(/unchanged since v1\.1\.0/)
  })

  it('has no tools diff for the first release, and says so', async () => {
    const r = await ship(world({ localTags: [TAG] }), { keyFile: KEY, toolsDiffReviewed: undefined })

    expect(r.result.failures).toEqual([])
    expect(r.notes.join('\n')).toMatch(/No earlier release/)
    expect(r.names()).not.toContain('toolsDiff')
  })

  it('says every problem of the first group at once', async () => {
    const r = await ship(world({ remoteTag: undefined, ci: [] }), { keyFile: KEY })

    expect(r.result.failures.length).toBeGreaterThanOrEqual(2)
  })
})

describe('the dry run and the key', () => {
  it('stops at the dry run with --dry-run: no key, no passphrase, no signing, no publishing', async () => {
    const r = await ship(world(), { keyFile: KEY, dryRun: true })

    expect(r.result).toEqual({ failures: [], signed: false, published: false, verified: false })
    expect(r.asked).toEqual({ key: 0, passphrase: 0, publish: 0 })
    expect(r.scripts).toHaveLength(1)
    expect(r.notes.join('\n')).toMatch(/Dry run/)
    expect(r.names().slice(-2)).toEqual(['removeWorktree', 'removeTempDir'])
  })

  it('stops when the tagged release:sign refuses in its dry run, showing what it said, and asks for nothing', async () => {
    const r = await ship(world({ dry: { code: 1, output: 'The release v1.1.1 is not a draft' } }), { keyFile: KEY })

    expect(r.result.failures).toEqual([expect.stringMatching(/dry-run refused.*nothing was signed/)])
    expect(r.notes.join('\n')).toContain('is not a draft')
    expect(r.asked).toEqual({ key: 0, passphrase: 0, publish: 0 })
    expect(r.scripts).toHaveLength(1)
  })

  it('refuses a key file inside the owner’s repository, or inside the worktree, before asking for the passphrase', async () => {
    const inRepo = await ship(world(), { keyFile: `${REPO}/keys/updater.key` })
    const inWork = await ship(world(), { keyFile: `${WORK}/updater.key` })

    for (const r of [inRepo, inWork]) {
      expect(r.result.failures).toEqual([expect.stringMatching(/inside the repository/)])
      expect(r.asked.passphrase).toBe(0)
    }
  })

  it('refuses a key file that is not a usable file, in the host’s words', async () => {
    const r = await ship(world({ keyProblem: 'The key file /keys/updater.key is not a file' }), { keyFile: KEY })

    expect(r.result.failures).toEqual(['The key file /keys/updater.key is not a file'])
    expect(r.asked.passphrase).toBe(0)
  })

  it('refuses an empty passphrase, signs nothing, and does not hand an empty one to anything', async () => {
    const r = await ship(world({ passphrase: '' }), { keyFile: KEY })

    expect(r.result.failures).toEqual([expect.stringMatching(/empty/)])
    expect(r.scripts).toHaveLength(1)
  })

  it('stops when the owner cancels the passphrase prompt, with nothing signed', async () => {
    const r = await ship(world({ passphrase: new Error('Interrupted: no passphrase was read') }), { keyFile: KEY })

    expect(r.result.failures).toEqual([expect.stringMatching(/Interrupted/)])
    expect(r.scripts).toHaveLength(1)
    expect(r.result.signed).toBe(false)
  })
})

describe('signing and what comes after', () => {
  it('stops when the real signing fails, shows what it said, and offers nothing', async () => {
    const r = await ship(world({ sign: { code: 1, output: 'incorrect updater private key password' } }), { keyFile: KEY })

    expect(r.result.failures).toEqual([expect.stringMatching(/release:sign failed.*the draft is as it was/)])
    expect(r.notes.join('\n')).toContain('incorrect updater private key password')
    expect(r.names()).not.toContain('releaseAssets')
    expect(r.asked.publish).toBe(0)
    expect(r.result.signed).toBe(false)
  })

  it.each([
    ['a signature missing', SIGNED_DRAFT.filter((name) => name !== `${TAR}.sig`)],
    ['a file nobody expected', [...SIGNED_DRAFT, 'secrets.zip']],
    ['only what the workflow made', [EXE, DMG, TAR, 'SHA256SUMS']],
  ])('does not offer to publish when the draft holds %s', async (_name, assets) => {
    const r = await ship(world({ assets }), { keyFile: KEY })

    expect(r.result.failures).toEqual([expect.stringMatching(/does not hold exactly/)])
    expect(r.result).toMatchObject({ signed: true, published: false })
    expect(r.asked.publish).toBe(0)
  })

  it('does not offer to publish a release that is not a draft any more', async () => {
    const r = await ship(world({ isDraft: false }), { keyFile: KEY })

    expect(r.result.failures).toEqual([expect.stringMatching(/not a draft/)])
    expect(r.asked.publish).toBe(0)
  })

  it.each([['n'], ['N'], [''], ['no'], ['yep'], [' '], ['yes please']])('publishes NOTHING when the answer is %j, and says how to do it by hand', async (answer) => {
    const r = await ship(world({ publishAnswer: answer }), { keyFile: KEY })

    expect(r.names()).not.toContain('publish')
    expect(r.result).toEqual({ failures: [], signed: true, published: false, verified: false })
    expect(r.notes.join('\n')).toMatch(/Not published/)
    expect(r.notes.join('\n')).toContain(`gh release edit ${TAG} --repo gerharar/listulator --draft=false`)
    expect(r.notes.join('\n')).toContain(`npm run release:verify -- ${TAG}`)
  })

  it.each([['y'], ['Y'], ['yes'], ['YES'], [' y ']])('publishes on %j', async (answer) => {
    const r = await ship(world({ publishAnswer: answer }), { keyFile: KEY })

    expect(r.names()).toContain('publish')
    expect(r.result.published).toBe(true)
  })

  it('stops when publishing fails, and says the draft is signed and unpublished', async () => {
    const r = await ship(world({ publishFails: true }), { keyFile: KEY })

    expect(r.result.failures).toEqual([expect.stringMatching(/publish.*502.*signed draft is still a draft|still a draft/i)])
    expect(r.result).toMatchObject({ signed: true, published: false })
    expect(r.scripts.some((entry) => entry.script === 'release:verify')).toBe(false)
  })

  it('checks the public files again a few times (GitHub takes a moment), and passes when one try passes', async () => {
    const r = await ship(world({ verify: [1, 1, 0] }), { keyFile: KEY })

    expect(r.result).toEqual({ failures: [], signed: true, published: true, verified: true })
    expect(r.scripts.filter((entry) => entry.script === 'release:verify')).toHaveLength(3)
    expect(r.slept).toHaveLength(2)
  })

  it('says loudly that the release IS published when the public check keeps failing', async () => {
    const r = await ship(world({ verify: [1] }), { keyFile: KEY })

    expect(r.result.failures).toEqual([expect.stringMatching(/IS published.*public check failed/)])
    expect(r.result).toMatchObject({ signed: true, published: true, verified: false })
    expect(r.scripts.filter((entry) => entry.script === 'release:verify')).toHaveLength(3)
  })
})

describe('the worktree is always removed, and the owner’s working copy is never touched', () => {
  const scenarios: [string, Partial<World>, RunOptions][] = [
    ['the install fails', { installFails: true }, {}],
    ['the dry run refuses', { dry: { code: 1, output: 'refused' } }, {}],
    ['--dry-run', {}, { dryRun: true }],
    ['the key file is refused', { keyProblem: 'no such file' }, {}],
    ['the passphrase is cancelled', { passphrase: new Error('Interrupted') }, {}],
    ['the signing fails', { sign: { code: 1, output: 'wrong passphrase' } }, {}],
    ['the draft does not hold what it should', { assets: [EXE] }, {}],
    ['publishing is declined', { publishAnswer: 'n' }, {}],
    ['publishing fails', { publishFails: true }, {}],
    ['the public check fails', { verify: [1] }, {}],
    ['everything works', {}, {}],
  ]

  it.each(scenarios)('when %s', async (_name, over, options) => {
    const r = await ship(world(over), { keyFile: KEY, ...options })

    expect(r.names().filter((name) => name === 'removeWorktree')).toHaveLength(1)
    expect(r.names().at(-1)).toBe('removeTempDir')
    expect(r.names().indexOf('removeWorktree')).toBeGreaterThan(r.names().indexOf('addWorktree'))
  })

  it('removes the temporary folder, and does not try to remove a worktree it never made, when the worktree cannot be made', async () => {
    const r = await ship(world({ addFails: true }), { keyFile: KEY })

    expect(r.result.failures).toEqual([expect.stringMatching(/worktree add failed/)])
    expect(r.names()).not.toContain('removeWorktree')
    expect(r.names().at(-1)).toBe('removeTempDir')
  })

  it('says so, with the command to do it by hand, when the worktree cannot be removed', async () => {
    const r = await ship(world({ removeFails: true }), { keyFile: KEY })

    expect(r.result.failures).toEqual([expect.stringMatching(/worktree.*could not be removed.*git worktree remove --force \/tmp\/ship-base\/work/)])
    expect(r.result).toMatchObject({ signed: true, published: true })
  })

  it('stops when the install fails, with the tagged tools never run', async () => {
    const r = await ship(world({ installFails: true }), { keyFile: KEY })

    expect(r.result.failures).toEqual([expect.stringMatching(/npm ci failed/)])
    expect(r.scripts).toEqual([])
  })
})

describe('the passphrase on every path (rule S5): a program that repeats it everywhere still never gets it into a line', () => {
  // Each scenario makes the program that has the passphrase echo it into its output and its error messages.
  const hostile: [string, Partial<World>][] = [
    ['the signing fails', { sign: { code: 1, output: 'incorrect password' } }],
    ['the signing works', {}],
    ['the draft is wrong afterwards', { assets: [EXE] }],
    ['publishing is declined', { publishAnswer: 'n' }],
    ['publishing fails with the secret in its error', { publishFails: true }],
    ['the public check fails', { verify: [1] }],
    ['the worktree cannot be removed, with the secret in its error', { removeFails: true }],
  ]

  it.each(hostile)('when %s', async (_name, over) => {
    const r = await ship(world({ ...over, hostile: true }), { keyFile: KEY })

    expect(everything(r)).not.toContain(SECRET)
    expect(JSON.stringify(r.result)).not.toContain(SECRET)
    expect(JSON.stringify(r.calls)).not.toContain(SECRET)
    expect(r.scripts.filter((entry) => entry.passphrase !== undefined)).toHaveLength(1)
    // What the program printed is still shown: the secret is replaced, not the whole line dropped.
    if (over.sign?.code === 1) expect(r.notes.join('\n')).toMatch(/incorrect password \[\[passphrase\]\]/)
  })

  it('also when an error thrown by the host holds it, in a failure the tool builds itself', async () => {
    const f = fake(world({ hostile: true }))
    const original = f.host.releaseAssets
    f.host.releaseAssets = async (tag) => {
      await original(tag)
      throw new Error(`gh could not read the release (token ${SECRET})`)
    }
    const failures = (await releaseShip({ tag: TAG, keyFile: KEY, toolsDiffReviewed: HASH, dryRun: false, repoRoot: REPO, pause: async () => undefined }, f.host, f.io, () => undefined, () => undefined)).failures

    expect(failures.join('\n')).not.toContain(SECRET)
    expect(failures.join('\n')).toContain('[passphrase]')
  })

  it('does not keep the passphrase anywhere the result can reach', async () => {
    const r = await ship(world(), { keyFile: KEY })

    expect(JSON.stringify(r.result)).not.toContain(SECRET)
  })
})

describe('the command line', () => {
  it('takes a tag, and --key-file, --tools-diff-reviewed and --dry-run', () => {
    expect(parseReleaseShipArguments(['v1.1.1'])).toEqual({ tag: 'v1.1.1', dryRun: false })
    expect(parseReleaseShipArguments(['v1.1.1', '--key-file', '/keys/updater.key', '--tools-diff-reviewed', HASH, '--dry-run'])).toEqual({ tag: 'v1.1.1', keyFile: '/keys/updater.key', toolsDiffReviewed: HASH, dryRun: true })
  })

  it('has no option for the passphrase, and says it is asked for in a hidden prompt', () => {
    for (const args of [['v1.1.1', '--password', 'hunter2'], ['v1.1.1', '-p', 'hunter2'], ['v1.1.1', '--passphrase=hunter2']]) {
      expect(parseReleaseShipArguments(args)).toMatch(/passphrase is asked for in a hidden prompt/)
    }
  })

  it.each([
    ['no tag', []],
    ['two tags', ['v1.1.1', 'v1.1.0']],
    ['a name that is not a tag', ['main']],
    ['--key-file without a path', ['v1.1.1', '--key-file']],
    ['a hash that is not 16 hex digits', ['v1.1.1', '--tools-diff-reviewed', 'abc']],
    ['an unknown option', ['v1.1.1', '--force']],
  ])('refuses %s, in words', (_name, args) => {
    expect(typeof parseReleaseShipArguments(args)).toBe('string')
  })
})

describe('the real git, gh and npm commands, as they are run (no shell)', () => {
  interface RunCall {
    command: string
    args: string[]
    options: { cwd?: string; env?: Record<string, string | undefined>; inherit?: boolean } | undefined
  }

  function recorder(answer: (call: RunCall) => { code: number; stdout?: string; stderr?: string } = () => ({ code: 0 })) {
    const calls: RunCall[] = []
    const runner: Runner = async (command, args, options) => {
      const call = { command, args, options }
      calls.push(call)
      const { code, stdout = '', stderr = '' } = answer(call)

      return { code, stdout, stderr }
    }

    return { calls, runner }
  }
  const host = (runner: Runner) => createShipHost(runner, REPO)

  it('fetches the tags and the branch from origin', async () => {
    const { calls, runner } = recorder()

    await host(runner).fetchTags()

    expect(calls[0]).toMatchObject({ command: 'git', args: ['fetch', 'origin', '--tags'] })
  })

  it('reads a tag’s commit, here and on origin, taking the commit an annotated tag points at', async () => {
    const local = recorder(() => ({ code: 0, stdout: `${COMMIT}\n` }))
    expect(await host(local.runner).tagCommit(TAG)).toBe(COMMIT)
    expect(local.calls[0]!.args).toEqual(['rev-parse', '--verify', '--quiet', `${TAG}^{commit}`])

    const remote = recorder(() => ({ code: 0, stdout: `${'e'.repeat(40)}\trefs/tags/${TAG}\n${COMMIT}\trefs/tags/${TAG}^{}\n` }))
    expect(await host(remote.runner).remoteTagCommit(TAG)).toBe(COMMIT)
    expect(remote.calls[0]!.args).toEqual(['ls-remote', 'origin', `refs/tags/${TAG}`, `refs/tags/${TAG}^{}`])

    const lightweight = recorder(() => ({ code: 0, stdout: `${COMMIT}\trefs/tags/${TAG}\n` }))
    expect(await host(lightweight.runner).remoteTagCommit(TAG)).toBe(COMMIT)

    expect(await host(recorder(() => ({ code: 0, stdout: '' })).runner).remoteTagCommit(TAG)).toBeUndefined()
  })

  it('diffs exactly the tools that see the key, between two tags, in a form that is the same every time', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: DIFF }))

    expect(await host(runner).toolsDiff(PREVIOUS, TAG)).toBe(DIFF)
    expect(calls[0]!.args).toEqual(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', PREVIOUS, TAG, '--', ...TOOLS_PATHS])
    expect(TOOLS_PATHS).toEqual(['server/src/tools', 'package.json', 'package-lock.json', 'apps/desktop/package.json'])
  })

  it('makes and removes a worktree at the tag, detached, and installs without running any package script', async () => {
    const { calls, runner } = recorder()

    await host(runner).addWorktree('/tmp/b/work', TAG)
    await host(runner).install('/tmp/b/work')
    await host(runner).removeWorktree('/tmp/b/work')

    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      ['git', 'worktree', 'add', '--detach', '/tmp/b/work', TAG],
      ['npm', 'ci', '--ignore-scripts'],
      ['git', 'worktree', 'remove', '--force', '/tmp/b/work'],
      ['git', 'worktree', 'prune'],
    ])
    expect(calls[1]!.options?.cwd).toBe('/tmp/b/work')
  })

  describe('running a tagged script', () => {
    const outer = { TAURI_SIGNING_PRIVATE_KEY: 'KEY-CONTENT', TAURI_SIGNING_PRIVATE_KEY_PATH: '/elsewhere.key', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'SHELL-PASSWORD', KEEP_ME: 'yes' }
    const withOuterEnvironment = async (body: () => Promise<void>) => {
      const before = Object.fromEntries(Object.keys(outer).map((name) => [name, process.env[name]]))
      Object.assign(process.env, outer)
      try {
        await body()
      } finally {
        for (const [name, value] of Object.entries(before)) {
          if (value === undefined) delete process.env[name]
          else process.env[name] = value
        }
      }
    }

    it('runs it with npm in the worktree, and reads what it printed', async () => {
      const { calls, runner } = recorder(() => ({ code: 0, stdout: 'out\n', stderr: 'err\n' }))

      const result = await host(runner).runScript('/tmp/b/work', 'release:sign', [TAG, '--dry-run'])

      expect(calls[0]).toMatchObject({ command: 'npm', args: ['run', '--silent', 'release:sign', '--', TAG, '--dry-run'], options: { cwd: '/tmp/b/work' } })
      expect(result).toEqual({ code: 0, output: 'out\nerr\n' })
    })

    it('gives the passphrase to the environment of THAT process only, as the one variable the signer reads, never as an argument', async () => {
      const { calls, runner } = recorder()
      await withOuterEnvironment(async () => {
        await host(runner).runScript('/tmp/b/work', 'release:sign', [TAG, '--key-file', KEY], SECRET)
      })

      const env = calls[0]!.options!.env!
      expect(Object.keys(env).filter((name) => name.startsWith('TAURI_SIGNING'))).toEqual(['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'])
      expect(env['TAURI_SIGNING_PRIVATE_KEY_PASSWORD']).toBe(SECRET)
      expect(env['KEEP_ME']).toBe('yes')
      expect(JSON.stringify(calls[0]!.args)).not.toContain(SECRET)
    })

    it('hands a process that is given no passphrase NONE: not the owner’s shell’s either, and no key variable ever', async () => {
      const { calls, runner } = recorder()
      await withOuterEnvironment(async () => {
        await host(runner).runScript('/tmp/b/work', 'release:sign', [TAG, '--dry-run'])
        await host(runner).runScript('/tmp/b/work', 'release:verify', [TAG])
      })

      for (const call of calls) expect(Object.keys(call.options!.env!).filter((name) => name.startsWith('TAURI_SIGNING'))).toEqual([])
    })

    it('scrubs every updater variable of the owner’s shell from everything else it runs too (git, npm ci, gh): a process that inherits nothing cannot leak it', async () => {
      const { calls, runner } = recorder((call) => (call.command === 'gh' && call.args[0] === 'run' ? { code: 0, stdout: '[]' } : { code: 0 }))
      await withOuterEnvironment(async () => {
        const h = host(runner)
        await h.fetchTags()
        await h.install('/tmp/b/work')
        await h.addWorktree('/tmp/b/work', TAG)
        await h.publish(TAG)
        await h.ciRuns(COMMIT)
        await h.releaseAssets(TAG).catch(() => undefined)
      })

      expect(calls.length).toBeGreaterThanOrEqual(5)
      for (const call of calls) {
        // An explicit environment, so nothing is inherited from the shell by default.
        expect(call.options?.env).toBeDefined()
        expect(Object.keys(call.options!.env!).filter((name) => name.startsWith('TAURI_SIGNING'))).toEqual([])
        expect(JSON.stringify(call.options!.env)).not.toContain('SHELL-PASSWORD')
        expect(call.options!.env!['KEEP_ME']).toBe('yes')
      }
    })

    it('does not take the terminal: the process reads no input, so a prompt can never wait for one', async () => {
      const { calls, runner } = recorder()

      await host(runner).runScript('/tmp/b/work', 'release:sign', [TAG, '--dry-run'])

      expect(calls[0]!.options?.inherit).not.toBe(true)
    })
  })

  it('reads what the release holds from GitHub, and publishes by taking the draft flag off', async () => {
    const view = recorder(() => ({ code: 0, stdout: JSON.stringify({ isDraft: true, assets: [{ name: EXE }] }) }))
    expect(await host(view.runner).releaseAssets(TAG)).toEqual({ isDraft: true, assets: [EXE] })

    const edit = recorder()
    await host(edit.runner).publish(TAG)
    expect(edit.calls[0]).toMatchObject({ command: 'gh', args: ['release', 'edit', TAG, '--repo', 'gerharar/listulator', '--draft=false'] })
  })

  it('says what a failed command printed', async () => {
    await expect(host(recorder(() => ({ code: 1, stderr: 'fatal: bad object' })).runner).addWorktree('/tmp/b/work', TAG)).rejects.toThrow(/bad object/)
  })

  describe('the key file and the temporary folder (the real disk)', () => {
    let root: string
    afterEach(() => root !== undefined && rmSync(root, { recursive: true, force: true }))

    it('says a missing path and a folder are not usable key files, and accepts a file, without reading it', async () => {
      root = mkdtempSync(join(tmpdir(), 'ship-test-'))
      const file = join(root, 'updater.key')
      writeFileSync(file, 'CANARY-KEY-CONTENT')
      mkdirSync(join(root, 'folder'))
      const h = host(recorder().runner)

      expect(await h.keyFileProblem(file)).toBeUndefined()
      expect(await h.keyFileProblem(join(root, 'missing.key'))).toMatch(/is not a file/)
      expect(await h.keyFileProblem(join(root, 'folder'))).toMatch(/is not a file/)
      // There is no way to read it: the host has no method that returns a file's content, only this question about its metadata.
    })

    it('makes a temporary folder and removes it with what is in it', async () => {
      const h = host(recorder().runner)
      root = await h.makeTempDir()
      writeFileSync(join(root, 'x'), 'y')

      expect(existsSync(root)).toBe(true)
      await h.removeTempDir(root)
      expect(existsSync(root)).toBe(false)
    })
  })
})
