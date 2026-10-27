import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { CanaryProcess } from './releaseCanary.js'
import { createInstallCheckHost, parseReleaseInstallCheckArguments, releaseInstallCheck, type InstallCheckHost } from './releaseInstallCheck.js'
import type { Runner } from './releaseSign.js'

/**
 * `npm run release:install-check` (BL-120): in the Release run's Windows job, after the installer is built and before it is uploaded, the
 * installer is installed silently, started, and judged on three things: the program says it is the tagged version, it opens a window that
 * answers, and it keeps answering for a while. Then it is stopped and uninstalled. The bytes installed are the bytes that are uploaded,
 * attested and signed, in place and not a copy. It installs a program, so it refuses to run anywhere but a GitHub runner on Windows.
 */

const VERSION = '1.2.0'
const BUILT = `D:\\a\\listulator\\listulator\\apps\\desktop\\src-tauri\\target\\release\\bundle\\nsis\\Listulator_${VERSION}_x64-setup.exe`
const INSTALL_DIR = 'C:\\Users\\runneradmin\\AppData\\Local\\Listulator'
const EXE = `${INSTALL_DIR}\\listulator-desktop.exe`
const built = Buffer.from('the installer the build just made'.repeat(40))

const OPEN: CanaryProcess = { id: 4242, responding: true, hasWindow: true }
const NO_WINDOW_YET: CanaryProcess = { id: 4242, responding: true, hasWindow: false }

interface World {
  alreadyInstalled: boolean
  installerBuilt: boolean
  installerCode: number
  exeThere: boolean
  version: string | undefined
  /** What the app's processes look like at each look, one look per second; the last one repeats. */
  samples: CanaryProcess[][]
  uninstallFails: boolean
  /** The version in package.json. */
  packageVersion: string
}

const world = (over: Partial<World> = {}): World => ({
  alreadyInstalled: false,
  installerBuilt: true,
  installerCode: 0,
  exeThere: true,
  version: VERSION,
  samples: [[], [NO_WINDOW_YET], [OPEN]],
  uninstallFails: false,
  packageVersion: VERSION,
  ...over,
})

function fake(w: World) {
  const calls: string[] = []
  const installedFrom: string[] = []
  const pauses: number[] = []
  /** The fake clock: only a pause moves it. */
  let clock = 0
  let looks = 0
  let installed = w.alreadyInstalled
  const host: InstallCheckHost = {
    packageVersion: () => {
      calls.push('packageVersion')

      return w.packageVersion
    },
    builtInstaller: (version) => `D:\\a\\listulator\\listulator\\apps\\desktop\\src-tauri\\target\\release\\bundle\\nsis\\Listulator_${version}_x64-setup.exe`,
    fileBytes: async () => built,
    installDir: () => INSTALL_DIR,
    exists: (path) => (path === INSTALL_DIR ? installed : path === EXE ? installed && w.exeThere : path.endsWith('_x64-setup.exe') ? w.installerBuilt : false),
    runInstaller: async (path) => {
      calls.push('install')
      installedFrom.push(path)
      installed = true

      return w.installerCode
    },
    fileVersion: async () => {
      calls.push('fileVersion')

      return w.version
    },
    startApp: () => {
      calls.push('start')
    },
    processes: async () => {
      calls.push('look')

      return w.samples[Math.min(looks++, w.samples.length - 1)]!
    },
    stopApp: async () => {
      calls.push('stop')
    },
    uninstall: async () => {
      calls.push('uninstall')
      if (w.uninstallFails) throw new Error('the uninstaller crashed')
    },
    pause: async (ms) => {
      pauses.push(ms)
      clock += ms
    },
    now: () => clock,
  }

  return { host, calls, installedFrom, pauses }
}

async function check(w: World, over: { platform?: NodeJS.Platform; githubActions?: boolean } = {}) {
  const f = fake(w)
  const log: string[] = []
  const result = await releaseInstallCheck({ platform: over.platform ?? 'win32', githubActions: over.githubActions ?? true }, f.host, (line) => log.push(line))

  return { ...f, result, log }
}

describe('where it runs', () => {
  it.each([
    ['macOS', { platform: 'darwin' as const }],
    ['Linux', { platform: 'linux' as const }],
    ['a Windows machine that is not a GitHub runner', { githubActions: false }],
  ])('refuses on %s, before it does anything: it installs a program, and never on a machine of yours', async (_name, over) => {
    const f = fake(world())

    await expect(releaseInstallCheck({ platform: 'win32', githubActions: true, ...over }, f.host, () => undefined)).rejects.toThrow(/GitHub (Windows )?runner/)
    expect(f.calls).toEqual([])
  })
})

