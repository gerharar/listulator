// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DoneCheckbox } from './DoneCheckbox.js'

afterEach(cleanup)

describe('DoneCheckbox', () => {
  it.each([
    [false, 'false', ''],
    [true, 'true', '✓'],
    ['mixed', 'mixed', ''],
  ] as const)('with checked=%s it is aria-checked=%s and draws %j as text', (checked, aria, text) => {
    render(<DoneCheckbox checked={checked} onChange={vi.fn()} label="Box" />)

    const box = screen.getByRole('checkbox', { name: 'Box' })
    expect(box.getAttribute('aria-checked')).toBe(aria)
    expect(box.textContent).toBe(text)
  })

  it('asks for done from empty and from partly done, and for not done from done', () => {
    const onChange = vi.fn()
    const { rerender } = render(<DoneCheckbox checked={false} onChange={onChange} label="Box" />)

    fireEvent.click(screen.getByRole('checkbox'))
    rerender(<DoneCheckbox checked="mixed" onChange={onChange} label="Box" />)
    fireEvent.click(screen.getByRole('checkbox'))
    rerender(<DoneCheckbox checked onChange={onChange} label="Box" />)
    fireEvent.click(screen.getByRole('checkbox'))

    expect(onChange.mock.calls).toEqual([[true], [true], [false]])
  })

  it('lets its click and keys reach the row around it, as an item\'s box does', () => {
    const onClick = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <div onClick={onClick} onKeyDown={onKeyDown}>
        <DoneCheckbox checked={false} onChange={vi.fn()} label="Box" />
      </div>,
    )

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.keyDown(screen.getByRole('checkbox'), { key: 'Enter' })

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it('when isolated, keeps its click, Enter and Space from the row around it, but not the arrows', () => {
    const onClick = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <div onClick={onClick} onKeyDown={onKeyDown}>
        <DoneCheckbox checked={false} onChange={vi.fn()} label="Box" isolate />
      </div>,
    )
    const box = screen.getByRole('checkbox')

    fireEvent.click(box)
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.keyDown(box, { key: ' ' })

    expect(onClick).not.toHaveBeenCalled()
    expect(onKeyDown).not.toHaveBeenCalled()

    fireEvent.keyDown(box, { key: 'ArrowDown' })

    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it('takes a class of its own next to q-done', () => {
    render(<DoneCheckbox checked={false} onChange={vi.fn()} label="Box" className="q-group-done" />)

    expect(screen.getByRole('checkbox').className.split(' ')).toEqual(expect.arrayContaining(['q-done', 'q-group-done']))
  })
})
