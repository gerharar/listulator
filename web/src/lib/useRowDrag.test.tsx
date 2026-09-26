// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { autoscrollDelta, useRowDrag, type DropTarget } from './useRowDrag.js'

afterEach(() => {
  cleanup()
  document.body.className = ''
})

/** Three rows 40px tall stacked from y=100: a (100–140), b (140–180), c (180–220). */
const ROWS: Record<string, { top: number; height: number }> = { a: { top: 100, height: 40 }, b: { top: 140, height: 40 }, c: { top: 180, height: 40 } }

function Harness(props: {
  onDrop: (key: string, target: DropTarget) => void
  accepts?: (dragKey: string, targetKey: string) => boolean
  onStart?: (key: string) => void
  onEnd?: () => void
}) {
  const drag = useRowDrag({
    accepts: props.accepts ?? (() => true),
    onDrop: props.onDrop,
    ...(props.onStart ? { onStart: props.onStart } : {}),
    ...(props.onEnd ? { onEnd: props.onEnd } : {}),
  })

  return (
    <div>
      <span data-testid="state">{JSON.stringify({ drag: drag.dragKey, over: drag.over })}</span>
      {Object.keys(ROWS).map((key) => (
        <div
          key={key}
          data-testid={`row-${key}`}
          data-drag-key={key}
          ref={(el) => {
            if (el) {
              const { top, height } = ROWS[key]!
              el.getBoundingClientRect = () => ({ top, height, bottom: top + height, left: 0, right: 200, width: 200, x: 0, y: top, toJSON: () => ({}) })
            }
          }}
        >
          <span data-testid={`handle-${key}`} onPointerDown={(event) => drag.startDrag(event, key)}>
            ⣿
          </span>
        </div>
      ))}
    </div>
  )
}

const state = () => JSON.parse(screen.getByTestId('state').textContent!)

/** What is under the pointer at y: the row whose band holds it. */
function pointAt() {
  document.elementFromPoint = (_x: number, y: number) => {
    const key = Object.entries(ROWS).find(([, r]) => y >= r.top && y < r.top + r.height)?.[0]
    return key ? screen.getByTestId(`handle-${key}`) : null
  }
}

const press = (key: string, x = 10, y = 120, button = 0) =>
  fireEvent.pointerDown(screen.getByTestId(`handle-${key}`), { button, clientX: x, clientY: y })
const move = (x: number, y: number) => act(() => void window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true, cancelable: true })))
const release = (x: number, y: number) => act(() => void window.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y, bubbles: true })))

