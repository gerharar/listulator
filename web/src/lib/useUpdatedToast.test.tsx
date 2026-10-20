// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

const state = vi.hoisted(() => ({ previous: Promise.resolve(undefined as string | undefined), desktop: true, shown: [] as string[] }))

vi.mock('./runVersion.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./runVersion.js')>()), previousRunVersion: () => state.previous }))
vi.mock('./platform.js', () => ({ isDesktop: () => state.desktop }))
vi.mock('./appVersion.js', () => ({ APP_VERSION: '1.1.1' }))
vi.mock('../components/quantum/Toast/Toast.js', () => ({ useToast: () => ({ showToast: ({ text }: { text: string }) => state.shown.push(text), hideToast: () => {} }) }))

async function mountOnce(language: 'en' | 'ru' = 'en') {
  vi.resetModules()
  // The module registry was reset: the hook reads the words of the new copy of the locale.
  ;(await import('../locale/index.js')).setActiveLanguage(language)
  const { useUpdatedToast } = await import('./useUpdatedToast.js')
  function Probe() {
    useUpdatedToast()
    return null
  }

  return render(<Probe />)
}

beforeEach(() => {
  state.previous = Promise.resolve('1.1.0')
  state.desktop = true
  state.shown = []
})

afterEach(() => {
  cleanup()
})

describe('the "Updated to" toast (canvas H-017)', () => {
  it('says the new version on the first screen after an update', async () => {
    await mountOnce()

    await waitFor(() => expect(state.shown).toEqual(['Updated to 1.1.1']))
  })

  it('says it in the language in use', async () => {
    await mountOnce('ru')

    await waitFor(() => expect(state.shown).toEqual(['Обновлено до 1.1.1']))
  })

  it.each([
    ['on a first install', undefined],
    ['at a start of the same version', '1.1.1'],
    ['after a downgrade', '1.2.0'],
  ] as const)('says nothing %s', async (_name, previous) => {
    state.previous = Promise.resolve(previous)
    await mountOnce()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(state.shown).toEqual([])
  })

  it('says nothing in the browser build', async () => {
    state.desktop = false
    await mountOnce()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(state.shown).toEqual([])
  })

  it('says nothing when the store failed', async () => {
    state.previous = Promise.reject(new Error('disk full'))
    await mountOnce()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(state.shown).toEqual([])
  })

  it('says it once, however often the shell mounts', async () => {
    const first = await mountOnce()
    await waitFor(() => expect(state.shown).toHaveLength(1))
    first.unmount()
    // A second mount in the same page load (the module is the same one now).
    const { useUpdatedToast } = await import('./useUpdatedToast.js')
    function Probe() {
      useUpdatedToast()
      return null
    }
    render(<Probe />)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(state.shown).toHaveLength(1)
  })
})
