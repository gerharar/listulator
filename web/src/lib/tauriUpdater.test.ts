import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallStuckError, type UpdatePhase } from './appUpdate.js'
import { loadIsolationHook, type IpcMessage } from './isolationHook.testing.js'
import { createTauriChecker } from './tauriUpdater.js'

/** The trace (BL-092) writes through the preferences store; here it only reports which marks were asked for. */
const traced = vi.hoisted(() => [] as string[])
vi.mock('./updateTrace.js', () => ({
  createUpdateTrace: () => ({
    record: (step: string) => {
      traced.push(step)

      return Promise.resolve()
    },
  }),
}))

/**
 * The updater client against a stand-in for the Tauri bridge (task 20.11). Every call it makes is also sent through
 * the real isolation hook (`apps/desktop/isolation/hook.js`) the way the isolation frame would see it, so the client
 * and the hook cannot drift apart: a call the hook would refuse fails the test. (Node, not jsdom: the hook loader
 * reads a file by URL, and the client needs only a `window` with the bridge on it.)
 */
const { hook } = loadIsolationHook()

interface Sent {
  cmd: string
  payload: unknown
}

type Reply = (cmd: string, payload: Record<string, unknown>) => unknown

let sent: Sent[]
let callbacks: Map<number, (message: unknown) => void>
let reply: Reply

