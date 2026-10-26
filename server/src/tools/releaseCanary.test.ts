import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { makeKeyPair, signLikeTauri } from './minisignTesting.js'
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
const owner = makeKeyPair('738FF42772526511')
const stranger = makeKeyPair('61BCBF5980E87475')
/** The `latest.json` of a release, with the Windows installer's signature as the release pipeline and `release:sign` write it. */
const manifestOf = (signature: string | undefined) => Buffer.from(JSON.stringify({ version: PREVIOUS_VERSION, pub_date: '2026-10-14T00:00:00Z', platforms: { 'windows-x86_64': { signature, url: 'https://x' }, 'darwin-aarch64': { signature: 'x', url: 'https://y' } } }))
const signatureOf = (key: ReturnType<typeof makeKeyPair>, bytes: Buffer, file = INSTALLER, version = PREVIOUS_VERSION) => signLikeTauri(key.privateKey, key.keyIdBytes, bytes, `timestamp:1791992704\tfile:${file}\tversion:${version}`)
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
  /** The `latest.json` of the previous release as GitHub serves it. */
  manifest: Buffer
  /** The updater key that release's config carries, or the error reading it fails with. */
  configKey: string | Error
  /** The text of the bridge declaration (`keyRotation.json`) in each tag's tree, or the error reading it fails with; a tag with no entry has no such file. */
  rotation?: Record<string, string | Error>
  /** The key of an OLDER release's config, which a declared bridge release names. */
  olderKey?: { tag: string; key: string | Error }
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
  manifest: manifestOf(signatureOf(owner, installerBytes)),
  configKey: owner.pubkey,
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
    fileBytes: async (path) => (path.endsWith('SHA256SUMS') ? Buffer.from(w.sums) : path.endsWith('latest.json') ? w.manifest : w.installerBytes),
    keyRotation: async (tag) => {
      calls.push('keyRotation')
      const text = w.rotation?.[tag]
      if (text instanceof Error) throw text

      return text
    },
    pubkey: async (tag) => {
      calls.push('pubkey')
      if (w.olderKey !== undefined && tag === w.olderKey.tag) {
        if (w.olderKey.key instanceof Error) throw w.olderKey.key

        return w.olderKey.key
      }
      // Only the previous release's config is the one an installer of it was signed for: no other release's key is on offer.
      if (tag !== PREVIOUS) throw new Error(`No updater key is known for ${tag}`)
      if (w.configKey instanceof Error) throw w.configKey

      return w.configKey
    },
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
    expect(text).toMatch(/signature verifies against the key of v1\.0\.2/)
    expect(text).toMatch(/says it is 1\.0\.2/)
    expect(text).toMatch(/answered for 10 s/)
  })

  it('takes the release BELOW the newest one by version, never a release candidate or the newest itself', async () => {
    const { downloaded } = await canary(world({ tags: ['v1.0.1', LATEST, 'v1.1.0-rc.1', 'v1.0.2', 'v0.9.0'], version: '1.0.2' }))

    expect(downloaded).toEqual([{ tag: PREVIOUS, names: [INSTALLER, 'SHA256SUMS', 'latest.json'] }])
  })

  it('does its steps in order, and ends with the app stopped, the program uninstalled and the folder removed', async () => {
    const { calls } = await canary(world())

    expect(calls.filter((call) => call !== 'look')).toEqual(['publishedTags', 'makeTempDir', 'download', 'keyRotation', 'pubkey', 'install', 'fileVersion', 'start', 'stop', 'uninstall', 'removeTempDir'])
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

describe('a previous release that is a bridge of a key rotation (BL-141): signed with the older key, carrying the new one', () => {
  // The bridge release's installer is signed with the key the OLDER release's apps trust; its own config already carries the new key. Its tree
  // declares which older release that is, and the canary judges the installer against that key and no other.
  const OLDER = 'v1.0.1'
  const declare = (from = OLDER) => JSON.stringify({ bridges: { [PREVIOUS]: { signedWithKeyOf: from } } })
  const bridge = (over: Partial<World> = {}) => world({ configKey: stranger.pubkey, olderKey: { tag: OLDER, key: owner.pubkey }, rotation: { [PREVIOUS]: declare() }, ...over })

  it('installs and runs it when the installer carries the declared older key’s signature', async () => {
    const { result, log, calls } = await canary(bridge())

    expect(result.failures).toEqual([])
    expect(log.join('\n')).toMatch(/signature verifies against the key of v1\.0\.1.*bridge/)
    expect(calls.filter((call) => call === 'pubkey')).toHaveLength(1)
  })

  it('fails, and runs nothing, when the installer carries only the new key’s signature', async () => {
    const { result, calls } = await canary(bridge({ manifest: manifestOf(signatureOf(stranger, installerBytes)) }))

    expect(result.failures).toEqual([expect.stringMatching(/does not carry a signature of the key of v1\.0\.1/)])
    expect(calls).not.toContain('install')
  })

  it('fails without the declaration: the older key is not guessed', async () => {
    const { result, calls } = await canary(bridge({ rotation: {} }))

    expect(result.failures).toEqual([expect.stringMatching(/does not carry a signature of the key of v1\.0\.2/)])
    expect(calls).not.toContain('install')
  })

  it.each([
    ['a declaration that is wrong', { rotation: { [PREVIOUS]: 'nope' } }, /not JSON/],
    ['a declaration that cannot be read', { rotation: { [PREVIOUS]: new Error('gh could not read the file') } }, /could not be read.*gh could not read the file/],
    ['a declared key that cannot be read', { olderKey: { tag: OLDER, key: new Error('no config') } }, /public key of v1\.0\.1 could not be read/],
  ])('fails in words on %s, and installs nothing', async (_name, over, expected) => {
    const { result, calls } = await canary(bridge(over as Partial<World>))

    expect(result.failures.join(' | ')).toMatch(expected)
    expect(calls).not.toContain('install')
  })

  it('leaves a release that is not declared exactly as it was: the entry of another bridge changes nothing', async () => {
    const { result } = await canary(world({ rotation: { [PREVIOUS]: JSON.stringify({ bridges: { 'v1.0.9': { signedWithKeyOf: OLDER } } }) } }))

    expect(result.failures).toEqual([])
  })
})

describe('the installer must carry the OWNER’S signature before it is run (a checksum from the same release is not enough)', () => {
  // Anyone who can write release assets can replace the installer and SHA256SUMS together. The key that signs the update files never leaves
  // the owner's machine, so a signature of it over THIS file is what makes the program one the owner published.
  it('checks the signature before it installs, against the key that release’s own config carries', async () => {
    const { calls, result } = await canary(world())

    expect(result.failures).toEqual([])
    expect(calls.indexOf('pubkey')).toBeGreaterThan(calls.indexOf('download'))
    expect(calls.indexOf('pubkey')).toBeLessThan(calls.indexOf('install'))
  })

  it.each([
    ['an installer someone replaced after it was signed (the checksum list was replaced with it)', { installerBytes: Buffer.from('a replaced installer'), sums: sumsOf(INSTALLER, Buffer.from('a replaced installer')) }, /does not carry a signature of the key of v1\.0\.2/],
    ['a signature made with another key', { manifest: manifestOf(signatureOf(stranger, installerBytes)) }, /does not carry a signature of the key of v1\.0\.2/],
    ['a release whose config names another key than the one that signed', { configKey: stranger.pubkey }, /does not carry a signature of the key of v1\.0\.2/],
    ['a signature over another file', { manifest: manifestOf(signatureOf(owner, installerBytes, 'Listulator.app.tar.gz')) }, /covers Listulator\.app\.tar\.gz.*not Listulator_1\.0\.2_x64-setup\.exe/],
    ['a signature bound to another version', { manifest: manifestOf(signatureOf(owner, installerBytes, INSTALLER, '9.9.9')) }, /covers .* at version 9\.9\.9, not .* at 1\.0\.2/],
    ['a latest.json that is not JSON', { manifest: Buffer.from('<html>Not Found</html>') }, /latest\.json of v1\.0\.2 is not JSON/],
    ['a latest.json with no Windows signature', { manifest: manifestOf(undefined) }, /no signature for the Windows installer/],
    ['a signature that is not a signature', { manifest: manifestOf('not base64 at all') }, /signature in latest\.json of v1\.0\.2/],
    ['an updater key that cannot be read', { configKey: new Error('gh: HTTP 404') }, /public key of v1\.0\.2 could not be read.*404/],
  ])('refuses %s, and installs nothing', async (_name, over, expected) => {
    const { result, calls } = await canary(world(over))

    expect(result.failures).toEqual([expect.stringMatching(expected)])
    expect(calls).not.toContain('install')
    expect(calls).not.toContain('start')
    expect(calls).not.toContain('stop')
    expect(calls).not.toContain('uninstall')
    expect(calls.at(-1)).toBe('removeTempDir')
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
  const host = (runner: Runner, over: { exists?: (path: string) => boolean; spawned?: { path: string; env: Record<string, string | undefined>; cwd: string }[] } = {}) =>
    createCanaryHost({ run: runner, env: ENV, exists: over.exists ?? (() => true), spawnDetached: (path, env, cwd) => void over.spawned?.push({ path, env, cwd }), readFile: () => Buffer.from('bytes'), makeDir: () => 'C:\\temp\\canary', removeDir: () => undefined })

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
    // In the folder it was downloaded to, not in the checkout: nothing of the workspace is on its search path.
    expect(calls[0]!.options?.cwd).toBe('C:\\temp\\canary')
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
    // `_?=<folder>` last: without it an NSIS uninstaller copies itself away, starts the copy and ends at once, so nothing waits for the uninstall.
    expect(calls[1]).toMatchObject({ command: `${INSTALL_DIR}\\uninstall.exe`, args: ['/S', `_?=${INSTALL_DIR}`] })
  })

  it('starts the program detached, with an environment that holds none of the runner’s credentials either: it is the published program, and it runs next to them', () => {
    const spawned: { path: string; env: Record<string, string | undefined>; cwd: string }[] = []

    host(recorder().runner, { spawned }).startApp(EXE)

    expect(spawned.map((entry) => entry.path)).toEqual([EXE])
    expectNoRunnerCredentials(spawned[0]!.env)
    expect(spawned[0]!.env['LOCALAPPDATA']).toBe(ENV.LOCALAPPDATA)
    // From its own folder, not from the checkout.
    expect(spawned[0]!.cwd).toBe(INSTALL_DIR)
  })

  it('reads the updater key of a release from its config on GitHub, as release:verify does', async () => {
    const config = JSON.stringify({ plugins: { updater: { pubkey: owner.pubkey, endpoints: ['x'] } } })
    const { calls, runner } = recorder(() => ({ code: 0, stdout: config }))

    expect(await host(runner).pubkey(PREVIOUS)).toBe(owner.pubkey)
    expect(calls[0]).toMatchObject({ command: 'gh', args: ['api', '-H', 'Accept: application/vnd.github.raw', `repos/gerharar/listulator/contents/apps/desktop/src-tauri/tauri.conf.json?ref=${PREVIOUS}`] })
  })

  it('keeps what Windows programs need (the system folders, the user’s folders, PATH) and nothing else of the environment', async () => {
    const { calls, runner } = recorder()

    await host(runner).runInstaller('C:\\temp\\canary\\setup.exe')

    expect(Object.keys(calls[0]!.options!.env!).sort()).toEqual(['APPDATA', 'LOCALAPPDATA', 'PATH', 'SystemRoot', 'TEMP'])
  })
})
