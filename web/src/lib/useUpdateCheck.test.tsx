// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { InstallStuckError, type AppUpdateChecker, type UpdatePhase, type UpdateResult } from './appUpdate.js'
import { useUpdateCheck } from './useUpdateCheck.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** A checker whose answer the test gives when it likes. */
function controlledChecker(download?: AppUpdateChecker['download']) {
  const pending: { resolve: (result: UpdateResult) => void; reject: (error: Error) => void }[] = []
  const check = vi.fn(
    () =>
      new Promise<UpdateResult>((resolve, reject) => {
        pending.push({ resolve, reject })
      }),
  )
  const checker: AppUpdateChecker = { check, ...(download ? { download } : {}) }

  return { checker, check, answer: (result: UpdateResult) => pending.shift()!.resolve(result), fail: () => pending.shift()!.reject(new Error('offline')) }
}

describe('useUpdateCheck', () => {
  it('starts by checking and never says "latest" before a check has answered', async () => {
    const { checker, check, answer } = controlledChecker()
    const { result } = renderHook(() => useUpdateCheck(checker))

    expect(result.current.state).toBe('checking')
    expect(check).toHaveBeenCalledTimes(1)

    await act(async () => answer({ kind: 'latest' }))

    expect(result.current.state).toBe('latest')
  })

  it.each([
    [{ kind: 'latest' } as UpdateResult, 'latest', undefined],
    [{ kind: 'available', version: '1.1.0' } as UpdateResult, 'available', '1.1.0'],
    [{ kind: 'unavailable' } as UpdateResult, 'unavailable', undefined],
  ])('turns %o into the %s state', async (outcome, state, next) => {
    const { checker, answer } = controlledChecker()
    const { result } = renderHook(() => useUpdateCheck(checker))

    await act(async () => answer(outcome))

    expect(result.current.state).toBe(state)
    expect(result.current.next).toBe(next)
  })

  it('turns a failed check into the error state', async () => {
    const { checker, fail } = controlledChecker()
    const { result } = renderHook(() => useUpdateCheck(checker))

    await act(async () => fail())

    expect(result.current.state).toBe('error')
  })

  it('checks again when asked: from error back through checking to the new answer', async () => {
    const { checker, check, fail, answer } = controlledChecker()
    const { result } = renderHook(() => useUpdateCheck(checker))
    await act(async () => fail())

    act(() => {
      void result.current.check()
    })
    expect(result.current.state).toBe('checking')
    expect(check).toHaveBeenCalledTimes(2)
    await act(async () => answer({ kind: 'latest' }))

    expect(result.current.state).toBe('latest')
  })

  it('ignores another press while a check is running', async () => {
    const { checker, check, answer } = controlledChecker()
    const { result } = renderHook(() => useUpdateCheck(checker))

    act(() => {
      void result.current.check()
      void result.current.check()
    })
    await act(async () => answer({ kind: 'latest' }))

    expect(check).toHaveBeenCalledTimes(1)
  })

  it('checks once even where React mounts twice (StrictMode)', async () => {
    const { checker, check, answer } = controlledChecker()
    const { result } = renderHook(() => useUpdateCheck(checker), { wrapper: StrictMode })

    await act(async () => answer({ kind: 'latest' }))

    expect(check).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('latest')
  })

  it('drops an answer that arrives after the screen has closed', async () => {
    const { checker, answer } = controlledChecker()
    const { result, unmount } = renderHook(() => useUpdateCheck(checker))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    unmount()
    await act(async () => answer({ kind: 'latest' }))

    expect(result.current.state).toBe('checking')
    expect(error).not.toHaveBeenCalled()
  })

  it('downloads the version the update offered', async () => {
    const download = vi.fn()
    const { checker, answer } = controlledChecker(download)
    const { result } = renderHook(() => useUpdateCheck(checker))
    await act(async () => answer({ kind: 'available', version: '1.1.0' }))

    await act(async () => result.current.download())

    expect(download).toHaveBeenCalledExactlyOnceWith('1.1.0', expect.any(Function))
  })

  it('does nothing, and does not fail, when asked to download with nothing offered or no way to', async () => {
    const { checker, answer } = controlledChecker()
    const { result } = renderHook(() => useUpdateCheck(checker))
    await act(async () => answer({ kind: 'available', version: '1.1.0' }))

    expect(() => result.current.download()).not.toThrow()
  })

  it('shows a download that fails as its own error, not as a failed check, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { checker, answer } = controlledChecker(() => Promise.reject(new Error('disk full')))
    const { result } = renderHook(() => useUpdateCheck(checker))
    await act(async () => answer({ kind: 'available', version: '1.1.0' }))

    await act(async () => result.current.download())

    expect(result.current.state).toBe('installError')
    expect(result.current.next).toBe('1.1.0')
    expect(error).toHaveBeenCalled()
  })

  it('shows an install that never started as its own state, still offering the version (BL-116)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { checker, answer } = controlledChecker(() => Promise.reject(new InstallStuckError()))
    const { result } = renderHook(() => useUpdateCheck(checker))
    await act(async () => answer({ kind: 'available', version: '1.1.0' }))

    await act(async () => result.current.download())

    expect(result.current.state).toBe('installStuck')
    expect(result.current.next).toBe('1.1.0')
  })
})

