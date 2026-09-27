// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { GroupCombobox } from './GroupCombobox.js'

afterEach(cleanup)

const GROUPS = ['Season 1', 'Season 2', 'Specials']

/** Controlled, as the forms use it. */
function Harness({ initial = '', onChange = vi.fn() }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial)

  return (
    <GroupCombobox
      label="Group"
      groups={GROUPS}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

const input = () => screen.getByRole('combobox') as HTMLInputElement
const options = () => screen.queryAllByRole('option').map((option) => option.textContent)

describe('GroupCombobox', () => {
  it('is closed until the field is focused', () => {
    render(<Harness />)

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input().getAttribute('aria-expanded')).toBe('false')

    fireEvent.focus(input())
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(input().getAttribute('aria-expanded')).toBe('true')
  })

  it('lists the list’s groups in their order, with no-group first', () => {
    render(<Harness />)
    fireEvent.focus(input())

    expect(options()).toEqual(['No group', 'Season 1', 'Season 2', 'Specials'])
  })

  it('picks an existing group by click, and closes', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.focus(input())

    fireEvent.click(screen.getByRole('option', { name: 'Season 2' }))

    expect(onChange).toHaveBeenLastCalledWith('Season 2')
    expect(input().value).toBe('Season 2')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('filters the groups as you type, ignoring case', () => {
    render(<Harness />)
    fireEvent.focus(input())

    fireEvent.change(input(), { target: { value: 'seas' } })

    expect(options().filter((text) => !text?.startsWith('+'))).toEqual(['Season 1', 'Season 2'])
  })

  it('offers to create a name that is not a group yet, and picks it on click', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: 'Season 3' } })

    fireEvent.click(screen.getByRole('option', { name: /Create “Season 3”/ }))

    expect(onChange).toHaveBeenLastCalledWith('Season 3')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not offer to create a name that already exists, whatever its case', () => {
    render(<Harness />)
    fireEvent.focus(input())

    fireEvent.change(input(), { target: { value: 'season 1' } })

    expect(options().some((text) => text?.startsWith('+'))).toBe(false)
  })

  it('does not offer to create from blank text', () => {
    render(<Harness />)
    fireEvent.focus(input())

    fireEvent.change(input(), { target: { value: '   ' } })

    expect(options().some((text) => text?.startsWith('+'))).toBe(false)
  })

  it('picks no group from the first option', () => {
    const onChange = vi.fn()
    render(<Harness initial="Season 1" onChange={onChange} />)
    fireEvent.focus(input())

    fireEvent.click(screen.getByRole('option', { name: 'No group' }))

    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('walks the options with the arrow keys and picks with Enter', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.focus(input())

    fireEvent.keyDown(input(), { key: 'ArrowDown' }) // No group
    fireEvent.keyDown(input(), { key: 'ArrowDown' }) // Season 1
    fireEvent.keyDown(input(), { key: 'ArrowDown' }) // Season 2
    fireEvent.keyDown(input(), { key: 'ArrowUp' }) // Season 1
    fireEvent.keyDown(input(), { key: 'Enter' })

    expect(onChange).toHaveBeenLastCalledWith('Season 1')
  })

  it('keeps what was typed when Enter is pressed with nothing highlighted', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: 'Brand new' } })

    fireEvent.keyDown(input(), { key: 'Enter' })

    expect(input().value).toBe('Brand new')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on Escape and says the key was used, so an enclosing popover stays open', () => {
    render(<Harness />)
    fireEvent.focus(input())
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const stop = vi.spyOn(event, 'stopPropagation')

    act(() => {
      input().dispatchEvent(event)
    })

    expect(stop).toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not swallow Escape when it is already closed', () => {
    render(<Harness />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const stop = vi.spyOn(event, 'stopPropagation')

    input().dispatchEvent(event)

    expect(stop).not.toHaveBeenCalled()
  })

  it('closes when focus leaves', () => {
    render(<Harness />)
    fireEvent.focus(input())

    fireEvent.blur(input())

    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('turns spellcheck off: group names are names', () => {
    render(<Harness />)

    expect(input().getAttribute('spellcheck')).toBe('false')
  })

  it('shows the label', () => {
    render(<Harness />)

    expect(screen.getByLabelText('Group')).toBe(input())
  })

  it('opens its list upward when the field sits too low in the window for it to fit below', () => {
    render(<Harness />)
    input().getBoundingClientRect = () => ({ top: 820, bottom: 857, left: 0, right: 200, width: 200, height: 37, x: 0, y: 820, toJSON: () => ({}) })
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })

    fireEvent.focus(input())

    expect(screen.getByRole('listbox').classList.contains('up')).toBe(true)
  })

  it('says it takes a new name while it has focus, and No group otherwise (owner)', () => {
    render(<Harness />)
    expect(input().placeholder).toBe('No group')

    fireEvent.focus(input())
    expect(input().placeholder).toBe('Type to create new')
    // Clearing the group is still one pick away.
    expect(options()[0]).toBe('No group')

    fireEvent.blur(input())
    expect(input().placeholder).toBe('No group')
  })
})
