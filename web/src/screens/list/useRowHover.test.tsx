// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useRef, useState } from 'react'
import { useRowHover } from './useRowHover.js'

/** The row tint that follows the pointer (BL-105): driven by the pointer's own events, never the engine's sticky `:hover`. */

let setSuspended: (value: boolean) => void
let bump: () => void

function Rows() {
  const container = useRef<HTMLDivElement>(null)
  const [suspended, setSuspendedState] = useState(false)
  const [done, setDone] = useState(false)
  setSuspended = setSuspendedState
  bump = () => setDone((value) => !value)
  useRowHover(container, suspended)

  return (
    <div ref={container} data-testid="list">
      {['a', 'b', 'c'].map((id) => (
        <div key={id} className={id === 'a' && done ? 'q-item is-done' : 'q-item'} data-row-id={id}>
          <span className="title">{id}</span>
        </div>
      ))}
    </div>
  )
}

afterEach(cleanup)

const row = (id: string) => document.querySelector(`[data-row-id="${id}"]`) as HTMLElement
const tinted = () => Array.from(document.querySelectorAll('[data-pointer]')).map((node) => (node as HTMLElement).dataset['rowId'])
const move = (target: Element, pointerType = 'mouse') => fireEvent.pointerMove(target, { pointerType, clientX: 10, clientY: 10 })

describe('the row under the mouse takes the tint', () => {
  it('only the row the pointer is over, wherever inside it, and it follows the pointer', () => {
    render(<Rows />)

    move(row('a').querySelector('.title')!)
    expect(tinted()).toEqual(['a'])

    move(row('c'))
    expect(tinted()).toEqual(['c'])
  })

  it('goes when the pointer leaves the list', () => {
    render(<Rows />)
    move(row('b'))

    fireEvent.pointerLeave(document.querySelector('[data-testid="list"]')!)

    expect(tinted()).toEqual([])
  })

  it('is for a mouse or a pen: a touch leaves no tint behind', () => {
    render(<Rows />)

    move(row('a'), 'touch')

    expect(tinted()).toEqual([])
    move(row('a'), 'pen')
    expect(tinted()).toEqual(['a'])
  })

  it('survives the row being drawn again with another class (a tick), which would wipe a class', () => {
    render(<Rows />)
    move(row('a'))

    act(() => bump())

    expect(row('a').className).toBe('q-item is-done')
    expect(tinted()).toEqual(['a'])
  })

  it('while suspended (an item is carried) clears every tint and takes none; when it lets go none is left over until the pointer moves again', () => {
    render(<Rows />)
    move(row('a'))
    move(row('b'))

    act(() => setSuspended(true))
    expect(tinted()).toEqual([])
    move(row('c'))
    expect(tinted()).toEqual([])

    act(() => setSuspended(false))
    expect(tinted()).toEqual([])
    move(row('c'))
    expect(tinted()).toEqual(['c'])
  })

  it('follows a scroll under a still pointer: the row that arrives under it takes the tint', () => {
    render(<Rows />)
    move(row('a'))
    const arrived = row('b')
    document.elementFromPoint = () => arrived
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => (callback(0), 0)) as typeof window.requestAnimationFrame

    fireEvent.scroll(document.querySelector('[data-testid="list"]')!)

    expect(tinted()).toEqual(['b'])
  })

  it('a scroll before the pointer ever moved over the list tints nothing', () => {
    render(<Rows />)
    document.elementFromPoint = () => row('b')
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => (callback(0), 0)) as typeof window.requestAnimationFrame

    fireEvent.scroll(document.querySelector('[data-testid="list"]')!)

    expect(tinted()).toEqual([])
  })

  it('goes when the window loses focus', () => {
    render(<Rows />)
    move(row('a'))

    fireEvent.blur(window)

    expect(tinted()).toEqual([])
  })
})
