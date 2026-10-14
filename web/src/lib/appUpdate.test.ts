// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_VERSION } from './appVersion.js'
import { appUpdateChecker, devChecker, unavailableChecker, type UpdatePhase } from './appUpdate.js'

// The update trace (BL-092) writes through the preferences store; these tests are about the commands the checker sends.
vi.mock('./updateTrace.js', () => ({ createUpdateTrace: () => ({ record: () => Promise.resolve() }) }))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  window.history.replaceState({}, '', '/')
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  vi.restoreAllMocks()
})

describe('the shipped checker', () => {
  it('has nothing to check against yet: it says so, claims nothing, and cannot download', async () => {
    await expect(unavailableChecker.check()).resolves.toEqual({ kind: 'unavailable' })
    expect(unavailableChecker.download).toBeUndefined()
  })
})

describe('the dev-only checker (?aboutUpdate=…)', () => {
  it('is not there without the parameter, or with a value it does not know', () => {
    expect(devChecker('')).toBeUndefined()
    expect(devChecker('?other=1')).toBeUndefined()
    expect(devChecker('?aboutUpdate=nonsense')).toBeUndefined()
  })

  it('latest: answers up to date after a moment, so Checking… can be seen', async () => {
    const checker = devChecker('?aboutUpdate=latest')!
    const answer = checker.check()

    await vi.advanceTimersByTimeAsync(600)

    await expect(answer).resolves.toEqual({ kind: 'latest' })
  })

  it('available: offers the next minor version and can download it', async () => {
    const checker = devChecker('?aboutUpdate=available')!
    const answer = checker.check()
    await vi.advanceTimersByTimeAsync(600)
    const [major, minor] = APP_VERSION.split('.').map(Number)

    await expect(answer).resolves.toEqual({ kind: 'available', version: `${major}.${minor! + 1}.0` })
    expect(checker.download).toBeTypeOf('function')
  })

  it('available: still offers the next minor version when the current one is a release candidate (1.0.0-rc.1)', async () => {
    const checker = devChecker('?aboutUpdate=available', '1.0.0-rc.1')!
    const answer = checker.check()
    await vi.advanceTimersByTimeAsync(600)

    await expect(answer).resolves.toEqual({ kind: 'available', version: '1.1.0' })
  })

  it('available: a download goes through downloading, installing and restarting, and ends there', async () => {
    const checker = devChecker('?aboutUpdate=available')!
    const phases: UpdatePhase[] = []
    let ended = false

    void Promise.resolve(checker.download?.('1.1.0', (phase) => phases.push(phase))).then(() => (ended = true))
    expect(phases).toEqual(['downloading'])
    await vi.advanceTimersByTimeAsync(10_000)

    expect(phases).toEqual(['downloading', 'installing', 'restarting'])
    expect(ended).toBe(true)
  })

  it('installError: offers an update whose download fails after a moment', async () => {
    const checker = devChecker('?aboutUpdate=installError')!
    const answer = checker.check()
    await vi.advanceTimersByTimeAsync(600)
    await expect(answer).resolves.toMatchObject({ kind: 'available' })
    const phases: UpdatePhase[] = []

    const failure = expect(Promise.resolve(checker.download?.('1.1.0', (phase) => phases.push(phase)))).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10_000)

    await failure
    expect(phases[0]).toBe('downloading')
  })

  it('error: fails after a moment', async () => {
    const answer = devChecker('?aboutUpdate=error')!.check()
    const failure = expect(answer).rejects.toThrow()

    await vi.advanceTimersByTimeAsync(600)

    await failure
  })

  it('slow: takes five seconds to say up to date', async () => {
    const answer = devChecker('?aboutUpdate=slow')!.check()
    let settled = false
    void answer.then(() => (settled = true))

    await vi.advanceTimersByTimeAsync(4999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
  })
})

describe('which checker the app uses', () => {
  it('is the shipped one unless a dev build was asked for a state', () => {
    expect(appUpdateChecker()).toBe(unavailableChecker)

    window.history.replaceState({}, '', '/?aboutUpdate=error')
    expect(appUpdateChecker()).not.toBe(unavailableChecker)
  })

  it('ignores the parameter in a production build', () => {
    vi.stubEnv('DEV', false)
    window.history.replaceState({}, '', '/?aboutUpdate=error')

    expect(appUpdateChecker()).toBe(unavailableChecker)
  })
})

describe('the desktop app’s checker (task 20.11)', () => {
  /** A bridge that answers a check with an offer and everything else with nothing; it records the commands. */
  function desktopBridge(userAgent: string): string[] {
    const commands: string[] = []
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent)
    ;(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      invoke: async (cmd: string) => {
        commands.push(cmd)
        return cmd === 'plugin:updater|check' ? { rid: 3, version: '1.1.0' } : null
      },
    }

    return commands
  }

  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0'

  it('is the plugin-backed checker inside the desktop shell, and the shipped one in a browser', () => {
    expect(appUpdateChecker()).toBe(unavailableChecker)

    desktopBridge(MAC)

    expect(appUpdateChecker()).not.toBe(unavailableChecker)
    expect(appUpdateChecker().download).toBeTypeOf('function')
  })

  it('checks only when asked: building the checker sends nothing', () => {
    const commands = desktopBridge(MAC)

    appUpdateChecker()

    expect(commands).toEqual([])
  })

  it('relaunches by hand on macOS after the install', async () => {
    const commands = desktopBridge(MAC)
    const checker = appUpdateChecker()
    await checker.check()

    await checker.download?.('1.1.0', () => undefined)

    expect(commands).toEqual(['plugin:updater|check', 'plugin:updater|download_and_install', 'relaunch'])
  })

  it('leaves the restart to the installer on Windows', async () => {
    const commands = desktopBridge(WINDOWS)
    const checker = appUpdateChecker()
    await checker.check()

    await checker.download?.('1.1.0', () => undefined)

    expect(commands).toEqual(['plugin:updater|check', 'plugin:updater|download_and_install'])
  })

  it('still lets a development build’s ?aboutUpdate= state take over inside the shell', async () => {
    desktopBridge(MAC)
    window.history.replaceState({}, '', '/?aboutUpdate=latest')
    const answer = appUpdateChecker().check()

    await vi.advanceTimersByTimeAsync(600)

    await expect(answer).resolves.toEqual({ kind: 'latest' })
  })
})
