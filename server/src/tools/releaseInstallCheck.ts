import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { win32 } from 'node:path'
import { alreadyInstalledProblem, createProgramHost, installAndWatch, type CanaryHostDeps, type ProgramHost } from './releaseCanary.js'
import { nodeRunner } from './releaseSign.js'
import { isRunDirectly } from './runDirectly.js'
import { reason } from './toolText.js'

/**
 * `npm run release:install-check` (BL-120): in the Release run's Windows job, after the installer is built and before it is uploaded, the
 * installer the build just made is installed silently, started, and judged on three things: the program says it is the version of
 * package.json (the job has already checked that this is the tag's), it opens a window that answers, and it keeps answering for ten seconds.
 * Then the app is stopped (by its install path, never by name) and uninstalled. A release whose installer does not install, or whose app does
 * not start, stops the run before any draft exists. It is the daily canary's check (`canary:install`, 31.9) on the new release instead of the
 * previous one, and shares its code.
 *
 * It installs the file in place, not a copy: the bytes it tries are the bytes that are uploaded, attested and signed. Its SHA-256 is in the log
 * to match against the build's listing. Nothing here is downloaded, so there is no checksum or signature to check: the build job's own
 * signature on it is a throw-away one that is never uploaded. It holds no token and no key, and the installer, the app and PowerShell are
 * given only the system's own variables (see `createProgramHost`).
 *
 * It installs a program, so it runs only on a GitHub runner on Windows, and refuses when the program is already installed: it never touches an
 * install it did not make.
 */

/** What the check needs besides the machine and the program: which version the checkout is, and where the build leaves its installer. */
export interface InstallCheckHost extends ProgramHost {
  /** The version in the checkout's package.json. */
  packageVersion(): string
  /** Where the build leaves the Windows installer of this version. */
  builtInstaller(version: string): string
  fileBytes(path: string): Promise<Buffer>
}

export interface ReleaseInstallCheckOptions {
  platform: NodeJS.Platform
  /** Running on a GitHub Actions runner (`GITHUB_ACTIONS=true`). */
  githubActions: boolean
}

export interface ReleaseInstallCheckResult {
  /** One sentence per thing that is wrong; empty when the installer installs, starts and keeps answering. */
  failures: string[]
}

export async function releaseInstallCheck(options: ReleaseInstallCheckOptions, host: InstallCheckHost, log: (line: string) => void): Promise<ReleaseInstallCheckResult> {
  if (options.platform !== 'win32' || !options.githubActions) {
    throw new Error('release:install-check installs a program: it runs only on a GitHub Windows runner, never on a machine of yours')
  }
  const failures: string[] = []
  const fail = (line: string) => void failures.push(line.replace(/\s+/g, ' ').trim().slice(0, 400))

  const alreadyThere = alreadyInstalledProblem(host)
  if (alreadyThere !== undefined) {
    fail(alreadyThere)

    return { failures }
  }

  const version = host.packageVersion()
  const installer = host.builtInstaller(version)
  if (!host.exists(installer)) {
    fail(`The build left no ${win32.basename(installer)} to install`)

    return { failures }
  }
  log(`${win32.basename(installer)}  sha256 ${createHash('sha256').update(await host.fileBytes(installer)).digest('hex')} (the file that is uploaded, installed in place)`)

  await installAndWatch(host, installer, version, log, fail)

  return { failures }
}

/** What the real host reads: the same as the canary's, and the folder of the checkout. */
export interface InstallCheckHostDeps extends CanaryHostDeps {
  root: string
}

export function createInstallCheckHost(deps: InstallCheckHostDeps): InstallCheckHost {
  return {
    ...createProgramHost(deps),

    packageVersion() {
      const version = (JSON.parse(deps.readFile(win32.join(deps.root, 'package.json')).toString('utf8')) as { version?: unknown }).version
      if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`package.json has no usable version: ${JSON.stringify(version)}`)

      return version
    },

    builtInstaller: (version) => win32.join(deps.root, 'apps', 'desktop', 'src-tauri', 'target', 'release', 'bundle', 'nsis', `Listulator_${version}_x64-setup.exe`),

    fileBytes: async (path) => deps.readFile(path),
  }
}

/** The command line as a value, or a sentence saying what is wrong with it. It takes nothing: the build decides what is installed. */
export function parseReleaseInstallCheckArguments(args: readonly string[]): Record<string, never> | string {
  if (args.length > 0) return 'this command takes no arguments: it installs the installer the build just made'

  return {}
}

if (isRunDirectly(import.meta.url)) {
  const parsed = parseReleaseInstallCheckArguments(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(`${parsed}\nUsage: npm run release:install-check`)
    process.exit(1)
  }

  try {
    const host = createInstallCheckHost({
      run: nodeRunner,
      env: process.env,
      exists: existsSync,
      spawnDetached: (path, env, cwd) => spawn(path, [], { detached: true, stdio: 'ignore', env, cwd }).unref(),
      readFile: (path) => readFileSync(path),
      makeDir: () => {
        throw new Error('release:install-check makes no folder')
      },
      removeDir: () => undefined,
      root: process.cwd(),
    })
    const result = await releaseInstallCheck({ platform: process.platform, githubActions: process.env['GITHUB_ACTIONS'] === 'true' }, host, (line) => console.log(`ok    ${line}`))
    for (const failure of result.failures) console.error(`FAIL  ${failure}`)
    if (result.failures.length > 0) {
      console.error(`The installer check found ${result.failures.length} problem${result.failures.length === 1 ? '' : 's'}`)
      process.exit(1)
    }
    console.log('The installer installs, starts and keeps answering')
  } catch (error) {
    console.error(reason(error))
    process.exit(1)
  }
}
