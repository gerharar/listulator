import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createCanaryHost, parseReleaseCanaryArguments, releaseCanary, type CanaryHost, type CanaryProcess } from './releaseCanary.js'
import type { Runner } from './releaseSign.js'

/**
 * `npm run canary:install` (31.9): once a day, on a GitHub Windows runner, the PREVIOUS published release is downloaded from GitHub,
 * checked against its `SHA256SUMS`, installed silently, started, and judged on three things: it says it is that version, it opens a window
 * that answers, and it keeps answering for a while. The production app cannot be driven from outside, so this is what can be seen of it.
 * It installs a program, so it refuses to run anywhere but a GitHub runner on Windows.
 */

const LATEST = 'v1.1.0'
const PREVIOUS = 'v1.0.2'
const PREVIOUS_VERSION = '1.0.2'
const INSTALLER = `Listulator_${PREVIOUS_VERSION}_x64-setup.exe`
const INSTALL_DIR = 'C:\\Users\\runneradmin\\AppData\\Local\\Listulator'
const EXE = `${INSTALL_DIR}\\listulator-desktop.exe`
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')

const installerBytes = Buffer.from('the previous installer'.repeat(50))
const sumsOf = (name: string, data: Buffer) => `${sha(data)}  ${name}\n${'1'.repeat(64)}  Listulator_${PREVIOUS_VERSION}_aarch64.dmg\n${'2'.repeat(64)}  Listulator.app.tar.gz\n`

const OPEN: CanaryProcess = { id: 4242, responding: true, hasWindow: true }
const NO_WINDOW_YET: CanaryProcess = { id: 4242, responding: true, hasWindow: false }

interface World {
  tags: string[]
  installerBytes: Buffer
  sums: string
  alreadyInstalled: boolean
  installerCode: number
  exeThere: boolean
  version: string | undefined
  /** What the app's processes look like at each look, one look per second; the last one repeats. */
  samples: CanaryProcess[][]
}

const world = (over: Partial<World> = {}): World => ({
  tags: ['v1.0.0', 'v1.0.1', PREVIOUS, LATEST],
  installerBytes,
  sums: sumsOf(INSTALLER, installerBytes),
  alreadyInstalled: false,
  installerCode: 0,
  exeThere: true,
  version: PREVIOUS_VERSION,
  samples: [[], [NO_WINDOW_YET], [OPEN]],
  ...over,
})

interface Fake {
  host: CanaryHost
  calls: string[]
  downloaded: { tag: string; names: string[] }[]
  pauses: number[]
}

function fake(w: World): Fake {
  const calls: string[] = []
  const downloaded: Fake['downloaded'] = []
  const pauses: number[] = []
  let looks = 0
  let installed = w.alreadyInstalled
  const host: CanaryHost = {
    publishedTags: async () => {
      calls.push('publishedTags')

      return w.tags
    },
    makeTempDir: async () => {
      calls.push('makeTempDir')

      return 'C:\\temp\\canary'
    },
    removeTempDir: async () => {
      calls.push('removeTempDir')
    },
    download: async (tag, names) => {
      calls.push('download')
      downloaded.push({ tag, names })
    },
    fileBytes: async (path) => (path.endsWith('SHA256SUMS') ? Buffer.from(w.sums) : w.installerBytes),
    installDir: () => INSTALL_DIR,
    exists: (path) => (path === INSTALL_DIR ? installed : path === EXE ? installed && w.exeThere : false),
    runInstaller: async () => {
      calls.push('install')
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
      const sample = w.samples[Math.min(looks++, w.samples.length - 1)]!

      return sample
    },
    stopApp: async () => {
      calls.push('stop')
    },
    uninstall: async () => {
      calls.push('uninstall')
    },
    pause: async (ms) => {
      pauses.push(ms)
    },
  }

  return { host, calls, downloaded, pauses }
}

async function canary(w: World, over: { platform?: NodeJS.Platform; githubActions?: boolean } = {}) {
  const f = fake(w)
  const log: string[] = []
  const result = await releaseCanary({ platform: over.platform ?? 'win32', githubActions: over.githubActions ?? true }, f.host, (line) => log.push(line))

  return { ...f, result, log }
}

