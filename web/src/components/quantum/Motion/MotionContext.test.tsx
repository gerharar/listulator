// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import { MotionProvider, useMotion, useReducedMotion } from './MotionContext.js'
import { QRoot } from '../QRootContext.js'

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
  const { motion, reduced, setMotion, setReducedMotion } = useMotion()
  return (
    <div>
      <output data-testid="state">{`${motion}|${reduced}`}</output>
      <button onClick={() => setMotion('push')}>push</button>
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
      <MotionProvider initialMotion="drum" initialReducedSetting={undefined} store={fakeStore()}>
        <Probe />
      </MotionProvider>,
    )

    expect(state()).toBe('drum|true')
  })

  it('an explicit no keeps motion on even when the system asks for less', () => {
    systemPrefersReduced(true)
    render(
      <MotionProvider initialMotion="drum" initialReducedSetting={false} store={fakeStore()}>
        <Probe />
      </MotionProvider>,
    )

    expect(state()).toBe('drum|false')
  })

  it('an explicit yes reduces motion when the system does not ask', () => {
    systemPrefersReduced(false)
    render(
      <MotionProvider initialMotion="push" initialReducedSetting={true} store={fakeStore()}>
        <Probe />
      </MotionProvider>,
    )

    expect(state()).toBe('push|true')
  })

  it('applies a change at once and persists it', () => {
    systemPrefersReduced(false)
    const store = fakeStore()
    render(
      <MotionProvider initialMotion="drum" initialReducedSetting={undefined} store={store}>
        <Probe />
      </MotionProvider>,
    )

    act(() => screen.getByText('push').click())
    act(() => screen.getByText('reduce').click())

    expect(state()).toBe('push|true')
    expect(store.data.get('motion')).toBe('push')
    expect(store.data.get('reducedMotion')).toBe('true')
  })

  it('an explicit no wins over the system after the user unticks the box', () => {
    systemPrefersReduced(true)
    const store = fakeStore()
    render(
      <MotionProvider initialMotion="drum" initialReducedSetting={undefined} store={store}>
        <Probe />
      </MotionProvider>,
    )

    act(() => screen.getByText('allow').click())

    expect(state()).toBe('drum|false')
    expect(store.data.get('reducedMotion')).toBe('false')
  })
})

describe('useMotion without a provider', () => {
  it('is the drum carousel with motion on — a component rendered alone in a test', () => {
    render(<Probe />)

    expect(state()).toBe('drum|false')
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
      <MotionProvider initialMotion="drum" initialReducedSetting={false} store={fakeStore()}>
        <Reduced />
      </MotionProvider>,
    )

    expect(screen.getByTestId('r').textContent).toBe('false')
  })
})

describe('QRoot', () => {
  it('carries the motion mode and the reduced flag as attributes the stylesheets key off', () => {
    systemPrefersReduced(false)
    const { container } = render(
      <MotionProvider initialMotion="push" initialReducedSetting={true} store={fakeStore()}>
        <QRoot skin="dark-blue">
          <span />
        </QRoot>
      </MotionProvider>,
    )

    const root = container.querySelector('.q-root')
    expect(root?.getAttribute('data-motion')).toBe('push')
    expect(root?.hasAttribute('data-reduced')).toBe(true)
  })

  it('omits data-reduced when motion is on', () => {
    systemPrefersReduced(false)
    const { container } = render(
      <MotionProvider initialMotion="drum" initialReducedSetting={undefined} store={fakeStore()}>
        <QRoot skin="dark-blue">
          <span />
        </QRoot>
      </MotionProvider>,
    )

    expect(container.querySelector('.q-root')?.hasAttribute('data-reduced')).toBe(false)
  })
})
