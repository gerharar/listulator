import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeFindings, scanFiles, trackedFiles } from './tools/secretScan.js'

/**
 * Nothing that is a key or a secret may reach this public repository (Phase 31, task 31.1a; docs/DECISIONS.md). Four layers, each proven here:
 * the tracked files are clean now, `.gitignore` keeps key files from being added by accident, `scripts/pre-push` stops a push that would carry
 * one (from ANY commit in it, also one a later commit removed), and CI runs the same scan (31.1). GitHub's own secret scanning knows providers'
 * formats and not a Tauri updater key.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** Assembled at run time: this file must hold nothing key-shaped. */
const KEY_COMMENT = ['untrusted', 'comment:', 'rsign encrypted', 'secret key'].join(' ')
const KEY_TEXT = Buffer.from(`${KEY_COMMENT}\nRWRTY0Iy${'a'.repeat(60)}\n`).toString('base64')

describe('the tracked files', () => {
  it('hold no key, token or secret, and no file with the name of a private key', () => {
    const findings = scanFiles(ROOT, trackedFiles(ROOT))

    expect(describeFindings(findings)).toBe('')
  })
})

describe('.gitignore', () => {
  const ignored = (path: string): boolean => spawnSync('git', ['check-ignore', '-q', path], { cwd: ROOT }).status === 0

  it('keeps the names a private key is saved under out of git', () => {
    for (const path of ['updater.key', 'sub/dir/new-updater.key', 'server.pem', 'cert.p12', 'cert.pfx', '.listulator-updater.key', '.listulator-updater-backup.key']) {
      expect(ignored(path), path).toBe(true)
    }
  })

  it('does not hide the public half, which is committed on purpose', () => {
    expect(ignored('updater.key.pub')).toBe(false)
  })
})

describe('the way to run the scan', () => {
  it('is an npm script, and CONTRIBUTING says how to install the pre-push hook', () => {
    expect(JSON.parse(read('package.json')).scripts['secrets:scan']).toContain('secretScan.ts')
    expect(read('CONTRIBUTING.md')).toContain('ln -sf ../../scripts/pre-push .git/hooks/pre-push')
  })

  it('has a pre-push hook that is executable', () => {
    const hook = join(ROOT, 'scripts/pre-push')

    expect(existsSync(hook)).toBe(true)
    expect(statSync(hook).mode & 0o111).not.toBe(0)
    expect(read('scripts/pre-push')).toContain('secretScan.ts')
  })
})

describe('scripts/pre-push, run by git on a real push', () => {
  let work: string
  let remote: string

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const commit = (message: string): void => {
    git(work, 'add', '-A')
    git(work, 'commit', '-q', '-m', message)
  }
  const push = (...refs: string[]): { ok: boolean; output: string } => {
    const result = spawnSync('git', ['push', 'origin', ...refs], { cwd: work, encoding: 'utf8' })

    return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` }
  }
  const remoteHas = (ref: string): boolean => spawnSync('git', ['rev-parse', '--verify', '-q', ref], { cwd: remote }).status === 0

  beforeAll(() => {
    const base = mkdtempSync(join(tmpdir(), 'prepush-'))
    work = join(base, 'work')
    remote = join(base, 'remote.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
    execFileSync('git', ['init', '-q', '-b', 'main', work])
    git(work, 'remote', 'add', 'origin', remote)
    // The hook runs the scanner of the repository it is in: give the throw-away repository the two files it needs and the real node_modules.
    mkdirSync(join(work, 'server/src/tools'), { recursive: true })
    for (const file of ['secretScan.ts', 'runDirectly.ts']) copyFileSync(join(ROOT, 'server/src/tools', file), join(work, 'server/src/tools', file))
    symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'))
    writeFileSync(join(work, '.gitignore'), 'node_modules\n')
    mkdirSync(join(work, '.git/hooks'), { recursive: true })
    copyFileSync(join(ROOT, 'scripts/pre-push'), join(work, '.git/hooks/pre-push'))
    execFileSync('chmod', ['+x', join(work, '.git/hooks/pre-push')])
  })

  afterAll(() => {
    rmSync(join(work, '..'), { recursive: true, force: true })
  })

  it('lets a clean push through', () => {
    writeFileSync(join(work, 'notes.txt'), 'nothing secret\n')
    commit('clean')

    expect(push('main').ok).toBe(true)
    expect(remoteHas('main')).toBe(true)
  })

  it('stops a push that carries a key, says which file and rule, and never prints the key', () => {
    writeFileSync(join(work, 'oops.txt'), `${KEY_TEXT}\n`)
    commit('oops')
    const refused = push('main')

    expect(refused.ok).toBe(false)
    expect(refused.output).toContain('oops.txt')
    expect(refused.output).toContain('tauri-secret-key')
    expect(refused.output).not.toContain(KEY_TEXT.slice(0, 30))
  })

  it('still stops it after a later commit removed the key, because history is what is published', () => {
    rmSync(join(work, 'oops.txt'))
    commit('remove it again')

    expect(push('main').ok).toBe(false)
    expect(remoteHas('main~1')).toBe(false)
  })

  it('stops a file with the name of a private key even when its content looks harmless', () => {
    git(work, 'reset', '-q', '--hard', 'origin/main')
    writeFileSync(join(work, 'updater.key'), 'hello\n')
    git(work, 'add', '-f', 'updater.key')
    git(work, 'commit', '-q', '-m', 'a key file')
    const refused = push('main')

    expect(refused.ok).toBe(false)
    expect(refused.output).toContain('key-file-name')
  })

  it('stops a NEW branch whose history carries a key, and lets a clean new branch through', () => {
    git(work, 'reset', '-q', '--hard', 'origin/main')
    git(work, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(work, 'oops.txt'), `${KEY_TEXT}\n`)
    commit('oops on a branch')

    expect(push('feature').ok).toBe(false)
    expect(remoteHas('feature')).toBe(false)

    git(work, 'reset', '-q', '--hard', 'origin/main')
    git(work, 'checkout', '-q', '-b', 'clean-feature')
    writeFileSync(join(work, 'more.txt'), 'more\n')
    commit('clean on a branch')

    expect(push('clean-feature').ok).toBe(true)
  })

  it('does not get in the way of deleting a branch', () => {
    expect(push('--delete', 'clean-feature').ok).toBe(true)
  })
})