describe('where it runs', () => {
  it.each([
    ['macOS', { platform: 'darwin' as const }],
    ['Linux', { platform: 'linux' as const }],
    ['a Windows machine that is not a GitHub runner', { githubActions: false }],
  ])('refuses on %s, before it does anything: it installs a program, and never on a machine of yours', async (_name, over) => {
    const f = fake(world())

    await expect(releaseCanary({ platform: 'win32', githubActions: true, ...over }, f.host, () => undefined)).rejects.toThrow(/GitHub (Windows )?runner/)
    expect(f.calls).toEqual([])
  })
})

describe('a previous release that installs and runs', () => {
  it('has no failures, and says what it saw', async () => {
    const { result, log } = await canary(world())

    expect(result.failures).toEqual([])
    const text = log.join('\n')
    expect(text).toMatch(/v1\.0\.2.*installed.*Listulator_1\.0\.2_x64-setup\.exe/)
    expect(text).toMatch(/sha256 .* matches SHA256SUMS/)
    expect(text).toMatch(/says it is 1\.0\.2/)
    expect(text).toMatch(/answered for 10 s/)
  })

  it('takes the release BELOW the newest one by version, never a release candidate or the newest itself', async () => {
    const { downloaded } = await canary(world({ tags: ['v1.0.1', LATEST, 'v1.1.0-rc.1', 'v1.0.2', 'v0.9.0'], version: '1.0.2' }))

    expect(downloaded).toEqual([{ tag: PREVIOUS, names: [INSTALLER, 'SHA256SUMS'] }])
  })

  it('does its steps in order, and ends with the app stopped, the program uninstalled and the folder removed', async () => {
    const { calls } = await canary(world())

    expect(calls.filter((call) => call !== 'look')).toEqual(['publishedTags', 'makeTempDir', 'download', 'install', 'fileVersion', 'start', 'stop', 'uninstall', 'removeTempDir'])
  })

  it('waits for the window, then watches the app for ten seconds, one look a second', async () => {
    const { calls, pauses } = await canary(world({ samples: [[], [NO_WINDOW_YET], [OPEN]] }))

    // Two looks to find it ready, then ten more of it staying up.
    expect(calls.filter((call) => call === 'look')).toHaveLength(2 + 1 + 10)
    expect(pauses.every((ms) => ms === 1000)).toBe(true)
  })

  it('accepts the four-part file version a Windows program carries (1.0.2.0 for 1.0.2)', async () => {
    const { result } = await canary(world({ version: '1.0.2.0' }))

    expect(result.failures).toEqual([])
  })
})

describe('when there is nothing to install', () => {
  it('says so, and is not a failure, when only one release is published', async () => {
    const { result, log, calls } = await canary(world({ tags: [LATEST] }))

    expect(result.failures).toEqual([])
    expect(log.join('\n')).toMatch(/only one release is published/i)
    expect(calls).toEqual(['publishedTags'])
  })

  it('fails when no release is published at all: a canary that finds nothing has found something', async () => {
    const { result } = await canary(world({ tags: [] }))

    expect(result.failures).toEqual([expect.stringMatching(/no published release/i)])
  })
})

