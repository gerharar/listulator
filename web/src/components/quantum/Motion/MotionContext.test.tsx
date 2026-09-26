// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import { MotionProvider, useMotion, useReducedMotion } from './MotionContext.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function fakeStore(): PreferencesStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
  }
}

function systemPrefersReduced(reduced: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: reduced,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

function Probe() {
  const { reduced, setReducedMotion } = useMotion()
  return (
    <div>
      <output data-testid="state">{String(reduced)}</output>
      <button onClick={() => setReducedMotion(true)}>reduce</button>
      <button onClick={() => setReducedMotion(false)}>allow</button>
    </div>
  )
}

const state = () => screen.getByTestId('state').textContent

describe('MotionProvider', () => {
  it('follows the system setting until the user has chosen', () => {
    systemPrefersReduced(true)
    render(
      <MotionProvider initialReducedSetting={undefined} store={fakeStore()}>
        <Probe />
      </MotionProvider>,
    )

    expect(state()).toBe('true')
  })

  it('an explicit no keeps motion on even when the system asks for less', () => {
    systemPrefersReduced(true)
    render(
      <MotionProvider initialReducedSetting={false} store={fakeStore()}>
        <Probe />
      </MotionProvider>,
    )

    expect(state()).toBe('false')
  })

  it('an explicit yes reduces motion when the system does not ask', () => {
    systemPrefersReduced(false)
    render(
      <MotionProvider initialReducedSetting={true} store={fakeStore()}>
        <Probe />
      </MotionProvider>,
    )

    expect(state()).toBe('true')
  })

  it('applies a change at once and persists it', () => {
    systemPrefersReduced(false)
    const store = fakeStore()
    render(
      <MotionProvider initialReducedSetting={undefined} store={store}>
        <Probe />
      </MotionProvider>,
    )

    act(() => screen.getByText('reduce').click())

    expect(state()).toBe('true')
    expect(store.data.get('reducedMotion')).toBe('true')
  })

  it('an explicit no wins over the system after the user unticks the box', () => {
    systemPrefersReduced(true)
    const store = fakeStore()
    render(
      <MotionProvider initialReducedSetting={undefined} store={store}>
        <Probe />
      </MotionProvider>,
    )

    act(() => screen.getByText('allow').click())

    expect(state()).toBe('false')
    expect(store.data.get('reducedMotion')).toBe('false')
  })
})

describe('useMotion without a provider', () => {
  it('has motion on — a component rendered alone in a test', () => {
    render(<Probe />)

    expect(state()).toBe('false')
  })
})

describe('useReducedMotion', () => {
  function Reduced() {
    return <output data-testid="r">{String(useReducedMotion())}</output>
  }

  it('reads the system setting when there is no provider', () => {
    systemPrefersReduced(true)
    render(<Reduced />)

    expect(screen.getByTestId('r').textContent).toBe('true')
  })

  it('reads the effective setting inside a provider', () => {
    systemPrefersReduced(true)
    render(
      <MotionProvider initialReducedSetting={false} store={fakeStore()}>
        <Reduced />
      </MotionProvider>,
    )

    expect(screen.getByTestId('r').textContent).toBe('false')
  })
})