describe('useRowDrag', () => {
  it('is not a drag until the pointer has really moved, so a plain click on the handle does nothing', () => {
    pointAt()
    const onDrop = vi.fn()
    render(<Harness onDrop={onDrop} />)

    press('a')
    move(12, 122)
    release(12, 122)

    expect(state().drag).toBeNull()
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('starts once the pointer has moved past the threshold, from the handle, at once', () => {
    pointAt()
    const onStart = vi.fn()
    render(<Harness onDrop={vi.fn()} onStart={onStart} />)

    press('a')
    move(10, 140)

    expect(state().drag).toBe('a')
    expect(onStart).toHaveBeenCalledWith('a')
  })

  it('shows the drop line before a row in its upper half and after it in its lower half', () => {
    pointAt()
    render(<Harness onDrop={vi.fn()} />)
    press('a')

    move(10, 150)
    expect(state().over).toEqual({ key: 'b', pos: 'before' })

    move(10, 170)
    expect(state().over).toEqual({ key: 'b', pos: 'after' })
  })

  it('shows no line over the row being dragged, or over a row that will not take it', () => {
    pointAt()
    render(<Harness onDrop={vi.fn()} accepts={(_drag, target) => target !== 'c'} />)
    press('a')

    move(10, 130)
    expect(state().over).toBeNull()

    move(10, 190)
    expect(state().over).toBeNull()
  })

  it('drops onto what is under the pointer when it is released', () => {
    pointAt()
    const onDrop = vi.fn()
    render(<Harness onDrop={onDrop} />)
    press('a')
    move(10, 190)

    release(10, 190)

    expect(onDrop).toHaveBeenCalledWith('a', { key: 'c', pos: 'before' })
    expect(state()).toEqual({ drag: null, over: null })
  })

  it('reads the drop from where the pointer is released, not from the last move', () => {
    pointAt()
    const onDrop = vi.fn()
    render(<Harness onDrop={onDrop} />)
    press('a')
    move(10, 150)

    release(10, 175)

    expect(onDrop).toHaveBeenCalledWith('a', { key: 'b', pos: 'after' })
  })

  it('drops nothing when released over nothing, or over a row that will not take it', () => {
    pointAt()
    const onDrop = vi.fn()
    render(<Harness onDrop={onDrop} accepts={() => false} />)
    press('a')
    move(10, 200)
    release(10, 200)

    expect(onDrop).not.toHaveBeenCalled()

    press('a')
    move(10, 400)
    release(10, 400)
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('Escape puts it down without dropping', () => {
    pointAt()
    const onDrop = vi.fn()
    const onEnd = vi.fn()
    render(<Harness onDrop={onDrop} onEnd={onEnd} />)
    press('a')
    move(10, 200)

    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    release(10, 200)

    expect(onDrop).not.toHaveBeenCalled()
    expect(state().drag).toBeNull()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('Escape during a drag is not also seen by the Esc ladder (it would pop the list too)', () => {
    pointAt()
    const seenByLadder = vi.fn()
    document.addEventListener('keydown', seenByLadder)
    render(<Harness onDrop={vi.fn()} />)
    press('a')
    move(10, 200)

    act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

    expect(state().drag).toBeNull()
    expect(seenByLadder).not.toHaveBeenCalled()
    document.removeEventListener('keydown', seenByLadder)
  })

  it('once the drag is over, Escape reaches the ladder again', () => {
    pointAt()
    const seenByLadder = vi.fn()
    document.addEventListener('keydown', seenByLadder)
    render(<Harness onDrop={vi.fn()} />)
    press('a')
    move(10, 200)
    release(10, 200)

    act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

    expect(seenByLadder).toHaveBeenCalledOnce()
    document.removeEventListener('keydown', seenByLadder)
  })

  it('no text selection can start while the handle is held, drag or not (BL-019)', () => {
    pointAt()
    render(<Harness onDrop={vi.fn()} />)
    const selectStart = () => {
      const event = new Event('selectstart', { bubbles: true, cancelable: true })
      document.body.dispatchEvent(event)
      return event.defaultPrevented
    }

    press('a')
    expect(selectStart()).toBe(true)
    move(10, 200)
    expect(selectStart()).toBe(true)
    release(10, 200)

    expect(selectStart()).toBe(false)
  })

  it('drops any selection already on the page when the drag starts (BL-019)', () => {
    pointAt()
    render(<Harness onDrop={vi.fn()} />)
    window.getSelection()!.selectAllChildren(document.body)
    expect(window.getSelection()!.toString()).not.toBe('')

    press('a')
    move(10, 200)

    expect(window.getSelection()!.toString()).toBe('')
    release(10, 200)
  })

  it('a cancelled pointer (the system took it) ends the drag without dropping', () => {
    pointAt()
    const onDrop = vi.fn()
    render(<Harness onDrop={onDrop} />)
    press('a')
    move(10, 200)

    act(() => void window.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true })))

    expect(onDrop).not.toHaveBeenCalled()
    expect(state().drag).toBeNull()
  })

  it('ignores any button but the primary one', () => {
    pointAt()
    render(<Harness onDrop={vi.fn()} />)

    press('a', 10, 120, 2)
    move(10, 200)

    expect(state().drag).toBeNull()
  })

  it('stops the browser selecting text and shows a grabbing cursor for as long as it lasts (BL-019)', () => {
    pointAt()
    render(<Harness onDrop={vi.fn()} />)
    press('a')
    expect(document.body.classList.contains('q-dragging')).toBe(false)

    move(10, 160)
    expect(document.body.classList.contains('q-dragging')).toBe(true)

    release(10, 160)
    expect(document.body.classList.contains('q-dragging')).toBe(false)
  })

  it('takes the pointer’s moves for itself once a drag is on, so the page does not scroll or select', () => {
    pointAt()
    render(<Harness onDrop={vi.fn()} />)
    press('a')
    const before = new MouseEvent('pointermove', { clientX: 10, clientY: 121, bubbles: true, cancelable: true })
    const during = new MouseEvent('pointermove', { clientX: 10, clientY: 190, bubbles: true, cancelable: true })

    act(() => void window.dispatchEvent(before))
    act(() => void window.dispatchEvent(during))

    expect(before.defaultPrevented).toBe(false)
    expect(during.defaultPrevented).toBe(true)
  })

  it('stops listening once it is over: later moves change nothing', () => {
    pointAt()
    const onDrop = vi.fn()
    render(<Harness onDrop={onDrop} />)
    press('a')
    move(10, 200)
    release(10, 200)
    onDrop.mockClear()

    move(10, 150)
    release(10, 150)

    expect(onDrop).not.toHaveBeenCalled()
    expect(state()).toEqual({ drag: null, over: null })
  })

  it('tells its owner when it is over, however it ended', () => {
    pointAt()
    const onEnd = vi.fn()
    render(<Harness onDrop={vi.fn()} onEnd={onEnd} />)
    press('a')
    move(10, 200)

    release(10, 200)

    expect(onEnd).toHaveBeenCalledTimes(1)
  })
})

describe('autoscrollDelta', () => {
  const rect = { top: 100, bottom: 500 }

  it('is zero away from the edges', () => {
    expect(autoscrollDelta(300, rect)).toBe(0)
  })

  it('scrolls up near the top edge, faster the closer it gets', () => {
    const near = autoscrollDelta(110, rect)
    const closer = autoscrollDelta(101, rect)

    expect(near).toBeLessThan(0)
    expect(closer).toBeLessThan(near)
  })

  it('scrolls down near the bottom edge, faster the closer it gets', () => {
    const near = autoscrollDelta(490, rect)
    const closer = autoscrollDelta(499, rect)

    expect(near).toBeGreaterThan(0)
    expect(closer).toBeGreaterThan(near)
  })

  it('never scrolls faster than its top speed, even far outside the box', () => {
    expect(autoscrollDelta(-500, rect)).toBe(-18)
    expect(autoscrollDelta(9000, rect)).toBe(18)
  })
})
