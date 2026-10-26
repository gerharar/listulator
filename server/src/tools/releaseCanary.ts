import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { KEY_ROTATION_PATH, declaredSignerOf } from './keyRotation.js'
import { verifyMinisign } from './minisignVerify.js'
import { createGhHost, nodeRunner, parseSums, type Runner } from './releaseSign.js'
import { createVerifyHost } from './releaseVerify.js'
import { isRunDirectly } from './runDirectly.js'
import { isStableTag, reason } from './toolText.js'
import { compareVersions, parseSignature } from './updateManifest.js'

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
 * Before the installer is RUN it must carry the owner's signature: the one `latest.json` of that release holds for it, made with the
 * updater key that never leaves the owner's machine, checked against the key that release's own config carries. A checksum from the same
 * release is not enough: whoever can write release assets can replace the installer and `SHA256SUMS` together.
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
  /** `plugins.updater.pubkey` as written in a tag's config on GitHub. */
  pubkey(tag: string): Promise<string>
  /** The text of the bridge declaration (`keyRotation.json`) in a tag's tree on GitHub, or undefined when that tree has no such file. */
  keyRotation(tag: string): Promise<string | undefined>
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

/**
 * Whether a program's file version is the release's. A stable release is exactly its three numbers (1.2.0 as 1.2.0.0). A pre-release (1.2.0-rc.1)
 * is judged on its three numbers alone: how Windows writes the suffix into a file version is not something this has seen.
 */
const isVersionOf = (fileVersion: string, version: string): boolean => {
  const said = fileVersion.trim()
  const core = version.replace(/-.*$/, '')

  return core === version ? releaseVersionOf(said) === version : said === version || said.startsWith(`${core}.`)
}

/**
 * The release whose key signed `previous`'s installer: its own, or for a bridge release of a key rotation the older one its tree declares (BL-141),
 * or why that cannot be said. A declaration that is wrong or cannot be read is a problem and never guessed around.
 */
async function signerOf(host: CanaryHost, previous: string): Promise<{ signer: string } | { problem: string }> {
  try {
    const declared = declaredSignerOf(await host.keyRotation(previous), previous)

    return 'problem' in declared ? declared : { signer: declared.from ?? previous }
  } catch (error) {
    return { problem: `${KEY_ROTATION_PATH} of ${previous} could not be read: ${reason(error)}` }
  }
}

/** Why the installer is not the owner's, or undefined when its signature verifies against the key of `signer` (the release itself, or the older one a bridge release declares). */
async function installerSignatureProblem(host: CanaryHost, previous: string, signer: string, installer: string, installerBytes: Buffer, manifestBytes: Buffer): Promise<string | undefined> {
  let manifest: unknown
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'))
  } catch {
    return `latest.json of ${previous} is not JSON`
  }
  const signature = (manifest as { platforms?: Record<string, { signature?: unknown } | undefined> } | null)?.platforms?.['windows-x86_64']?.signature
  if (typeof signature !== 'string') return `latest.json of ${previous} carries no signature for the Windows installer`
  const parsed = parseSignature(signature)
  if (typeof parsed === 'string') return `The signature in latest.json of ${previous} ${parsed}`
  if (parsed.file !== installer || parsed.version !== previous.slice(1)) return `The signature in latest.json of ${previous} covers ${parsed.file} at version ${parsed.version}, not ${installer} at ${previous.slice(1)}`
  let key: string
  try {
    key = await host.pubkey(signer)
  } catch (error) {
    return `The updater public key of ${signer} could not be read: ${reason(error)}`
  }
  const verdict = verifyMinisign(key, signature, installerBytes)

  return verdict.ok ? undefined : `${installer} does not carry a signature of the key of ${signer}: ${verdict.reason}`
}

/** What both smoke tests need of the machine and the program; the canary adds GitHub to it. */
export type ProgramHost = Pick<CanaryHost, 'installDir' | 'exists' | 'runInstaller' | 'fileVersion' | 'startApp' | 'processes' | 'stopApp' | 'uninstall' | 'pause'>

/** Why a smoke test must not go on, or undefined: it never touches an install it did not make. */
export function alreadyInstalledProblem(host: Pick<ProgramHost, 'installDir' | 'exists'>): string | undefined {
  const installDir = host.installDir()

  return host.exists(installDir) ? `${PRODUCT} is already installed at ${installDir}: this check never touches an install it did not make` : undefined
}

/**
 * What both smoke tests do with an installer: installs it silently, says what version the program is, starts it, waits for a window that
 * answers and watches it keep answering. Then, whatever happened, stops the app (by its install path), uninstalls it. Every problem goes to
 * `fail`, one sentence each; it stops at the first one on the way in, and an uninstall that fails is one more.
 */
