// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { MediaType } from './api.js'
import { notifyRegistryChanged, useRefetchOnRegistryChange } from './registryChanges.js'

afterEach(cleanup)

const types = (previewable: boolean) => [{ key: 'tv', previewable } as MediaType]

/** A fetch whose answers the test hands out, in any order. */
function controlled() {
  const answers: ((value: MediaType[]) => void)[] = []
  const fetch = vi.fn(() => new Promise<MediaType[]>((resolve) => answers.push(resolve)))
  return { fetch, answers }
}

describe('useRefetchOnRegistryChange (16.5 finding: a key saved on first run left the preview off)', () => {
  it('fetches the media types again when the registry changes, and hands them on', async () => {
    const { fetch, answers } = controlled()
    const apply = vi.fn()
    renderHook(() => useRefetchOnRegistryChange(fetch, apply))
    expect(fetch).not.toHaveBeenCalled()

    act(() => notifyRegistryChanged())
    await act(async () => answers[0]!(types(true)))

    expect(apply).toHaveBeenCalledExactlyOnceWith(types(true))
  })

  it('keeps only the newest answer when changes come faster than the answers (a key typed letter by letter)', async () => {
    const { fetch, answers } = controlled()
    const apply = vi.fn()
    renderHook(() => useRefetchOnRegistryChange(fetch, apply))

    act(() => notifyRegistryChanged())
    act(() => notifyRegistryChanged())
    await act(async () => answers[1]!(types(true)))
    await act(async () => answers[0]!(types(false)))

    expect(apply).toHaveBeenCalledExactlyOnceWith(types(true))
  })

  it('stops listening once unmounted, and a failed fetch keeps what is shown', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('offline')))
    const apply = vi.fn()
    const { unmount } = renderHook(() => useRefetchOnRegistryChange(fetch, apply))

    await act(async () => notifyRegistryChanged())
    expect(apply).not.toHaveBeenCalled()

    unmount()
    act(() => notifyRegistryChanged())
    expect(fetch).toHaveBeenCalledOnce()
  })
})
