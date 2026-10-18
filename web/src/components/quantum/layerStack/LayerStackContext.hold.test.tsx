// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LayerStackProvider, useLayerStack, useNavigationHold, type NavigationHold, type NavigationRun } from './LayerStackContext.js'
import type { LayerDescriptor } from './layerStack.js'

afterEach(cleanup)

const layer = (id: string, kind = 'screen'): LayerDescriptor<string> => ({ id, kind, tabLabel: id, content: `/${id}` })

let acquire: (run?: NavigationRun) => NavigationHold
let held = false
let runNow: ReturnType<typeof useLayerStack>['navigationRun'] = null

function Demo() {
  const { stack, push, pop, popToIndex, replaceTop, landOnList, navigationHeld, navigationRun } = useLayerStack()
  held = navigationHeld
  runNow = navigationRun
  acquire = useNavigationHold()
  return (
    <div>
      <span data-testid="stack">{stack.map((l) => l.id).join(',')}</span>
      <button onClick={() => push(layer('b'))}>push</button>
      <button onClick={() => pop()}>pop</button>
      <button onClick={() => popToIndex(0)}>home</button>
      <button onClick={() => replaceTop(layer('c'))}>replace</button>
      <button onClick={() => landOnList(layer('d', 'list'))}>land</button>
    </div>
  )
}

function mount() {
  render(
    <LayerStackProvider home={layer('home')}>
      <Demo />
    </LayerStackProvider>,
  )
  act(() => screen.getByText('push').click())
}
const stack = () => screen.getByTestId('stack').textContent
const press = (name: string) => act(() => screen.getByText(name).click())

describe('holding the navigation while a whole-list run goes on (Phase 28 follow-up)', () => {
  it('changes nothing in the stack while held: not a pop, a pop to Home, a push, a replace or a landing', () => {
    mount()
    expect(stack()).toBe('home,b')
    let hold!: NavigationHold
    act(() => void (hold = acquire()))

    for (const name of ['pop', 'home', 'push', 'replace', 'land']) press(name)

    expect(stack()).toBe('home,b')
    act(() => hold.release())
  })

  it('works again once released, and a second release changes nothing', () => {
    mount()
    let hold!: NavigationHold
    act(() => void (hold = acquire()))
    press('pop')
    expect(stack()).toBe('home,b')

    act(() => hold.release())
    act(() => hold.release())
    press('pop')

    expect(stack()).toBe('home')
  })

  it('two holds need two releases', () => {
    mount()
    let first!: NavigationHold
    let second!: NavigationHold
    act(() => {
      first = acquire()
      second = acquire()
    })
    act(() => first.release())
    press('pop')
    expect(stack()).toBe('home,b')

    act(() => second.release())
    press('pop')

    expect(stack()).toBe('home')
  })

  it('says whether anything holds it, for the header\'s Quit to warn', () => {
    mount()
    expect(held).toBe(false)
    let first!: NavigationHold
    let second!: NavigationHold
    act(() => {
      first = acquire()
      second = acquire()
    })
    expect(held).toBe(true)

    act(() => first.release())
    expect(held).toBe(true)
    act(() => second.release())

    expect(held).toBe(false)
  })

  it('holds nothing, and does not throw, with no layer stack around it (a screen under test)', () => {
    let hold: NavigationHold | undefined
    function Alone() {
      hold = useNavigationHold()()
      return null
    }
    render(<Alone />)

    expect(() => hold!.release()).not.toThrow()
  })
})

describe('what the run is, for the controls that wait for it (H-015)', () => {
  it('names the run while it holds, and nothing after it is released', () => {
    mount()
    expect(runNow).toBeNull()

    let hold!: NavigationHold
    act(() => void (hold = acquire({ kind: 'reset', listName: 'Loki' })))
    expect(runNow).toMatchObject({ kind: 'reset', listName: 'Loki' })
    expect(held).toBe(true)

    act(() => hold.release())
    expect(runNow).toBeNull()
    expect(held).toBe(false)
  })

  it('a hold with no run still holds, and names nothing', () => {
    mount()
    let hold!: NavigationHold
    act(() => void (hold = acquire()))

    expect(held).toBe(true)
    expect(runNow).toBeNull()
    act(() => hold.release())
  })

  it('every run has its own id, so a sentence said once per run is said again for the next one', () => {
    mount()
    let first!: NavigationHold
    act(() => void (first = acquire({ kind: 'reset', listName: 'Loki' })))
    const firstId = runNow!.id
    act(() => first.release())

    let second!: NavigationHold
    act(() => void (second = acquire({ kind: 'reset', listName: 'Loki' })))

    expect(runNow!.id).not.toBe(firstId)
    act(() => second.release())
  })
})
