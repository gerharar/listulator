// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { LiveRegionProvider } from '../components/quantum/LiveRegion/LiveRegion.js'
import { ToastProvider } from '../components/quantum/Toast/Toast.js'
import { setActiveLanguage } from '../locale/index.js'
import { resetUpdatedToast, useUpdatedToast } from './useUpdatedToast.js'

const state = vi.hoisted(() => ({ previous: Promise.resolve(undefined as string | undefined), desktop: true }))

vi.mock('./runVersion.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./runVersion.js')>()), previousRunVersion: () => state.previous }))
vi.mock('./platform.js', () => ({ isDesktop: () => state.desktop }))
vi.mock('./appVersion.js', () => ({ APP_VERSION: '1.1.1' }))

/** What the page shows: the toast itself, and the sentence the live region says with it (every toast says its text there too). */
const toast = () => document.querySelector('.q-toast')?.textContent ?? null
const said = () => document.querySelector('.q-live')?.textContent ?? ''

function Shell({ children }: { children?: ReactNode }) {
  useUpdatedToast()
  return <>{children}</>
}

/** The shell with the real providers around it, as `App` has them. */
function mount() {
  return render(
    <LiveRegionProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </LiveRegionProvider>,
  )
}

/** Lets the hook's reaction to the stored version run: it is attached to the same promise before this waits on it. */
async function settled() {
  await act(async () => {
    await state.previous.catch(() => {})
  })
}

beforeEach(() => {
  state.previous = Promise.resolve('1.1.0')
  state.desktop = true
  // The hook says it once per page load; each test is a new page load, and says so with the hook's own reset, not by reloading modules.
  resetUpdatedToast()
  setActiveLanguage('en')
})

afterEach(() => {
  cleanup()
  setActiveLanguage('en')
})

describe('the "Updated to" toast (canvas H-017)', () => {
  it('shows the new version in the real toast, and says it in the live region too', async () => {
    mount()

    await waitFor(() => expect(toast()).toBe('Updated to 1.1.1'))
    await waitFor(() => expect(said()).toBe('Updated to 1.1.1'))
  })

  it('says it in the language in use', async () => {
    setActiveLanguage('ru')
    mount()

    await waitFor(() => expect(toast()).toBe('Обновлено до 1.1.1'))
  })

  it.each([
    ['on a first install', undefined],
    ['at a start of the same version', '1.1.1'],
    ['after a downgrade', '1.2.0'],
  ] as const)('says nothing %s', async (_name, previous) => {
    state.previous = Promise.resolve(previous)
    mount()
    await settled()

    expect(toast()).toBeNull()
    expect(said()).toBe('')
  })

  it('says nothing in the browser build', async () => {
    state.desktop = false
    mount()
    await settled()

    expect(toast()).toBeNull()
  })

  it('says nothing when the store failed', async () => {
    state.previous = Promise.reject(new Error('disk full'))
    mount()
    await settled()

    expect(toast()).toBeNull()
  })

  it('says it once, however often the shell mounts', async () => {
    const first = mount()
    await waitFor(() => expect(toast()).toBe('Updated to 1.1.1'))
    first.unmount()
    // A second mount in the same page load: the same module, so the same once-per-page flag.
    mount()
    await settled()

    expect(toast()).toBeNull()
  })

  it('says it again after the reset: each test, like each page load, starts unset', async () => {
    const first = mount()
    await waitFor(() => expect(toast()).toBe('Updated to 1.1.1'))
    first.unmount()
    cleanup()
    resetUpdatedToast()
    mount()

    await waitFor(() => expect(toast()).toBe('Updated to 1.1.1'))
  })
})

describe('in the shell', () => {
  it('is called by AppShellBody, inside the toast and live-region providers', () => {
    const app = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8')
    const body = app.slice(app.indexOf('function AppShellBody'))

    expect(body).toMatch(/^\s*useUpdatedToast\(\)/m)
    // The providers wrap `<AppShellBody>` in `App`, above it in the file.
    expect(app.indexOf('<ToastProvider>')).toBeGreaterThan(-1)
    expect(app.indexOf('<ToastProvider>')).toBeLessThan(app.indexOf('<AppShellBody'))
  })
})
