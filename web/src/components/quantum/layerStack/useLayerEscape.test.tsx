// @vitest-environment jsdom
import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { LayerStackProvider, useLayerStack, type NavigationHold, type NavigationRun } from './LayerStackContext.js'
import { useLayerEscape } from './useLayerEscape.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { OverlayManagerProvider, useEscLadder } from '../overlay/OverlayManagerContext.js'
import type { LayerDescriptor } from './layerStack.js'

afterEach(cleanup)

const layer = (id: string): LayerDescriptor<string> => ({ id, kind: 'screen', tabLabel: id, content: `/${id}` })

let hold: (run?: NavigationRun) => NavigationHold

function Demo() {
  const stack = useLayerStack()
  hold = stack.holdNavigation
  useEscLadder(useLayerEscape())
  return <span data-testid="stack">{stack.stack.map((l) => l.id).join(',')}</span>
}

function mount() {
  render(
    <LiveRegionProvider>
      <OverlayManagerProvider>
        <LayerStackProvider home={layer('home')}>
          <Opener />
          <Demo />
        </LayerStackProvider>
      </OverlayManagerProvider>
    </LiveRegionProvider>,
  )
}

function Opener() {
  const { push } = useLayerStack()
  useEffect(() => push(layer('list')), [])
  return null
}

const esc = () => act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
const said = () => document.querySelector('.q-live')!.textContent

describe('Esc over the layer stack (H-015)', () => {
  it('pops a layer as before when no run goes on', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('stack').textContent).toBe('home,list'))

    esc()

    expect(screen.getByTestId('stack').textContent).toBe('home')
  })

  it('during a run changes nothing and says why, once per run, in the words of that run', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('stack').textContent).toBe('home,list'))
    let first!: NavigationHold
    act(() => void (first = hold({ kind: 'reset', listName: 'Loki' })))

    esc()
    await waitFor(() => expect(said()).toBe('The list is being reset. Please wait until it finishes.'))
    expect(screen.getByTestId('stack').textContent).toBe('home,list')

    // A second press in the same run is silent: the live region is cleared by hand, and it stays empty.
    await act(async () => void (document.querySelector('.q-live')!.textContent = ''))
    esc()
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))))
    expect(said()).toBe('')

    act(() => first.release())
    let second!: NavigationHold
    act(() => void (second = hold({ kind: 'undo', listName: 'Loki' })))
    esc()
    await waitFor(() => expect(said()).toBe('The undo is running. Please wait until it finishes.'))
    act(() => second.release())
  })
})