describe('an installer that installs and runs', () => {
  it('has no failures, and says what it saw, with the installer’s SHA-256 so it can be matched to the upload', async () => {
    const { result, log } = await check(world())

    expect(result.failures).toEqual([])
    const text = log.join('\n')
    expect(text).toContain(`sha256 ${createHash('sha256').update(built).digest('hex')}`)
    expect(text).toMatch(/v1\.2\.0.*installed.*Listulator_1\.2\.0_x64-setup\.exe/)
    expect(text).toMatch(/says it is 1\.2\.0/)
    expect(text).toMatch(/answered for 10 s/)
  })

  it('installs the file the build left, in place: the bytes tested are the bytes that are uploaded', async () => {
    const { installedFrom } = await check(world())

    expect(installedFrom).toEqual([BUILT])
  })

  it('does its steps in order, and ends with the app stopped and the program uninstalled', async () => {
    const { calls } = await check(world())

    expect(calls.filter((call) => call !== 'look')).toEqual(['packageVersion', 'install', 'fileVersion', 'start', 'stop', 'uninstall'])
  })

  it('waits for the window, then watches the app for ten seconds, one look a second', async () => {
    const { calls, pauses } = await check(world({ samples: [[], [NO_WINDOW_YET], [OPEN]] }))

    expect(calls.filter((call) => call === 'look')).toHaveLength(2 + 1 + 10)
    expect(pauses.every((ms) => ms === 1000)).toBe(true)
  })

  it('judges a pre-release on its three numbers, since how Windows writes the suffix is not known (1.2.0-rc.1 as 1.2.0.1)', async () => {
    const { result } = await check(world({ packageVersion: '1.2.0-rc.1', version: '1.2.0.1' }))

    expect(result.failures).toEqual([])
  })

  it('still refuses another version for a pre-release', async () => {
    const { result } = await check(world({ packageVersion: '1.2.0-rc.1', version: '1.1.1.0' }))

    expect(result.failures).toEqual([expect.stringMatching(/carries version 1\.1\.1\.0, not 1\.2\.0-rc\.1/)])
  })

  it('accepts the four-part file version a Windows program carries (1.2.0.0 for 1.2.0)', async () => {
    const { result } = await check(world({ version: '1.2.0.0' }))

    expect(result.failures).toEqual([])
  })
})

describe('what it refuses and what it reports', () => {
  it('refuses when the program is already installed: it never touches an install it did not make, and removes nothing', async () => {
    const { result, calls } = await check(world({ alreadyInstalled: true }))

    expect(result.failures).toEqual([expect.stringMatching(/already installed.*never touches/)])
    expect(calls).not.toContain('install')
    expect(calls).not.toContain('stop')
    expect(calls).not.toContain('uninstall')
  })

  it('fails, and installs nothing, when the build left no installer of the package.json version', async () => {
    const { result, calls } = await check(world({ installerBuilt: false }))

    expect(result.failures).toEqual([expect.stringMatching(/Listulator_1\.2\.0_x64-setup\.exe/)])
    expect(calls).not.toContain('install')
  })

  it.each([
    ['an installer that ends with an error', { installerCode: 2 }, /installer ended with 2/],
    ['an installer that leaves no program', { exeThere: false }, /listulator-desktop\.exe is not in .* after the installer ended/],
    ['a program that says it is another version', { version: '1.1.1.0' }, /carries version 1\.1\.1\.0, not 1\.2\.0/],
    ['a program that says nothing', { version: undefined }, /carries version none/],
    ['an app that never opens a window', { samples: [[NO_WINDOW_YET]] }, /did not open a responding window in 60 looks \(\d+ s\)/],
    ['an app that ends after its window opened', { samples: [[OPEN], [OPEN], []] }, /app ended after 2 s/],
    ['an app that stops responding', { samples: [[OPEN], [{ ...OPEN, responding: false }]] }, /stopped responding after 1 s/],
  ])('fails on %s, and still stops and uninstalls what it installed', async (_name, over, expected) => {
    const { result, calls } = await check(world(over))

    expect(result.failures.join(' | ')).toMatch(expected)
    expect(calls).toContain('uninstall')
    expect(calls[calls.length - 1]).toBe('uninstall')
  })

  it('reports an uninstall that fails as one more problem', async () => {
    const { result } = await check(world({ uninstallFails: true }))

    expect(result.failures).toEqual([expect.stringMatching(/uninstall failed: the uninstaller crashed/)])
  })
})

describe('the command line', () => {
  it('takes nothing: the build decides what is installed', () => {
    expect(parseReleaseInstallCheckArguments([])).toEqual({})
    expect(parseReleaseInstallCheckArguments(['--installer', 'x.exe'])).toMatch(/takes no arguments/)
  })
})

describe('the real host', () => {
  const recorder = () => {
    const calls: { command: string; args: readonly string[] }[] = []
    const runner: Runner = async (command, args) => {
      calls.push({ command, args })

      return { code: 0, stdout: '', stderr: '' }
    }

    return { calls, runner }
  }
  const host = (files: Record<string, string>) =>
    createInstallCheckHost({
      run: recorder().runner,
      env: { LOCALAPPDATA: 'C:\\Users\\runneradmin\\AppData\\Local' },
      exists: () => true,
      spawnDetached: () => undefined,
      readFile: (path) => Buffer.from(files[path] ?? ''),
      makeDir: () => '',
      removeDir: () => undefined,
      root: 'D:\\a\\listulator\\listulator',
    })

  it('reads the version from the checkout’s package.json and names the installer the build leaves for it', () => {
    const h = host({ 'D:\\a\\listulator\\listulator\\package.json': JSON.stringify({ name: 'listulator', version: VERSION }) })

    expect(h.packageVersion()).toBe(VERSION)
    expect(h.builtInstaller(VERSION)).toBe(BUILT)
  })

  it('refuses a package.json with no usable version', () => {
    const h = host({ 'D:\\a\\listulator\\listulator\\package.json': JSON.stringify({ version: '1.2' }) })

    expect(() => h.packageVersion()).toThrow(/version/)
  })
})