describe('what fails, and that it still cleans up', () => {
  it('fails an installer whose bytes are not the ones SHA256SUMS lists, and installs nothing', async () => {
    const { result, calls } = await canary(world({ installerBytes: Buffer.from('a different installer') }))

    expect(result.failures).toEqual([expect.stringMatching(/Listulator_1\.0\.2_x64-setup\.exe does not match its checksum/)])
    expect(calls).not.toContain('install')
    expect(calls.at(-1)).toBe('removeTempDir')
  })

  it('fails a SHA256SUMS that does not list the installer', async () => {
    const { result, calls } = await canary(world({ sums: `${'1'.repeat(64)}  something-else.exe\n` }))

    expect(result.failures).toEqual([expect.stringMatching(/SHA256SUMS does not list Listulator_1\.0\.2_x64-setup\.exe/)])
    expect(calls).not.toContain('install')
  })

  it('refuses when the program is already installed: it never touches an install it did not make, and removes nothing', async () => {
    const { result, calls } = await canary(world({ alreadyInstalled: true }))

    expect(result.failures).toEqual([expect.stringMatching(/already installed.*never touches/)])
    expect(calls).not.toContain('install')
    expect(calls).not.toContain('stop')
    expect(calls).not.toContain('uninstall')
  })

  it('fails an installer that ends with an error, and still removes what it may have left', async () => {
    const { result, calls } = await canary(world({ installerCode: 2 }))

    expect(result.failures).toEqual([expect.stringMatching(/installer ended with 2/)])
    expect(calls).not.toContain('start')
    expect(calls).toEqual(expect.arrayContaining(['stop', 'uninstall', 'removeTempDir']))
  })

  it('fails when the program is not where the installer should have put it', async () => {
    const { result, calls } = await canary(world({ exeThere: false }))

    expect(result.failures).toEqual([expect.stringMatching(/listulator-desktop\.exe is not in/)])
    expect(calls).not.toContain('start')
  })

  it.each([
    ['another version', '1.0.1'],
    ['no version at all', undefined],
  ])('fails a program that carries %s', async (_name, version) => {
    const { result, calls } = await canary(world({ version }))

    expect(result.failures).toEqual([expect.stringMatching(/version/i)])
    expect(calls).not.toContain('start')
  })

  it('fails when no window opens that answers within a minute, having looked once a second', async () => {
    const { result, pauses } = await canary(world({ samples: [[]] }))

    expect(result.failures).toEqual([expect.stringMatching(/did not open a responding window within 60 s/)])
    expect(pauses.length).toBeGreaterThanOrEqual(59)
  })

  it('fails when the window opens but does not answer', async () => {
    const { result } = await canary(world({ samples: [[{ id: 1, responding: false, hasWindow: true }]] }))

    expect(result.failures).toEqual([expect.stringMatching(/did not open a responding window/)])
  })

  it('fails when the app stops answering while it is watched, and says after how long', async () => {
    const { result } = await canary(world({ samples: [[OPEN], [OPEN], [OPEN], [OPEN], [{ id: 4242, responding: false, hasWindow: true }]] }))

    expect(result.failures).toEqual([expect.stringMatching(/stopped responding after 4 s/)])
  })

  it('fails when the app ends while it is watched', async () => {
    const { result } = await canary(world({ samples: [[OPEN], [OPEN], []] }))

    expect(result.failures).toEqual([expect.stringMatching(/ended after 2 s/)])
  })

  it.each([
    ['everything works', {}],
    ['the checksum is wrong', { installerBytes: Buffer.from('x') }],
    ['the installer fails', { installerCode: 1 }],
    ['the version is wrong', { version: '9.9.9' }],
    ['no window opens', { samples: [[]] }],
    ['the app ends', { samples: [[OPEN], []] }],
  ])('always stops the app BEFORE uninstalling it, and removes its folder, when %s', async (_name, over) => {
    const { calls } = await canary(world(over))

    if (calls.includes('install')) {
      expect(calls.indexOf('stop')).toBeGreaterThan(-1)
      expect(calls.indexOf('stop')).toBeLessThan(calls.indexOf('uninstall'))
    }
    expect(calls.at(-1)).toBe('removeTempDir')
  })

  it('says every failure on one line', async () => {
    const { result } = await canary(world({ version: '1.0.1', samples: [[]] }))

    expect(result.failures.every((line) => !line.includes('\n'))).toBe(true)
  })
})

describe('the command line', () => {
  it('takes nothing', () => {
    expect(parseReleaseCanaryArguments([])).toEqual({})
  })

  it.each([['a tag', ['v1.0.2']], ['an option', ['--force']]])('refuses %s, in words: the canary decides what to install', (_name, args) => {
    expect(typeof parseReleaseCanaryArguments(args)).toBe('string')
  })
})

