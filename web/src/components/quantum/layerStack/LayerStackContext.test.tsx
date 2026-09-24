// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { ENTER_DURATION_MS, LayerStackProvider, useLayerStack } from './LayerStackContext.js'
import type { LayerDescriptor } from './layerStack.js'

afterEach(cleanup)

function layer(id: string, kind = 'screen'): LayerDescriptor<string> {
  return { id, kind, tabLabel: id, content: `/${id}` }
}

function Demo() {
  const { stack, visible, enteringId, push, pop, popToIndex, replaceTop } = useLayerStack()
  return (
    <div>
      <span data-testid="stack">{stack.map((l) => l.id).join(',')}</span>
      <span data-testid="visible">{visible.map((l) => l.id).join(',')}</span>
      <span data-testid="entering">{enteringId ?? ''}</span>
      <button onClick={() => push(layer('list'))}>push list</button>
      <button onClick={() => pop()}>pop</button>
      <button onClick={() => popToIndex(0)}>pop to home</button>
      <button onClick={() => replaceTop(layer('list-42'))}>replace top</button>
    </div>
  )
}

describe('LayerStackProvider', () => {
  it('seeds the stack with home, and re-renders on push/pop/popToIndex/replaceTop', () => {
    render(
      <LayerStackProvider home={layer('home')}>
        <Demo />
      </LayerStackProvider>,
    )

    expect(screen.getByTestId('stack').textContent).toBe('home')

    act(() => screen.getByText('push list').click())
    expect(screen.getByTestId('stack').textContent).toBe('home,list')
    expect(screen.getByTestId('visible').textContent).toBe('home,list')

    act(() => screen.getByText('replace top').click())
    expect(screen.getByTestId('stack').textContent).toBe('home,list-42')

    act(() => screen.getByText('pop').click())
    expect(screen.getByTestId('stack').textContent).toBe('home')

    // A no-op at depth 1 — should not throw, should not change anything.
    act(() => screen.getByText('pop').click())
    expect(screen.getByTestId('stack').textContent).toBe('home')
  })

  it('popToIndex pops straight to a given depth', () => {
    render(
      <LayerStackProvider home={layer('home')}>
        <Demo />
      </LayerStackProvider>,
    )

    act(() => screen.getByText('push list').click())
    act(() => screen.getByText('push list').click()) // home, list, list
    expect(screen.getByTestId('stack').textContent).toBe('home,list,list')

    act(() => screen.getByText('pop to home').click())
    expect(screen.getByTestId('stack').textContent).toBe('home')
  })

  it('useLayerStack throws outside a LayerStackProvider', () => {
    function Bare() {
      useLayerStack()
      return null
    }

    expect(() => render(<Bare />)).toThrow('useLayerStack must be used within a LayerStackProvider')
  })
})

describe('LayerStackProvider entering id', () => {
  it('has no entering layer before anything is pushed', () => {
    render(
      <LayerStackProvider home={layer('home')}>
        <Demo />
      </LayerStackProvider>,
    )

    expect(screen.getByTestId('entering').textContent).toBe('')
  })

  it('marks a pushed layer as entering, then clears it after the drum-in duration', () => {
    vi.useFakeTimers()
    try {
      render(
        <LayerStackProvider home={layer('home')}>
          <Demo />
        </LayerStackProvider>,
      )

      act(() => screen.getByText('push list').click())
      expect(screen.getByTestId('entering').textContent).toBe('list')

      act(() => vi.advanceTimersByTime(ENTER_DURATION_MS - 1))
      expect(screen.getByTestId('entering').textContent).toBe('list')

      act(() => vi.advanceTimersByTime(1))
      expect(screen.getByTestId('entering').textContent).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks a replaced top layer as entering too', () => {
    render(
      <LayerStackProvider home={layer('home')}>
        <Demo />
      </LayerStackProvider>,
    )

    act(() => screen.getByText('replace top').click())
    expect(screen.getByTestId('entering').textContent).toBe('list-42')
  })

  it('a pop does not touch entering id — only a push or replace ever sets one', () => {
    render(
      <LayerStackProvider home={layer('home')}>
        <Demo />
      </LayerStackProvider>,
    )

    act(() => screen.getByText('push list').click())
    act(() => screen.getByText('pop').click())
    expect(screen.getByTestId('entering').textContent).toBe('list')
  })
})