beforeEach(() => {
  traced.length = 0
  sent = []
  callbacks = new Map()
  reply = () => undefined
  let next = 40
  vi.stubGlobal('window', {})
  ;(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    transformCallback: (callback: (message: unknown) => void) => {
      next += 1
      callbacks.set(next, callback)
      return next
    },
    unregisterCallback: (id: number) => void callbacks.delete(id),
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
      // What the isolation frame receives: the payload after JSON, where a Channel has become its marker text.
      const payload = JSON.parse(JSON.stringify(args)) as Record<string, unknown>
      sent.push({ cmd, payload })
      const message: IpcMessage = { cmd, callback: 1, error: 2, payload }
      if (hook(message) !== message) throw new Error(`the isolation hook refused ${cmd}`)

      return reply(cmd, payload)
    },
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const found = { rid: 7, currentVersion: '1.0.0', version: '1.1.0', date: '2026-10-20T00:00:00Z', body: 'notes the server chose', rawJson: {} }

/** Moves the download along the way the plugin's channel does. */
function emit(event: unknown, index = 0): void {
  const last = [...callbacks.values()].at(-1)!
  last({ index, message: event })
}

describe('check', () => {
  it('asks the plugin with an empty object, and nothing else', async () => {
    reply = () => null

    await createTauriChecker({ relaunchAfterInstall: true }).check()

    expect(sent).toEqual([{ cmd: 'plugin:updater|check', payload: {} }])
  })

  it('says "latest" only when the plugin answers null', async () => {
    reply = () => null

    expect(await createTauriChecker({ relaunchAfterInstall: true }).check()).toEqual({ kind: 'latest' })
  })

  it('offers the version, and only the version: nothing else the server sent reaches the screen', async () => {
    reply = () => found

    expect(await createTauriChecker({ relaunchAfterInstall: true }).check()).toEqual({ kind: 'available', version: '1.1.0' })
  })

  it.each([
    ['no answer at all', undefined],
    ['an empty object', {}],
    ['no version', { rid: 7 }],
    ['no resource id', { version: '1.1.0' }],
    ['a version that is not text', { rid: 7, version: 110 }],
    ['a resource id that is not a whole number', { rid: 7.5, version: '1.1.0' }],
    ['a version with markup in it', { rid: 7, version: '1.1.0<img src=x>' }],
    ['a version that is not a version', { rid: 7, version: 'Download the new Listulator now' }],
    ['an empty version', { rid: 7, version: '' }],
    ['an endless version', { rid: 7, version: `1.${'1'.repeat(200)}.0` }],
  ])('fails, and never claims "up to date", on %s', async (_name, answer) => {
    reply = () => answer

    await expect(createTauriChecker({ relaunchAfterInstall: true }).check()).rejects.toThrow()
  })

  it('fails when the plugin fails (no release file, no network, a bad answer)', async () => {
    reply = () => Promise.reject('Could not fetch a valid release JSON from the remote')

    await expect(createTauriChecker({ relaunchAfterInstall: true }).check()).rejects.toBeDefined()
  })
})

describe('download', () => {
  async function offered(relaunchAfterInstall: boolean) {
    reply = (cmd) => (cmd === 'plugin:updater|check' ? found : null)
    const checker = createTauriChecker({ relaunchAfterInstall })
    await checker.check()
    sent.length = 0

    return checker
  }

  it('refuses to download what no check offered, and sends nothing', async () => {
    const checker = createTauriChecker({ relaunchAfterInstall: true })

    await expect(checker.download?.('1.1.0', () => undefined)).rejects.toThrow()
    expect(sent).toEqual([])
  })

  it('forgets the offer when the next check fails, so an old offer cannot be installed after a failed look', async () => {
    const checker = await offered(true)
    reply = () => Promise.reject('offline')
    await checker.check().catch(() => undefined)
    sent.length = 0

    await expect(checker.download?.('1.1.0', () => undefined)).rejects.toThrow()
    expect(sent).toEqual([])
  })

  it('refuses a version other than the one the check offered, and sends nothing', async () => {
    const checker = await offered(true)

    await expect(checker.download?.('9.9.9', () => undefined)).rejects.toThrow()
    expect(sent).toEqual([])
  })

  it('downloads and installs the resource the check returned, with a channel for progress and no options', async () => {
    const checker = await offered(true)

    await checker.download?.('1.1.0', () => undefined)

    expect(sent[0]).toEqual({ cmd: 'plugin:updater|download_and_install', payload: { onEvent: '__CHANNEL__:41', rid: 7 } })
  })

  it('reports downloading, then installing when the download is done, then restarting', async () => {
    const checker = await offered(true)
    const phases: UpdatePhase[] = []
    reply = async (cmd) => {
      if (cmd === 'plugin:updater|download_and_install') {
        emit({ event: 'Started', data: { contentLength: 100 } })
        emit({ event: 'Progress', data: { chunkLength: 60 } }, 1)
        expect(phases).toEqual(['downloading'])
        emit({ event: 'Finished' }, 2)
      }

      return null
    }

    await checker.download?.('1.1.0', (phase) => phases.push(phase))

    expect(phases).toEqual(['downloading', 'installing', 'restarting'])
  })

  it('relaunches the app by hand after an install on macOS, with no payload', async () => {
    const checker = await offered(true)

    await checker.download?.('1.1.0', () => undefined)

    expect(sent.map((call) => call.cmd)).toEqual(['plugin:updater|download_and_install', 'relaunch'])
    expect(sent[1]?.payload).toEqual({})
  })

  it('does not relaunch where the installer restarts the app itself (Windows)', async () => {
    const checker = await offered(false)
    const phases: UpdatePhase[] = []

    await checker.download?.('1.1.0', (phase) => phases.push(phase))

    expect(sent.map((call) => call.cmd)).toEqual(['plugin:updater|download_and_install'])
    expect(phases.at(-1)).toBe('restarting')
  })

  it('fails, and does not relaunch, when the download, the signature or the install fails', async () => {
    const checker = await offered(true)
    reply = () => Promise.reject('signature verification failed')

    await expect(checker.download?.('1.1.0', () => undefined)).rejects.toBeDefined()
    expect(sent.map((call) => call.cmd)).toEqual(['plugin:updater|download_and_install'])
  })

  it('fails when the relaunch fails, so the screen does not claim a restart that did not happen', async () => {
    const checker = await offered(true)
    reply = (cmd) => (cmd === 'relaunch' ? Promise.reject('no') : null)

    await expect(checker.download?.('1.1.0', () => undefined)).rejects.toBeDefined()
  })
})

describe('the update trace (BL-092)', () => {
  async function offered(relaunchAfterInstall: boolean) {
    reply = (cmd) => (cmd === 'plugin:updater|check' ? found : null)
    const checker = createTauriChecker({ relaunchAfterInstall })
    await checker.check()
    sent.length = 0

    return checker
  }

  it('marks the press, the start, the last tenth, the end of the download and the return of the install, in that order', async () => {
    const checker = await offered(false)
    reply = async (cmd) => {
      if (cmd === 'plugin:updater|download_and_install') {
        emit({ event: 'Started', data: { contentLength: 100 } })
        emit({ event: 'Progress', data: { chunkLength: 50 } }, 1)
        emit({ event: 'Progress', data: { chunkLength: 45 } }, 2)
        emit({ event: 'Progress', data: { chunkLength: 5 } }, 3)
        emit({ event: 'Finished' }, 4)
      }

      return null
    }

    await checker.download?.('1.1.0', () => undefined)

    expect(traced).toEqual(['pressed', 'download-started', 'download-90%', 'download-finished', 'install-returned'])
  })

  it('marks the relaunch where the app relaunches itself (macOS)', async () => {
    const checker = await offered(true)

    await checker.download?.('1.1.0', () => undefined)

    expect(traced.slice(-2)).toEqual(['install-returned', 'relaunch-called'])
  })

  it('marks the 90% point once, however many chunks follow it', async () => {
    const checker = await offered(false)
    reply = async (cmd) => {
      if (cmd === 'plugin:updater|download_and_install') {
        emit({ event: 'Started', data: { contentLength: 10 } })
        for (let i = 1; i <= 10; i += 1) emit({ event: 'Progress', data: { chunkLength: 1 } }, i)
        emit({ event: 'Finished' }, 11)
      }

      return null
    }

    await checker.download?.('1.1.0', () => undefined)

    expect(traced.filter((step) => step === 'download-90%')).toHaveLength(1)
  })

  it('copes with a progress event that carries no data, and a download of unknown length', async () => {
    const checker = await offered(false)
    reply = async (cmd) => {
      if (cmd === 'plugin:updater|download_and_install') {
        emit({ event: 'Started' })
        emit({ event: 'Progress' }, 1)
        emit({ event: 'Finished' }, 2)
      }

      return null
    }

    await expect(checker.download?.('1.1.0', () => undefined)).resolves.toBeUndefined()
    expect(traced).toEqual(['pressed', 'download-started', 'download-finished', 'install-returned'])
  })

  it('marks nothing for a download it refuses', async () => {
    const checker = createTauriChecker({ relaunchAfterInstall: true })

    await expect(checker.download?.('1.1.0', () => undefined)).rejects.toThrow()
    expect(traced).toEqual([])
  })

  it('does not mark the return of an install that failed', async () => {
    const checker = await offered(false)
    reply = () => Promise.reject('signature verification failed')

    await expect(checker.download?.('1.1.0', () => undefined)).rejects.toBeDefined()
    expect(traced).toEqual(['pressed'])
  })
})

describe('what the client may ever send', () => {
  it('is only the three calls the hook admits, nothing else even on the failing paths', async () => {
    reply = (cmd) => (cmd === 'plugin:updater|check' ? found : null)
    const checker = createTauriChecker({ relaunchAfterInstall: true })
    await checker.check()
    await checker.download?.('1.1.0', () => undefined)
    reply = () => Promise.reject('x')
    await checker.check().catch(() => undefined)

    expect(new Set(sent.map((call) => call.cmd))).toEqual(new Set(['plugin:updater|check', 'plugin:updater|download_and_install', 'relaunch']))
  })
})

/**
 * BL-116: on Windows the plugin hands the installer to the OS and ends the app. Once, in a test, the app stayed on "Installing" for good: the installer
 * never started, nothing failed, nothing was shown. After a limit the screen leaves it and says to close the app and try again.
 */
describe('an install that never starts (BL-116)', () => {
  const LIMIT = 60_000

  async function offered(installTimeoutMs?: number) {
    reply = (cmd) => (cmd === 'plugin:updater|check' ? found : null)
    const checker = createTauriChecker({ relaunchAfterInstall: false, ...(installTimeoutMs === undefined ? {} : { installTimeoutMs }) })
    await checker.check()
    sent.length = 0

    return checker
  }

  /** The plugin's download is done and the install never answers: neither a result nor an exit. */
  function neverInstalls(): void {
    reply = async () => {
      emit({ event: 'Started', data: { contentLength: 100 } })
      emit({ event: 'Finished' }, 1)

      return new Promise(() => {})
    }
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fails with InstallStuckError once the limit has passed since the download finished, after reporting installing', async () => {
    const checker = await offered(LIMIT)
    neverInstalls()
    const phases: UpdatePhase[] = []

    const outcome = checker.download!('1.1.0', (phase) => phases.push(phase))
    const failure = expect(Promise.resolve(outcome)).rejects.toBeInstanceOf(InstallStuckError)
    await vi.advanceTimersByTimeAsync(LIMIT)

    await failure
    expect(phases).toEqual(['downloading', 'installing'])
    expect(traced).toContain('install-timed-out')
  })

  it('waits the whole limit: nothing fails a moment before it', async () => {
    const checker = await offered(LIMIT)
    neverInstalls()
    let settled = false
    void Promise.resolve(checker.download!('1.1.0', () => undefined)).then(() => (settled = true), () => (settled = true))

    await vi.advanceTimersByTimeAsync(LIMIT - 1)

    expect(settled).toBe(false)
  })

  it('does not count the download: a slow one is not a stuck install', async () => {
    const checker = await offered(LIMIT)
    let finish!: () => void
    reply = async () => {
      emit({ event: 'Started', data: { contentLength: 100 } })
      await new Promise<void>((resolve) => (finish = resolve))
      emit({ event: 'Finished' }, 1)

      return null
    }
    const phases: UpdatePhase[] = []
    const outcome = Promise.resolve(checker.download!('1.1.0', (phase) => phases.push(phase)))

    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(phases).toEqual(['downloading'])
    finish()

    await expect(outcome).resolves.toBeUndefined()
    expect(phases).toEqual(['downloading', 'installing', 'restarting'])
  })

  it('leaves an install that answers in time alone: restarting, and no failure later', async () => {
    const checker = await offered(LIMIT)
    reply = async () => {
      emit({ event: 'Finished' })
      await new Promise((resolve) => setTimeout(resolve, 5_000))

      return null
    }
    const phases: UpdatePhase[] = []
    const outcome = Promise.resolve(checker.download!('1.1.0', (phase) => phases.push(phase)))

    await vi.advanceTimersByTimeAsync(5_000)
    await expect(outcome).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(LIMIT * 2)

    expect(phases).toEqual(['downloading', 'installing', 'restarting'])
    expect(traced).not.toContain('install-timed-out')
  })

  it('passes on the plugin’s own failure as it is, not as a stuck install', async () => {
    const checker = await offered(LIMIT)
    reply = async () => {
      emit({ event: 'Finished' })

      throw 'Access is denied'
    }

    const failure = checker.download!('1.1.0', () => undefined)

    await expect(Promise.resolve(failure)).rejects.not.toBeInstanceOf(InstallStuckError)
  })

  it('has no limit unless it is given one (macOS replaces the app and returns)', async () => {
    const checker = await offered()
    neverInstalls()
    let settled = false
    void Promise.resolve(checker.download!('1.1.0', () => undefined)).then(() => (settled = true), () => (settled = true))

    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(settled).toBe(false)
  })
})
