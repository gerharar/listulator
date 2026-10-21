import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { createGhHost, nodeRunner, parseSums, type Runner } from './releaseSign.js'
import { createVerifyHost } from './releaseVerify.js'
import { isRunDirectly } from './runDirectly.js'
import { isStableTag, reason } from './toolText.js'
import { compareVersions } from './updateManifest.js'

/**
 * `npm run canary:install` (Phase 31, task 31.9): the smoke test of the daily canary, on a GitHub Windows runner. It takes the release
 * BELOW the newest published one, downloads its installer from GitHub, checks it against that release's `SHA256SUMS`, installs it
 * silently, starts it, and judges it on three things: the program says it is that version, it opens a window that answers, and it keeps
 * answering for ten seconds. Then it stops the app (by its install path, never by name), uninstalls it and removes what it downloaded.
 *
 * What it cannot do is read About: the production app cannot be driven from outside (31.2: the debugging flag never reaches its
 * browser), and the previous release is a FIXED program, so the things that move are the runner, WebView2, GitHub and the feed. The feed is
 * judged by `release:verify` (its update-path stage); this judges the program on the runner.
 *
 * It installs a program, so it runs only on a GitHub runner on Windows, and refuses when the program is already installed: it never
 * touches an install it did not make.
 */

const PRODUCT = 'Listulator'
const APP_EXE = 'listulator-desktop.exe'
const POLL_MS = 1000
const START_TIMEOUT_S = 60
const STAY_UP_S = 10

/** What the canary sees of the app: one process that runs from the install folder. */
export interface CanaryProcess {
  id: number
  responding: boolean
  hasWindow: boolean
}

/** What the canary needs from GitHub, the machine and the program, as intentions; `createCanaryHost` is the real one, the tests use a fake. */
export interface CanaryHost {
  publishedTags(): Promise<string[]>
  makeTempDir(): Promise<string>
  removeTempDir(dir: string): Promise<void>
  download(tag: string, names: string[], dir: string): Promise<void>
  fileBytes(path: string): Promise<Buffer>
  installDir(): string
  exists(path: string): boolean
  /** Runs the installer silently; its exit code. */
  runInstaller(path: string): Promise<number>
  /** The version a program says it is (its file's product version), or undefined. */
  fileVersion(exe: string): Promise<string | undefined>
  startApp(exe: string): void
  /** The processes that run from the install folder, found by their path. */
  processes(installDir: string): Promise<CanaryProcess[]>
  /** Ends every process that runs from the install folder, by its path and by nothing else. */
  stopApp(installDir: string): Promise<void>
  uninstall(installDir: string): Promise<void>
  pause(ms: number): Promise<void>
}

export interface ReleaseCanaryOptions {
  platform: NodeJS.Platform
  /** Running on a GitHub Actions runner (`GITHUB_ACTIONS=true`). */
  githubActions: boolean
}

export interface ReleaseCanaryResult {
  /** One sentence per thing that is wrong; empty when the previous release installs, starts and keeps answering. */
  failures: string[]
}

/** The four-part file version of a Windows program (1.0.2.0) as the three-part version of the release (1.0.2). */
const releaseVersionOf = (fileVersion: string): string => fileVersion.trim().replace(/^(\d+\.\d+\.\d+)\.0$/, '$1')