export async function installAndWatch(host: ProgramHost, installer: string, version: string, log: (line: string) => void, fail: (line: string) => void): Promise<void> {
  const installDir = host.installDir()
  const exe = win32.join(installDir, APP_EXE)
  let installed = false
  let started = false
  try {
    // 1. Installed silently, as a user would from the download.
    installed = true
    const code = await host.runInstaller(installer)
    if (code !== 0) return fail(`The installer ended with ${code}`)
    if (!host.exists(exe)) return fail(`${APP_EXE} is not in ${installDir} after the installer ended`)
    log(`${PRODUCT} v${version} installed from ${win32.basename(installer)}`)

    // 2. It says what it is.
    const said = await host.fileVersion(exe)
    if (said === undefined || !isVersionOf(said, version)) return fail(`The installed program carries version ${said ?? 'none'}, not ${version}`)
    log(`The installed program says it is ${version}`)

    // 3. It starts, opens a window that answers, and keeps answering.
    host.startApp(exe)
    started = true
    let ready = false
    for (let second = 0; second < START_TIMEOUT_S && !ready; second++) {
      ready = (await host.processes(installDir)).some((process) => process.hasWindow && process.responding)
      if (!ready && second < START_TIMEOUT_S - 1) await host.pause(POLL_MS)
    }
    if (!ready) return fail(`The app did not open a responding window within ${START_TIMEOUT_S} s`)
    for (let second = 1; second <= STAY_UP_S; second++) {
      await host.pause(POLL_MS)
      const running = await host.processes(installDir)
      if (running.length === 0) return fail(`The app ended after ${second} s`)
      if (!running.some((process) => process.responding)) return fail(`The app stopped responding after ${second} s`)
    }
    log(`The app opened a window that answers, and answered for ${STAY_UP_S} s`)
  } catch (error) {
    fail(`Stopped: ${reason(error)}`)
  } finally {
    // The app is stopped first (so the uninstaller finds nothing running), then uninstalled.
    if (started || installed) await host.stopApp(installDir).catch(() => undefined)
    if (installed) await host.uninstall(installDir).catch((error: unknown) => fail(`The uninstall failed: ${reason(error)}`))
  }
}

