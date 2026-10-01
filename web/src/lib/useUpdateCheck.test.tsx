// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { AppUpdateChecker, UpdateResult } from './appUpdate.js'
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

    expect(download).toHaveBeenCalledExactlyOnceWith('1.1.0')
  })

  it('does nothing, and does not fail, when asked to download with nothing offered or no way to', async () => {
    const { checker, answer } = controlledChecker()
    const { result } = renderHook(() => useUpdateCheck(checker))
    await act(async () => answer({ kind: 'available', version: '1.1.0' }))

    expect(() => result.current.download()).not.toThrow()
  })

  it('reports a download that fails instead of throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { checker, answer } = controlledChecker(() => Promise.reject(new Error('disk full')))
    const { result } = renderHook(() => useUpdateCheck(checker))
    await act(async () => answer({ kind: 'available', version: '1.1.0' }))

    await act(async () => result.current.download())

    await waitFor(() => expect(error).toHaveBeenCalled())
  })
})
