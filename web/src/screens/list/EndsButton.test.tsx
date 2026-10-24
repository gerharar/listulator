// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EndsButton } from './EndsButton.js'

/** The split Up / Down button in the toolbar (H-019): two halves in one box, each going to an end of the list. */

afterEach(cleanup)

describe('EndsButton', () => {
  it('is one group of two buttons with the design’s names', () => {
    render(<EndsButton atTop={false} atBottom={false} onGo={() => {}} />)

    const group = screen.getByRole('group', { name: 'Jump to an end of the list' })
    expect(group.querySelectorAll('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Scroll to the top of the list' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Scroll to the bottom of the list' })).toBeTruthy()
  })

  it('has no text, only the two arrows', () => {
    render(<EndsButton atTop={false} atBottom={false} onGo={() => {}} />)

    expect(screen.getByRole('group').textContent).toBe('')
    expect(screen.getByRole('group').querySelectorAll('svg')).toHaveLength(2)
  })

  it('asks for the top from the upper half and the bottom from the lower', () => {
    const onGo = vi.fn()
    render(<EndsButton atTop={false} atBottom={false} onGo={onGo} />)

    fireEvent.click(screen.getByRole('button', { name: 'Scroll to the top of the list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to the bottom of the list' }))

    expect(onGo.mock.calls).toEqual([['top'], ['bottom']])
  })

  it('disables the half whose end the list is at', () => {
    const { rerender } = render(<EndsButton atTop atBottom={false} onGo={() => {}} />)
    expect((screen.getByRole('button', { name: 'Scroll to the top of the list' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Scroll to the bottom of the list' }) as HTMLButtonElement).disabled).toBe(false)

    rerender(<EndsButton atTop={false} atBottom onGo={() => {}} />)
    expect((screen.getByRole('button', { name: 'Scroll to the top of the list' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Scroll to the bottom of the list' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does nothing from a disabled half', () => {
    const onGo = vi.fn()
    render(<EndsButton atTop atBottom onGo={onGo} />)

    fireEvent.click(screen.getByRole('button', { name: 'Scroll to the top of the list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to the bottom of the list' }))

    expect(onGo).not.toHaveBeenCalled()
  })
})