export async function releaseCanary(options: ReleaseCanaryOptions, host: CanaryHost, log: (line: string) => void): Promise<ReleaseCanaryResult> {
  if (options.platform !== 'win32' || !options.githubActions) {
    throw new Error('canary:install installs a program: it runs only on a GitHub Windows runner, never on a machine of yours')
  }
  const failures: string[] = []
  const fail = (line: string) => failures.push(line.replace(/\s+/g, ' ').trim().slice(0, 400))
  /** Reports why it stops, and stops. */
  const stop = (line: string): ReleaseCanaryResult => {
    fail(line)

    return { failures }
  }

  const published = (await host.publishedTags()).filter(isStableTag).sort((a, b) => compareVersions(b.slice(1), a.slice(1)))
  const latest = published[0]
  if (latest === undefined) {
    return stop('There is no published release to check')
  }
  const previous = published[1]
  if (previous === undefined) {
    log('Only one release is published: there is no previous release to install')

    return { failures }
  }
  const version = previous.slice(1)
  const installer = `Listulator_${version}_x64-setup.exe`
  const alreadyThere = alreadyInstalledProblem(host)
  if (alreadyThere !== undefined) {
    return stop(alreadyThere)
  }

  const dir = await host.makeTempDir()
  try {
    // 1. The installer, as GitHub serves it, against the checksums of the same release.
    await host.download(previous, [installer, 'SHA256SUMS', 'latest.json'], dir)
    const sums = parseSums((await host.fileBytes(win32.join(dir, 'SHA256SUMS'))).toString('utf8'))
    const wanted = sums?.get(installer)
    if (wanted === undefined) {
      return stop(`SHA256SUMS does not list ${installer}`)
    }
    const bytes = await host.fileBytes(win32.join(dir, installer))
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== wanted) {
      return stop(`${installer} does not match its checksum in SHA256SUMS`)
    }
    log(`${installer}  sha256 ${actual} matches SHA256SUMS`)

    // 1b. And it must be the owner's: the checksum list came from the same place as the installer, the signature did not.
    const signer = await signerOf(host, previous)
    if ('problem' in signer) {
      return stop(signer.problem)
    }
    const problem = await installerSignatureProblem(host, previous, signer.signer, installer, bytes, await host.fileBytes(win32.join(dir, 'latest.json')))
    if (problem !== undefined) {
      return stop(problem)
    }
    log(`${installer}  signature verifies against the key of ${signer.signer}${signer.signer === previous ? '' : ` (${previous} is a bridge release of a key rotation, declared in its own tree)`} (the updater key, which never leaves the owner's machine)`)

    // 2 to 4. Installed, said, started, watched, stopped and uninstalled.
    await installAndWatch(host, win32.join(dir, installer), version, log, fail)

    return { failures }
  } catch (error) {
    return stop(`Stopped: ${reason(error)}`)
  } finally {
    await host.removeTempDir(dir).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The real GitHub CLI, installer and PowerShell

export interface CanaryHostDeps {
  run: Runner
  env: Record<string, string | undefined>
  exists: (path: string) => boolean
  /** Starts a program detached, with exactly this environment. */
  spawnDetached: (path: string, env: Record<string, string | undefined>, cwd: string) => void
  readFile: (path: string) => Buffer
  makeDir: () => string
  removeDir: (dir: string) => void
}

/** What PowerShell is asked: the folder or the file comes in through the environment, never into the text of a script. */
const VERSION_SCRIPT = '(Get-Item -LiteralPath $env:CANARY_FILE).VersionInfo.ProductVersion'
const PROCESSES_SCRIPT =
  "$dir = $env:CANARY_INSTALL_DIR + '\\'; $found = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dir, 'OrdinalIgnoreCase') } | ForEach-Object { [pscustomobject]@{ id = $_.Id; responding = [bool]$_.Responding; hasWindow = ($_.MainWindowHandle -ne 0) } }); ConvertTo-Json -InputObject $found -Compress"
const STOP_SCRIPT = "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($env:CANARY_INSTALL_DIR + '\\', 'OrdinalIgnoreCase') } | Stop-Process -Force"

/**
 * What a Windows program needs of the environment: the system and user folders, PATH, the machine's and the user's names. A GitHub runner
 * hands every step more (credentials that can write this repository's Actions cache and artifacts, the file that sets variables for later
 * steps), and the installer, the app it installs and PowerShell have no use for any of it: an installer from a release is code the owner
 * published, but the day a release is not, it must not be code that runs NEXT TO those credentials. A list of what is passed, not of what is
 * withheld: a variable nobody thought of is withheld too. (Names are case-insensitive on Windows.)
 */
const PROGRAM_ENVIRONMENT = new Set(
  ['ALLUSERSPROFILE', 'APPDATA', 'COMPUTERNAME', 'ComSpec', 'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'NUMBER_OF_PROCESSORS', 'OS', 'PATH', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'PUBLIC', 'SystemDrive', 'SystemRoot', 'TEMP', 'TMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'windir'].map((name) => name.toLowerCase()),
)

/** The machine and the program (install, version, start, look, stop, uninstall), as the real Windows runner does them. */
export function createProgramHost(deps: CanaryHostDeps): ProgramHost {
  const { run, env } = deps
  // Everything the installer, the app and PowerShell are given is this list, never the whole environment (and never the token).
  const programEnvironment: Record<string, string | undefined> = Object.fromEntries(Object.entries(env).filter(([name]) => PROGRAM_ENVIRONMENT.has(name.toLowerCase())))
  const powershell = win32.join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const ask = (script: string, extra: Record<string, string>) => run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...programEnvironment, ...extra } })

  return {
    installDir() {
      const local = env['LOCALAPPDATA']
      if (!local) throw new Error('LOCALAPPDATA is not set: this runs on Windows')

      return win32.join(local, PRODUCT)
    },

    exists: (path) => deps.exists(path),

    async runInstaller(path) {
      // In the folder the installer is in, not in the checkout: nothing of the workspace is on its search path.
      return (await run(path, ['/S'], { env: programEnvironment, cwd: win32.dirname(path) })).code
    },

    async fileVersion(exe) {
      const result = await ask(VERSION_SCRIPT, { CANARY_FILE: exe })
      const text = result.stdout.trim()

      return result.code === 0 && text !== '' ? text : undefined
    },

    startApp: (exe) => deps.spawnDetached(exe, programEnvironment, win32.dirname(exe)),

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
      // `_?=<folder>` last: without it an NSIS uninstaller copies itself away, starts the copy and ends at once, and nothing waits for the uninstall.
      if (deps.exists(uninstaller)) await run(uninstaller, ['/S', `_?=${installDir}`], { env: programEnvironment, cwd: installDir })
    },

    pause: (ms) => new Promise<void>((done) => setTimeout(done, ms)),
  }
}

export function createCanaryHost(deps: CanaryHostDeps): CanaryHost {
  const { run } = deps
  // The token is for `gh` only (it gets the whole environment, the token in it): the program gets the list above.
  const gh = createGhHost(run, process.cwd())

  return {
    ...createProgramHost(deps),
    publishedTags: () => createVerifyHost(run).publishedTags(),
    makeTempDir: async () => deps.makeDir(),
    removeTempDir: async (dir) => deps.removeDir(dir),
    download: (tag, names, dir) => gh.download(tag, names, dir),
    fileBytes: async (path) => deps.readFile(path),
    pubkey: (tag) => createVerifyHost(run).pubkey(tag),
    keyRotation: (tag) => createVerifyHost(run).keyRotation(tag),
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
      spawnDetached: (path, env, cwd) => spawn(path, [], { detached: true, stdio: 'ignore', env, cwd }).unref(),
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
