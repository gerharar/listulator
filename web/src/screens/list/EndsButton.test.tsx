// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { en } from '../../locale/en.js'
import { hoverTooltip } from '../../components/quantum/Tooltip/hoverTooltip.js'
import { EndsButton } from './EndsButton.js'

/** The split Up / Down button in the toolbar (H-019): two halves in one box, each going to an end of the list. */

afterEach(cleanup)

describe('EndsButton', () => {
  it('is one group of two buttons with the design’s names', () => {
    render(<EndsButton atTop={false} atBottom={false} inView={false} onGo={() => {}} />)

    const group = screen.getByRole('group', { name: 'Jump to an end of the list' })
    expect(group.querySelectorAll('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Scroll to the top of the list' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Scroll to the bottom of the list' })).toBeTruthy()
  })

  it('has no text, only the two arrows', () => {
    render(<EndsButton atTop={false} atBottom={false} inView={false} onGo={() => {}} />)

    expect(screen.getByRole('group').textContent).toBe('')
    expect(screen.getByRole('group').querySelectorAll('svg')).toHaveLength(2)
  })

  it('asks for the top from the upper half and the bottom from the lower', () => {
    const onGo = vi.fn()
    render(<EndsButton atTop={false} atBottom={false} inView={false} onGo={onGo} />)

    fireEvent.click(screen.getByRole('button', { name: 'Scroll to the top of the list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to the bottom of the list' }))

    expect(onGo.mock.calls).toEqual([['top'], ['bottom']])
  })

  it('disables the half whose end the list is at', () => {
    const { rerender } = render(<EndsButton atTop atBottom={false} inView={false} onGo={() => {}} />)
    expect((screen.getByRole('button', { name: 'Scroll to the top of the list' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Scroll to the bottom of the list' }) as HTMLButtonElement).disabled).toBe(false)

    rerender(<EndsButton atTop={false} atBottom inView={false} onGo={() => {}} />)
    expect((screen.getByRole('button', { name: 'Scroll to the top of the list' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Scroll to the bottom of the list' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does nothing from a disabled half', () => {
    const onGo = vi.fn()
    render(<EndsButton atTop atBottom inView={false} onGo={onGo} />)

    fireEvent.click(screen.getByRole('button', { name: 'Scroll to the top of the list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to the bottom of the list' }))

    expect(onGo).not.toHaveBeenCalled()
  })
})

describe('EndsButton while the whole list is in view (H-019, revision 2026-10-27)', () => {
  const tip = en.quantum.list.ends.inView

  it('disables both halves, whichever end the scroller reports', () => {
    render(<EndsButton atTop={false} atBottom={false} inView onGo={() => {}} />)

    expect((screen.getByRole('button', { name: 'Scroll to the top of the list' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Scroll to the bottom of the list' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says why on the group, which a disabled half cannot: described, and a tooltip on hover', async () => {
    render(<EndsButton atTop atBottom inView onGo={() => {}} />)
    const group = screen.getByRole('group', { name: 'Jump to an end of the list' })

    expect(group.getAttribute('aria-description')).toBe(tip)
    expect(await hoverTooltip(group)).toBe(tip)
  })

  it('gives the pointer over either half the group’s tooltip, not the half’s own (“Go to the top …”)', async () => {
    render(<EndsButton atTop atBottom inView onGo={() => {}} />)

    expect(await hoverTooltip(screen.getByRole('button', { name: 'Scroll to the top of the list' }))).toBe(tip)
    expect(await hoverTooltip(screen.getByRole('button', { name: 'Scroll to the bottom of the list' }))).toBe(tip)
  })

  it('says nothing about the list being in view when it is not', async () => {
    render(<EndsButton atTop atBottom={false} inView={false} onGo={() => {}} />)
    const group = screen.getByRole('group', { name: 'Jump to an end of the list' })

    expect(group.getAttribute('aria-description')).toBeNull()
    expect(await hoverTooltip(group)).toBeNull()
  })
})