export async function releaseCanary(options: ReleaseCanaryOptions, host: CanaryHost, log: (line: string) => void): Promise<ReleaseCanaryResult> {
  if (options.platform !== 'win32' || !options.githubActions) {
    throw new Error('canary:install installs a program: it runs only on a GitHub Windows runner, never on a machine of yours')
  }
  const failures: string[] = []
  const fail = (line: string) => failures.push(line.replace(/\s+/g, ' ').trim().slice(0, 400))

  const published = (await host.publishedTags()).filter(isStableTag).sort((a, b) => compareVersions(b.slice(1), a.slice(1)))
  const latest = published[0]
  if (latest === undefined) {
    fail('There is no published release to check')

    return { failures }
  }
  const previous = published[1]
  if (previous === undefined) {
    log('Only one release is published: there is no previous release to install')

    return { failures }
  }
  const version = previous.slice(1)
  const installer = `Listulator_${version}_x64-setup.exe`
  const installDir = host.installDir()
  const exe = win32.join(installDir, APP_EXE)

  if (host.exists(installDir)) {
    fail(`${PRODUCT} is already installed at ${installDir}: this canary never touches an install it did not make`)

    return { failures }
  }

  const dir = await host.makeTempDir()
  let installed = false
  let started = false
  try {
    // 1. The installer, as GitHub serves it, against the checksums of the same release.
    await host.download(previous, [installer, 'SHA256SUMS'], dir)
    const sums = parseSums((await host.fileBytes(win32.join(dir, 'SHA256SUMS'))).toString('utf8'))
    const wanted = sums?.get(installer)
    if (wanted === undefined) {
      fail(`SHA256SUMS does not list ${installer}`)

      return { failures }
    }
    const actual = createHash('sha256').update(await host.fileBytes(win32.join(dir, installer))).digest('hex')
    if (actual !== wanted) {
      fail(`${installer} does not match its checksum in SHA256SUMS`)

      return { failures }
    }
    log(`${installer}  sha256 ${actual} matches SHA256SUMS`)

    // 2. Installed silently, as a user would from the download.
    installed = true
    const code = await host.runInstaller(win32.join(dir, installer))
    if (code !== 0) {
      fail(`The installer ended with ${code}`)

      return { failures }
    }
    if (!host.exists(exe)) {
      fail(`${APP_EXE} is not in ${installDir} after the installer ended`)

      return { failures }
    }
    log(`${PRODUCT} ${previous} installed from ${installer}`)

    // 3. It says what it is.
    const said = await host.fileVersion(exe)
    if (said === undefined || releaseVersionOf(said) !== version) {
      fail(`The installed program carries version ${said ?? 'none'}, not ${version}`)

      return { failures }
    }
    log(`The installed program says it is ${version}`)

    // 4. It starts, opens a window that answers, and keeps answering.
    host.startApp(exe)
    started = true
    let ready = false
    for (let second = 0; second < START_TIMEOUT_S && !ready; second++) {
      ready = (await host.processes(installDir)).some((process) => process.hasWindow && process.responding)
      if (!ready && second < START_TIMEOUT_S - 1) await host.pause(POLL_MS)
    }
    if (!ready) {
      fail(`The app did not open a responding window within ${START_TIMEOUT_S} s`)

      return { failures }
    }
    for (let second = 1; second <= STAY_UP_S; second++) {
      await host.pause(POLL_MS)
      const running = await host.processes(installDir)
      if (running.length === 0) {
        fail(`The app ended after ${second} s`)

        return { failures }
      }
      if (!running.some((process) => process.responding)) {
        fail(`The app stopped responding after ${second} s`)

        return { failures }
      }
    }
    log(`The app opened a window that answers, and answered for ${STAY_UP_S} s`)

    return { failures }
  } catch (error) {
    fail(`Stopped: ${reason(error)}`)

    return { failures }
  } finally {
    // Whatever happened: the app is stopped first (so the uninstaller finds nothing running), then uninstalled, then the download goes.
    if (started || installed) await host.stopApp(installDir).catch(() => undefined)
    if (installed) await host.uninstall(installDir).catch((error: unknown) => fail(`The uninstall failed: ${reason(error)}`))
    await host.removeTempDir(dir).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The real GitHub CLI, installer and PowerShell

export interface CanaryHostDeps {
  run: Runner
  env: Record<string, string | undefined>
  exists: (path: string) => boolean
  spawnDetached: (path: string) => void
  readFile: (path: string) => Buffer
  makeDir: () => string
  removeDir: (dir: string) => void
}

/** What PowerShell is asked: the folder or the file comes in through the environment, never into the text of a script. */
const VERSION_SCRIPT = '(Get-Item -LiteralPath $env:CANARY_FILE).VersionInfo.ProductVersion'
const PROCESSES_SCRIPT =
  "$dir = $env:CANARY_INSTALL_DIR + '\\'; $found = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dir, 'OrdinalIgnoreCase') } | ForEach-Object { [pscustomobject]@{ id = $_.Id; responding = [bool]$_.Responding; hasWindow = ($_.MainWindowHandle -ne 0) } }); ConvertTo-Json -InputObject $found -Compress"
const STOP_SCRIPT = "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($env:CANARY_INSTALL_DIR + '\\', 'OrdinalIgnoreCase') } | Stop-Process -Force"

export function createCanaryHost(deps: CanaryHostDeps): CanaryHost {
  const { run, env } = deps
  // The token is for `gh` only: the installer and PowerShell never see it.
  const withoutToken: Record<string, string | undefined> = Object.fromEntries(Object.entries(env).filter(([name]) => name !== 'GH_TOKEN' && name !== 'GITHUB_TOKEN'))
  const powershell = win32.join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const ask = (script: string, extra: Record<string, string>) => run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...withoutToken, ...extra } })
  const gh = createGhHost(run, process.cwd())

  return {
    publishedTags: () => createVerifyHost(run).publishedTags(),
    makeTempDir: async () => deps.makeDir(),
    removeTempDir: async (dir) => deps.removeDir(dir),
    download: (tag, names, dir) => gh.download(tag, names, dir),
    fileBytes: async (path) => deps.readFile(path),

    installDir() {
      const local = env['LOCALAPPDATA']
      if (!local) throw new Error('LOCALAPPDATA is not set: this runs on Windows')

      return win32.join(local, PRODUCT)
    },

    exists: (path) => deps.exists(path),

    async runInstaller(path) {
      return (await run(path, ['/S'], { env: withoutToken })).code
    },

    async fileVersion(exe) {
      const result = await ask(VERSION_SCRIPT, { CANARY_FILE: exe })
      const text = result.stdout.trim()

      return result.code === 0 && text !== '' ? text : undefined
    },

    startApp: (exe) => deps.spawnDetached(exe),

    async processes(installDir) {
      const result = await ask(PROCESSES_SCRIPT, { CANARY_INSTALL_DIR: installDir })
      if (result.code !== 0) throw new Error(`PowerShell could not list the processes: ${(result.stderr || result.stdout).trim().slice(0, 200)}`)
      const text = result.stdout.trim()

      return text === '' ? [] : (JSON.parse(text) as CanaryProcess[])
    },

    async stopApp(installDir) {
      await ask(STOP_SCRIPT, { CANARY_INSTALL_DIR: installDir })
    },

    async uninstall(installDir) {
      const uninstaller = win32.join(installDir, 'uninstall.exe')
      if (deps.exists(uninstaller)) await run(uninstaller, ['/S'], { env: withoutToken })
    },

    pause: (ms) => new Promise<void>((done) => setTimeout(done, ms)),
  }
}