describe('the real commands, as they are run (no shell, no token for what does not need it)', () => {
  interface Call {
    command: string
    args: string[]
    options: { env?: Record<string, string | undefined>; cwd?: string } | undefined
  }

  function recorder(answer: (call: Call) => { code: number; stdout?: string; stderr?: string } = () => ({ code: 0 })) {
    const calls: Call[] = []
    const runner: Runner = async (command, args, options) => {
      const call = { command, args, options }
      calls.push(call)
      const { code, stdout = '', stderr = '' } = answer(call)

      return { code, stdout, stderr }
    }

    return { calls, runner }
  }

  const RUNNER_CREDENTIALS = { GH_TOKEN: 'ghs_not-a-real-token', GITHUB_TOKEN: 'ghs_other', ACTIONS_RUNTIME_TOKEN: 'runtime-not-real', ACTIONS_RESULTS_URL: 'https://results.invalid/', ACTIONS_CACHE_URL: 'https://cache.invalid/', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'id-not-real', GITHUB_ENV: 'C:\\runner\\env', RUNNER_TEMP: 'C:\\runner\\tmp', NODE_OPTIONS: '--require x.js', SOME_SECRET: 'nope' }
  const ENV = { LOCALAPPDATA: 'C:\\Users\\runneradmin\\AppData\\Local', APPDATA: 'C:\\Users\\runneradmin\\AppData\\Roaming', SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32', TEMP: 'C:\\Temp', ...RUNNER_CREDENTIALS }
  const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  /** The runner hands every step credentials that can write this repository's Actions cache and artifacts; a downloaded installer, an installed app and PowerShell have no use for them. */
  const expectNoRunnerCredentials = (env: Record<string, string | undefined> | undefined) => {
    expect(env).toBeDefined()
    expect(Object.keys(env!).filter((name) => /^(GH_|GITHUB_|ACTIONS_|RUNNER_|NODE_OPTIONS$)|TOKEN|SECRET/i.test(name))).toEqual([])
    expect(JSON.stringify(env)).not.toMatch(/ghs_|runtime-not-real|id-not-real|cache\.invalid|results\.invalid/)
  }
  const host = (runner: Runner, over: { exists?: (path: string) => boolean; spawned?: { path: string; env: Record<string, string | undefined> }[] } = {}) =>
    createCanaryHost({ run: runner, env: ENV, exists: over.exists ?? (() => true), spawnDetached: (path, env) => void over.spawned?.push({ path, env }), readFile: () => Buffer.from('bytes'), makeDir: () => 'C:\\temp\\canary', removeDir: () => undefined })

  it('puts the program where the NSIS installer puts it for the current user', () => {
    expect(host(recorder().runner).installDir()).toBe(INSTALL_DIR)
    expect(() => createCanaryHost({ run: recorder().runner, env: {}, exists: () => false, spawnDetached: () => undefined, readFile: () => Buffer.alloc(0), makeDir: () => '', removeDir: () => undefined }).installDir()).toThrow(/LOCALAPPDATA/)
  })

  it('lists the published stable releases from GitHub, and downloads exactly the files named from one release', async () => {
    const list = recorder(() => ({ code: 0, stdout: JSON.stringify([{ tagName: 'v1.1.0' }, { tagName: 'nightly' }]) }))
    expect(await host(list.runner).publishedTags()).toEqual(['v1.1.0'])
    expect(list.calls[0]).toMatchObject({ command: 'gh', args: ['release', 'list', '--repo', 'gerharar/listulator', '--exclude-drafts', '--exclude-pre-releases', '--limit', '100', '--json', 'tagName'] })

    const download = recorder()
    await host(download.runner).download(PREVIOUS, [INSTALLER, 'SHA256SUMS'], 'C:\\temp\\canary')
    expect(download.calls[0]!.args).toEqual(['release', 'download', PREVIOUS, '--repo', 'gerharar/listulator', '--dir', 'C:\\temp\\canary', '--pattern', INSTALLER, '--pattern', 'SHA256SUMS'])
  })

  it('runs the installer silently with nothing else, and hands it nothing of the runner’s credentials', async () => {
    const { calls, runner } = recorder()

    const code = await host(runner).runInstaller('C:\\temp\\canary\\setup.exe')

    expect(code).toBe(0)
    expect(calls[0]).toMatchObject({ command: 'C:\\temp\\canary\\setup.exe', args: ['/S'] })
    expect(calls[0]!.options?.env?.['LOCALAPPDATA']).toBe(ENV.LOCALAPPDATA)
    expectNoRunnerCredentials(calls[0]!.options?.env)
  })

  it('reads a program’s version and looks at its processes with the system’s own PowerShell by full path, the folder in the environment and not in the script, and none of the runner’s credentials', async () => {
    const version = recorder(() => ({ code: 0, stdout: '1.0.2.0\r\n' }))
    const looks = recorder(() => ({ code: 0, stdout: JSON.stringify([{ id: 7, responding: true, hasWindow: false }]) }))

    expect(await host(version.runner).fileVersion(EXE)).toBe('1.0.2.0')
    expect(await host(looks.runner).processes(INSTALL_DIR)).toEqual([{ id: 7, responding: true, hasWindow: false }])

    for (const { calls } of [version, looks]) {
      expect(calls[0]!.command).toBe(POWERSHELL)
      expect(calls[0]!.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
      expectNoRunnerCredentials(calls[0]!.options?.env)
    }
    expect(version.calls[0]!.options?.env?.['CANARY_FILE']).toBe(EXE)
    expect(looks.calls[0]!.options?.env?.['CANARY_INSTALL_DIR']).toBe(INSTALL_DIR)
    // Nothing a path could break out of: the folder and the file are never part of the script's text.
    expect(version.calls[0]!.args.join(' ')).not.toContain('Listulator')
    expect(looks.calls[0]!.args.join(' ')).not.toContain('Listulator')
  })

  it('reads no processes as an empty list, and a PowerShell that fails as a failure', async () => {
    expect(await host(recorder(() => ({ code: 0, stdout: '' })).runner).processes(INSTALL_DIR)).toEqual([])
    expect(await host(recorder(() => ({ code: 0, stdout: '[]' })).runner).processes(INSTALL_DIR)).toEqual([])
    await expect(host(recorder(() => ({ code: 1, stderr: 'boom' })).runner).processes(INSTALL_DIR)).rejects.toThrow(/boom/)
  })

  it('stops the app by its install PATH and by nothing else (a real Listulator may have the same file name), and uninstalls only if there is an uninstaller', async () => {
    const { calls, runner } = recorder()

    await host(runner).stopApp(INSTALL_DIR)
    await host(runner, { exists: () => true }).uninstall(INSTALL_DIR)
    await host(recorder().runner, { exists: () => false }).uninstall(INSTALL_DIR)

    expect(calls[0]!.command).toBe(POWERSHELL)
    expect(calls[0]!.args.join(' ')).toMatch(/StartsWith\(\$env:CANARY_INSTALL_DIR/)
    expect(calls[0]!.args.join(' ')).not.toMatch(/taskkill|\/IM|Stop-Process -Name/)
    expect(calls[1]).toMatchObject({ command: `${INSTALL_DIR}\\uninstall.exe`, args: ['/S'] })
  })

  it('starts the program detached, with an environment that holds none of the runner’s credentials either: it is the published program, and it runs next to them', () => {
    const spawned: { path: string; env: Record<string, string | undefined> }[] = []

    host(recorder().runner, { spawned }).startApp(EXE)

    expect(spawned.map((entry) => entry.path)).toEqual([EXE])
    expectNoRunnerCredentials(spawned[0]!.env)
    expect(spawned[0]!.env['LOCALAPPDATA']).toBe(ENV.LOCALAPPDATA)
  })

  it('keeps what Windows programs need (the system folders, the user’s folders, PATH) and nothing else of the environment', async () => {
    const { calls, runner } = recorder()

    await host(runner).runInstaller('C:\\temp\\canary\\setup.exe')

    expect(Object.keys(calls[0]!.options!.env!).sort()).toEqual(['APPDATA', 'LOCALAPPDATA', 'PATH', 'SystemRoot', 'TEMP'])
  })
})
