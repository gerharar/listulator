// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Popover } from '../Popover/Popover.js'
import { OverlayManagerProvider, useEscLadder, useEscStep, useOverlayRegistration } from './OverlayManagerContext.js'

afterEach(cleanup)

function Harness({ popLayer, open }: { popLayer: () => void; open?: () => void }) {
  useEscLadder(popLayer)
  useOverlayRegistration('popover', 'p', open !== undefined, open ?? (() => undefined))
  return null
}

function pressEsc(init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

function mount(popLayer: () => void, open?: () => void) {
  render(
    <OverlayManagerProvider>
      <Harness popLayer={popLayer} {...(open ? { open } : {})} />
    </OverlayManagerProvider>,
  )
}

describe('useEscLadder', () => {
  it('claims the key when it pops a layer, so the OS does not also act on it (BL-018)', () => {
    const popLayer = vi.fn()
    mount(popLayer)

    const event = pressEsc()

    expect(popLayer).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('claims the key when it closes an overlay', () => {
    const close = vi.fn()
    mount(vi.fn(), close)

    const event = pressEsc()

    expect(close).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('does nothing when something else already used the key', () => {
    const popLayer = vi.fn()
    const close = vi.fn()
    mount(popLayer, close)
    document.body.addEventListener('keydown', (event) => event.preventDefault(), { once: true })

    pressEsc()

    expect(popLayer).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('leaves an IME composition alone', () => {
    const popLayer = vi.fn()
    mount(popLayer)

    const event = pressEsc({ isComposing: true })

    expect(popLayer).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('Esc typed into a popover closes just the popover, not the layer under it (BL-020)', () => {
    const popLayer = vi.fn()
    const dismiss = vi.fn()
    const anchor = document.createElement('button')
    document.body.appendChild(anchor)
    render(
      <OverlayManagerProvider>
        <Harness popLayer={popLayer} />
        <Popover open anchorEl={anchor} onDismiss={dismiss} width={360}>
          <input aria-label="Title" />
        </Popover>
      </OverlayManagerProvider>,
    )

    pressEsc({}, document.querySelector('input')!)

    expect(dismiss).toHaveBeenCalledOnce()
    expect(popLayer).not.toHaveBeenCalled()
  })
})

describe('useEscStep', () => {
  function StepHarness({ popLayer, active, run }: { popLayer: () => void; active: boolean; run: () => void }) {
    useEscLadder(popLayer)
    useEscStep('step', active, run)
    return null
  }
  const mountStep = (popLayer: () => void, active: boolean, run: () => void) =>
    render(
      <OverlayManagerProvider>
        <StepHarness popLayer={popLayer} active={active} run={run} />
      </OverlayManagerProvider>,
    )

  it('while active, Esc runs the step, claims the key, and pops no layer', () => {
    const popLayer = vi.fn()
    const run = vi.fn()
    mountStep(popLayer, true, run)

    const event = pressEsc()

    expect(run).toHaveBeenCalledOnce()
    expect(popLayer).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('while not active (a layer is on top of this one), Esc pops the layer as before', () => {
    const popLayer = vi.fn()
    const run = vi.fn()
    mountStep(popLayer, false, run)

    pressEsc()

    expect(run).not.toHaveBeenCalled()
    expect(popLayer).toHaveBeenCalledOnce()
  })

  it('stops being a step when it becomes inactive', () => {
    const popLayer = vi.fn()
    const run = vi.fn()
    const view = mountStep(popLayer, true, run)

    view.rerender(
      <OverlayManagerProvider>
        <StepHarness popLayer={popLayer} active={false} run={run} />
      </OverlayManagerProvider>,
    )
    pressEsc()

    expect(run).not.toHaveBeenCalled()
    expect(popLayer).toHaveBeenCalledOnce()
  })

  it('leaves nothing behind when the layer unmounts: the next Esc pops a layer', () => {
    const popLayer = vi.fn()
    const run = vi.fn()
    function StepHost() {
      useEscStep('step', true, run)
      return null
    }
    // One manager throughout: the ladder stays, the step's host goes.
    const tree = (withHost: boolean) => (
      <OverlayManagerProvider>
        <Harness popLayer={popLayer} />
        {withHost && <StepHost />}
      </OverlayManagerProvider>
    )
    const view = render(tree(true))

    view.rerender(tree(false))
    pressEsc()

    expect(run).not.toHaveBeenCalled()
    expect(popLayer).toHaveBeenCalledOnce()
  })
})