/** The command line as a value, or a sentence saying what is wrong with it. It takes nothing: the canary decides what to install. */
export function parseReleaseCanaryArguments(args: readonly string[]): Record<string, never> | string {
  if (args.length > 0) return 'this command takes no arguments: it installs the release below the newest published one'

  return {}
}

if (isRunDirectly(import.meta.url)) {
  const parsed = parseReleaseCanaryArguments(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(`${parsed}\nUsage: npm run canary:install`)
    process.exit(1)
  }

  try {
    const host = createCanaryHost({
      run: nodeRunner,
      env: process.env,
      exists: existsSync,
      spawnDetached: (path) => spawn(path, [], { detached: true, stdio: 'ignore' }).unref(),
      readFile: (path) => readFileSync(path),
      makeDir: () => mkdtempSync(join(tmpdir(), 'canary-')),
      removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
    })
    const result = await releaseCanary({ platform: process.platform, githubActions: process.env['GITHUB_ACTIONS'] === 'true' }, host, (line) => console.log(`ok    ${line}`))
    for (const failure of result.failures) console.error(`FAIL  ${failure}`)
    if (result.failures.length > 0) {
      console.error(`The canary found ${result.failures.length} problem${result.failures.length === 1 ? '' : 's'}`)
      process.exit(1)
    }
    console.log('The previous release installs, starts and keeps answering')
  } catch (error) {
    console.error(reason(error))
    process.exit(1)
  }
}
