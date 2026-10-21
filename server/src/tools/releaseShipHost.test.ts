import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TOOLS_PATHS, createShipHost, visible } from './releaseShip.js'
import type { Runner } from './releaseSign.js'

/**
 * The real half of `release:ship` (31.5): the git, gh, npm and node commands it runs, as they are run (no shell, an environment that
 * holds nothing of the owner's shell, the passphrase on a pipe), and what it shows the owner. The orchestration, with a fake host, is in
 * `releaseShip.test.ts`.
 */

const TAG = 'v1.1.1'
const COMMIT = 'a'.repeat(40)
const PREV_COMMIT = 'b'.repeat(40)
const SECRET = 'Sh1p-Sentinel-Passphrase-77123'
const EXE = 'Listulator_1.1.1_x64-setup.exe'
const KEY = '/keys/updater.key'
const REPO = '/repo'
const DIFF = 'diff --git a/server/src/tools/x.ts b/server/src/tools/x.ts\n-old\n+new\n'

describe('the real git, gh and npm commands, as they are run (no shell)', () => {
  interface RunCall {
    command: string
    args: string[]
    options: { cwd?: string; env?: Record<string, string | undefined>; inherit?: boolean; input?: string } | undefined
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

  it('diffs exactly the files that decide what runs with the key, as TEXT and in a form that is the same every time', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: DIFF }))

    expect(await host(runner).toolsDiff(PREV_COMMIT, COMMIT)).toBe(DIFF)
    // --text: a .gitattributes `-diff` cannot turn the diff into "Binary files differ"; the fixed options keep the owner's git configuration out of it.
    expect(calls[0]!.args).toEqual(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--text', PREV_COMMIT, COMMIT, '--', ...TOOLS_PATHS])
    expect(TOOLS_PATHS).toEqual(expect.arrayContaining(['server/src/tools', 'package.json', 'package-lock.json', 'apps/desktop/package.json', 'server/package.json', 'tsconfig.base.json', 'server/tsconfig.json', '.npmrc', '.gitattributes', '.github/workflows']))
  })

  it('lists the published stable releases from GitHub: the baseline of the diff is a release, not a tag that merely exists here', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: JSON.stringify([{ tagName: 'v1.1.0' }, { tagName: 'v1.0.2' }, { tagName: 'nightly' }]) }))

    expect(await host(runner).publishedTags()).toEqual(['v1.1.0', 'v1.0.2'])
    expect(calls[0]).toMatchObject({ command: 'gh', args: ['release', 'list', '--repo', 'gerharar/listulator', '--exclude-drafts', '--exclude-pre-releases', '--limit', '100', '--json', 'tagName'] })
  })

  it('asks git whether one commit is an ancestor of another, by exit code, and fails on any other answer', async () => {
    const yes = recorder(() => ({ code: 0 }))
    const no = recorder(() => ({ code: 1 }))

    expect(await host(yes.runner).isAncestor(PREV_COMMIT, COMMIT)).toBe(true)
    expect(await host(no.runner).isAncestor(PREV_COMMIT, COMMIT)).toBe(false)
    expect(yes.calls[0]!.args).toEqual(['merge-base', '--is-ancestor', PREV_COMMIT, COMMIT])
    await expect(host(recorder(() => ({ code: 128, stderr: 'fatal: bad object' })).runner).isAncestor(PREV_COMMIT, COMMIT)).rejects.toThrow(/bad object/)
  })

  describe('what in a commit’s tree cannot be reviewed as text, or is missing', () => {
    const entry = (mode: string, path: string, sha = '1'.repeat(40)) => `${mode} ${mode === '160000' ? 'commit' : 'blob'} ${sha}\t${path}\0`
    const scripts = [entry('100644', 'server/src/tools/releaseSign.ts'), entry('100644', 'server/src/tools/releaseVerify.ts')]
    const treeOf = (...entries: string[]) => entries.join('')

    it('reads the tree with NUL separators, so a path with a space or a line break is read as it is', async () => {
      const { calls, runner } = recorder(() => ({ code: 0, stdout: treeOf(...scripts) }))

      await host(runner).unsafeEntries(COMMIT)

      expect(calls[0]!.args).toEqual(['ls-tree', '-r', '-z', '--full-tree', COMMIT])
    })

    it('finds a .npmrc anywhere, also in a path with spaces or a line break', async () => {
      const { runner } = recorder(() => ({ code: 0, stdout: treeOf(...scripts, entry('100644', '.npmrc'), entry('100644', 'web/.npmrc'), entry('100644', 'a folder/with space/.npmrc'), entry('100644', 'odd\nname/.npmrc')) }))

      expect(await host(runner).unsafeEntries(COMMIT)).toEqual(['.npmrc', 'web/.npmrc', 'a folder/with space/.npmrc', 'odd\nname/.npmrc'])
    })

    it('finds a symlink or a submodule that IS a reviewed path, is UNDER one, or is an ANCESTOR of one (server/src, apps/desktop, .github), where the diff would show only deletions', async () => {
      const tree = treeOf(
        entry('120000', 'server/src/tools/helper.ts'),
        entry('160000', 'server/src/tools/vendor'),
        entry('120000', 'server/src'),
        entry('160000', 'apps/desktop'),
        entry('120000', '.github'),
        entry('120000', 'server'),
        entry('120000', 'package.json'),
        entry('120000', 'docs/link-to-readme.md'),
        entry('160000', 'third_party/lib'),
        entry('100644', 'server/src/tools/x.ts'),
      )
      const { runner } = recorder(() => ({ code: 0, stdout: treeOf(...scripts) + tree }))

      expect(await host(runner).unsafeEntries(COMMIT)).toEqual([
        'server/src/tools/helper.ts (a symbolic link)',
        'server/src/tools/vendor (a submodule)',
        'server/src (a symbolic link)',
        'apps/desktop (a submodule)',
        '.github (a symbolic link)',
        'server (a symbolic link)',
        'package.json (a symbolic link)',
      ])
    })

    it('requires the two scripts that run with the key to be there as regular files: missing, and not regular, are both found', async () => {
      const missing = recorder(() => ({ code: 0, stdout: treeOf(entry('100644', 'server/src/tools/releaseSign.ts')) }))
      const notRegular = recorder(() => ({ code: 0, stdout: treeOf(entry('100644', 'server/src/tools/releaseVerify.ts'), entry('100755', 'x'), entry('120000', 'server/src/tools/releaseSign.ts')) }))
      const executable = recorder(() => ({ code: 0, stdout: treeOf(entry('100755', 'server/src/tools/releaseSign.ts'), entry('100755', 'server/src/tools/releaseVerify.ts')) }))

      expect(await host(missing.runner).unsafeEntries(COMMIT)).toEqual(['server/src/tools/releaseVerify.ts (missing in the tagged tree)'])
      expect(await host(notRegular.runner).unsafeEntries(COMMIT)).toEqual(['server/src/tools/releaseSign.ts (a symbolic link)', 'server/src/tools/releaseSign.ts (missing in the tagged tree)'])
      expect(await host(executable.runner).unsafeEntries(COMMIT)).toEqual([])
    })
  })

  describe('whether the owner’s working copy holds the reviewed tools', () => {
    const answers = (over: { head?: Record<string, string>; tagged?: Record<string, string>; status?: string } = {}) =>
      recorder((call) => {
        if (call.args[0] === 'rev-parse') {
          const spec = call.args.at(-1)!
          const [rev, path] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)]
          const sha = (rev === 'HEAD' ? over.head : over.tagged)?.[path] ?? `${'e'.repeat(40)}`

          return sha === '' ? { code: 1 } : { code: 0, stdout: `${sha}\n` }
        }

        return { code: 0, stdout: over.status ?? '' }
      })

    it('finds nothing when every reviewed path is the same object in HEAD and in the tag, and nothing is changed', async () => {
      const { calls, runner } = answers()

      expect(await host(runner).checkoutDiffers(COMMIT)).toEqual([])
      // One look at HEAD and one at the tag for every reviewed path.
      const specs = calls.filter((call) => call.args[0] === 'rev-parse').map((call) => call.args.at(-1))
      expect(specs).toEqual(expect.arrayContaining([`HEAD:${TOOLS_PATHS[0]}`, `${COMMIT}:${TOOLS_PATHS[0]}`]))
      expect(specs).toHaveLength(TOOLS_PATHS.length * 2)
    })

    it('finds a reviewed path whose object differs, one that exists on one side only, and one that is changed in the working tree or new', async () => {
      const { runner } = answers({
        head: { 'server/src/tools': '1'.repeat(40), '.npmrc': '2'.repeat(40) },
        tagged: { 'server/src/tools': '3'.repeat(40), '.npmrc': '' },
        status: ' M package-lock.json\n?? .gitattributes\n M web/src/App.tsx\n',
      })

      expect(await host(runner).checkoutDiffers(COMMIT)).toEqual(['server/src/tools', '.npmrc', 'package-lock.json (uncommitted)', '.gitattributes (uncommitted)'])
    })
  })

  it('reads the commit a worktree is at', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: `${COMMIT}\n` }))

    expect(await host(runner).worktreeHead('/tmp/b/work')).toBe(COMMIT)
    expect(calls[0]).toMatchObject({ command: 'git', args: ['rev-parse', 'HEAD'], options: { cwd: '/tmp/b/work' } })
  })

  it('makes and removes a worktree at the COMMIT, detached, and installs without running any package script', async () => {
    const { calls, runner } = recorder()

    await host(runner).addWorktree('/tmp/b/work', COMMIT)
    await host(runner).install('/tmp/b/work')
    await host(runner).removeWorktree('/tmp/b/work')

    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      ['git', 'worktree', 'add', '--detach', '/tmp/b/work', COMMIT],
      ['npm', 'ci', '--ignore-scripts'],
      ['git', 'worktree', 'remove', '--force', '/tmp/b/work'],
      ['git', 'worktree', 'prune'],
    ])
    expect(calls[1]!.options?.cwd).toBe('/tmp/b/work')
  })

  describe('running a tagged script', () => {
    const OUTER = { TAURI_SIGNING_PRIVATE_KEY: 'KEY-CONTENT', TAURI_SIGNING_PRIVATE_KEY_PATH: '/elsewhere.key', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'SHELL-PASSWORD', TAURI_PRIVATE_KEY: 'OLD-KEY', TAURI_PRIVATE_KEY_PASSWORD: 'OLD-PASSWORD', NODE_OPTIONS: '--require /owner/preload.js', NODE_PATH: '/owner/modules', ESBUILD_BINARY_PATH: '/owner/esbuild', TSX_TSCONFIG_PATH: '/owner/tsconfig.json', NODE_TLS_REJECT_UNAUTHORIZED: '0', KEEP_ME: 'yes' }
    const withOuterEnvironment = async (body: () => Promise<void>) => {
      const before = Object.fromEntries(Object.keys(OUTER).map((name) => [name, process.env[name]]))
      Object.assign(process.env, OUTER)
      try {
        await body()
      } finally {
        for (const [name, value] of Object.entries(before)) {
          if (value === undefined) delete process.env[name]
          else process.env[name] = value
        }
      }
    }
    const holdsNothingOfTheShell = (env: Record<string, string | undefined> | undefined) => {
      expect(env).toBeDefined()
      expect(Object.keys(env!).filter((name) => /^TAURI_(SIGNING|PRIVATE_KEY)|^(NODE_OPTIONS|NODE_PATH|ESBUILD_BINARY_PATH|NODE_TLS_REJECT_UNAUTHORIZED)$|^TSX_/.test(name))).toEqual([])
      expect(JSON.stringify(env)).not.toMatch(/SHELL-PASSWORD|OLD-PASSWORD|KEY-CONTENT|OLD-KEY|preload\.js|\/owner\//)
      expect(env!['KEEP_ME']).toBe('yes')
    }

    it('runs the tagged script with node and tsx directly, in the worktree: no npm, so no .npmrc, no package script and no .bin on PATH of the tagged tree', async () => {
      const { calls, runner } = recorder(() => ({ code: 0, stdout: 'out\n', stderr: 'err\n' }))

      const result = await host(runner).runScript('/tmp/b/work', 'release:sign', [TAG, '--dry-run'])
      await host(runner).runScript('/tmp/b/work', 'release:verify', [TAG])

      expect(calls[0]).toMatchObject({
        command: process.execPath,
        args: ['/tmp/b/work/node_modules/tsx/dist/cli.mjs', '/tmp/b/work/server/src/tools/releaseSign.ts', TAG, '--dry-run'],
        options: { cwd: '/tmp/b/work' },
      })
      expect(calls[1]!.args).toEqual(['/tmp/b/work/node_modules/tsx/dist/cli.mjs', '/tmp/b/work/server/src/tools/releaseVerify.ts', TAG])
      expect(calls.every((call) => call.command !== 'npm')).toBe(true)
      expect(result).toEqual({ code: 0, output: 'out\nerr\n' })
    })

    it('hands the passphrase to the tagged script on a PIPE: in no argument and in no environment variable at all', async () => {
      const { calls, runner } = recorder()
      await withOuterEnvironment(async () => {
        await host(runner).runScript('/tmp/b/work', 'release:sign', [TAG, '--key-file', KEY, '--passphrase-stdin'], SECRET)
      })

      const call = calls[0]!
      expect(call.options?.input).toBe(`${SECRET}\n`)
      expect(JSON.stringify(call.args)).not.toContain(SECRET)
      expect(JSON.stringify(call.options?.env)).not.toContain(SECRET)
      holdsNothingOfTheShell(call.options?.env)
    })

    it('gives a process that is handed no passphrase no input and no updater variable, the shell’s own included', async () => {
      const { calls, runner } = recorder()
      await withOuterEnvironment(async () => {
        await host(runner).runScript('/tmp/b/work', 'release:sign', [TAG, '--dry-run'])
        await host(runner).runScript('/tmp/b/work', 'release:verify', [TAG])
      })

      for (const call of calls) {
        expect(call.options?.input).toBeUndefined()
        holdsNothingOfTheShell(call.options?.env)
      }
    })

    it('scrubs every updater variable and NODE_OPTIONS of the owner’s shell from everything else it runs too (git, npm ci, gh)', async () => {
      const { calls, runner } = recorder((call) => (call.command === 'gh' && call.args[0] === 'run' ? { code: 0, stdout: '[]' } : { code: 0 }))
      await withOuterEnvironment(async () => {
        const h = host(runner)
        await h.fetchTags()
        await h.install('/tmp/b/work')
        await h.addWorktree('/tmp/b/work', COMMIT)
        await h.publish(TAG)
        await h.ciRuns(COMMIT)
        await h.releaseAssets(TAG).catch(() => undefined)
      })

      expect(calls.length).toBeGreaterThanOrEqual(5)
      for (const call of calls) holdsNothingOfTheShell(call.options?.env)
    })

    it('does not take the terminal: the process reads no input of the owner’s, so a prompt can never wait for one', async () => {
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

    it('says where a path really leads (a symbolic link is followed), and the path itself when it does not exist', async () => {
      root = mkdtempSync(join(tmpdir(), 'ship-test-'))
      mkdirSync(join(root, 'real'))
      writeFileSync(join(root, 'real', 'k'), 'x')
      symlinkSync(join(root, 'real'), join(root, 'link'))
      const h = host(recorder().runner)

      expect(await h.realPath(join(root, 'link', 'k'))).toBe(realpathSync(join(root, 'real', 'k')))
      expect(await h.realPath(join(root, 'missing', 'k'))).toBe(join(root, 'missing', 'k'))
    })

    it('makes a temporary folder by its REAL path (macOS’s temporary folder is reached through a symbolic link, and a script started through one silently does nothing) and removes it with what is in it', async () => {
      const h = host(recorder().runner)
      root = await h.makeTempDir()
      writeFileSync(join(root, 'x'), 'y')

      expect(root).toBe(realpathSync(root))
      expect(existsSync(root)).toBe(true)
      await h.removeTempDir(root)
      expect(existsSync(root)).toBe(false)
    })
  })
})

describe('control and hidden characters in text shown to the owner', () => {
  it('shows a control character, an escape sequence, a carriage return and a bidi override as visible text', () => {
    expect(visible('a\u001b[2Kb\rc\u202ed\u200be\u007f')).toEqual({ text: 'a\\x1b[2Kb\\rc<U+202E>d<U+200B>e\\x7f', replaced: true })
  })

  it('leaves ordinary text, line breaks, tabs, Latin letters with accents and the usual typographic characters alone', () => {
    const plain = 'plain\n\ttext ü é Å ß ’ “quoted” — – − … • → €'
    expect(visible(plain)).toEqual({ text: plain, replaced: false })
  })

  it('shows lookalike letters of another script (Cyrillic, Greek) as code points: a reviewer cannot tell them from Latin ones', () => {
    expect(visible('paypal')).toEqual({ text: 'paypal', replaced: false })
    expect(visible('p\u0430yp\u0430l')).toEqual({ text: 'p<U+0430>yp<U+0430>l', replaced: true })
    expect(visible('\u03bf\u041e')).toEqual({ text: '<U+03BF><U+041E>', replaced: true })
  })

  it.each([
    ['a soft hyphen', '\u00ad'],
    ['a non-breaking space', '\u00a0'],
    ['a combining grapheme joiner', '\u034f'],
    ['the Arabic letter mark', '\u061c'],
    ['a Hangul filler', '\u3164'],
    ['a Braille blank', '\u2800'],
    ['a line separator', '\u2028'],
    ['a variation selector', '\ufe0f'],
    ['a tag character', '\u{e0041}'],
    ['an emoji', '😀'],
  ])('shows %s as a code point: anything not on the list of plain characters is made visible', (_name, character) => {
    const shown = visible(`a${character}b`)

    expect(shown.replaced).toBe(true)
    expect(shown.text).toMatch(/^a<U\+[0-9A-F]{4,6}>b$/)
  })

  it('shows the C1 controls too (a single byte that some terminals take for an escape)', () => {
    expect(visible('x\u009by')).toEqual({ text: 'x\\x9by', replaced: true })
  })
})