describe('useUpdateCheck: the update in progress (task 20.11)', () => {
  /** A download the test moves along: `phase` reports a phase, `finishDownload` and `failDownload` end it. */
  function controlledDownload() {
    const calls: { version: string; onPhase: (phase: UpdatePhase) => void; resolve: () => void; reject: (error: Error) => void }[] = []
    const download = vi.fn(
      (version: string, onPhase: (phase: UpdatePhase) => void) =>
        new Promise<void>((resolve, reject) => {
          calls.push({ version, onPhase, resolve, reject })
        }),
    )

    return {
      download,
      phase: (phase: UpdatePhase) => calls[0]!.onPhase(phase),
      finishDownload: () => calls[0]!.resolve(),
      failDownload: () => calls[0]!.reject(new Error('bad signature')),
    }
  }

  async function offered() {
    const control = controlledDownload()
    const checker = controlledChecker(control.download)
    const rendered = renderHook(() => useUpdateCheck(checker.checker))
    await act(async () => checker.answer({ kind: 'available', version: '1.1.0' }))

    return { ...control, ...checker, ...rendered }
  }

  it('moves to downloading on the press, before the checker has said anything', async () => {
    const { result } = await offered()

    act(() => result.current.download())

    expect(result.current.state).toBe('downloading')
    expect(result.current.next).toBe('1.1.0')
  })

  it('follows the phases the checker reports, and stays in the last one when the download ends', async () => {
    const { result, phase, finishDownload } = await offered()
    act(() => result.current.download())

    act(() => phase('installing'))
    expect(result.current.state).toBe('installing')
    act(() => phase('restarting'))
    expect(result.current.state).toBe('restarting')
    await act(async () => finishDownload())

    expect(result.current.state).toBe('restarting')
    expect(result.current.next).toBe('1.1.0')
  })

  it('treats a download that fails midway as an install error, whatever phase it had reached', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, phase, failDownload } = await offered()
    act(() => result.current.download())
    act(() => phase('installing'))

    await act(async () => failDownload())

    expect(result.current.state).toBe('installError')
    expect(error).toHaveBeenCalled()
  })

  it('checks again from the install error, like any other error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, failDownload, check, answer } = await offered()
    act(() => result.current.download())
    await act(async () => failDownload())

    act(() => {
      void result.current.check()
    })
    expect(result.current.state).toBe('checking')
    expect(check).toHaveBeenCalledTimes(2)
    await act(async () => answer({ kind: 'latest' }))

    expect(result.current.state).toBe('latest')
  })

  it('ignores a second press and a check while the update is in progress', async () => {
    const { result, download, check, phase } = await offered()
    act(() => result.current.download())

    act(() => {
      result.current.download()
      void result.current.check()
    })
    act(() => phase('installing'))
    act(() => {
      result.current.download()
      void result.current.check()
    })

    expect(download).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('installing')
  })

  it('does not start the update twice when it is pressed twice before the screen has redrawn', async () => {
    const { result, download } = await offered()

    act(() => {
      result.current.download()
      result.current.download()
    })

    expect(download).toHaveBeenCalledTimes(1)
  })

  it('does not download again from the install error: the offer is stale until a new check', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, failDownload, download } = await offered()
    act(() => result.current.download())
    await act(async () => failDownload())

    act(() => result.current.download())

    expect(download).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('installError')
  })

  it.each(['checking', 'latest', 'error', 'unavailable'] as const)('downloads nothing from the %s state', async (state) => {
    const control = controlledDownload()
    const checker = controlledChecker(control.download)
    const { result } = renderHook(() => useUpdateCheck(checker.checker))
    if (state === 'latest') await act(async () => checker.answer({ kind: 'latest' }))
    if (state === 'unavailable') await act(async () => checker.answer({ kind: 'unavailable' }))
    if (state === 'error') await act(async () => checker.fail())

    act(() => result.current.download())

    expect(control.download).not.toHaveBeenCalled()
    expect(result.current.state).toBe(state)
  })

  it('stays "available" when the checker has no way to download', async () => {
    const { checker, answer } = controlledChecker()
    const { result } = renderHook(() => useUpdateCheck(checker))
    await act(async () => answer({ kind: 'available', version: '1.1.0' }))

    act(() => result.current.download())

    expect(result.current.state).toBe('available')
  })

  it('drops phases and an ending that arrive after the screen has closed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, unmount, phase, failDownload } = await offered()
    act(() => result.current.download())
    unmount()

    act(() => phase('installing'))
    await act(async () => failDownload())

    expect(result.current.state).toBe('downloading')
    expect(error).not.toHaveBeenCalled()
  })

  it('never starts a download by itself: a check that finds an update only offers it', async () => {
    const { download } = await offered()

    expect(download).not.toHaveBeenCalled()
  })
})
