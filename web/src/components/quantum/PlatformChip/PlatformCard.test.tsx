// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PlatformCard } from './PlatformCard.js'
import { PlatformChip } from './PlatformChip.js'

afterEach(cleanup)

describe('PlatformCard', () => {
  it('names one platform in full', () => {
    render(<PlatformCard tags={['ps3']} />)
    expect(screen.getByText('Platform')).toBeTruthy()
    expect(screen.getByText('PS3')).toBeTruthy()
    expect(screen.getByText('PlayStation 3')).toBeTruthy()
  })

  it('lists several, counted, one row each', () => {
    render(<PlatformCard tags={['PS3', 'X360', 'pc']} />)
    expect(screen.getByText('Platforms · 3')).toBeTruthy()
    expect(screen.getByText('Xbox 360')).toBeTruthy()
    expect(screen.getByText('PC', { selector: '.code' })).toBeTruthy()
  })

  it('says a bare multi means every platform, unnamed', () => {
    render(<PlatformCard tags={['multi']} />)
    expect(screen.getByText('Multi-platform')).toBeTruthy()
    expect(screen.getByText(/Same game on every platform it shipped on/)).toBeTruthy()
    expect(document.querySelector('.q-platcard-row')).toBeNull()
  })

  it('shows a code the table does not know as its own caps text', () => {
    render(<PlatformCard tags={['dreamcast']} />)
    expect(screen.getAllByText('DREAMCAST').length).toBeGreaterThan(0)
  })
})

describe('PlatformChip as a button', () => {
  it('opens on click, handing over its own element, and never reaches the row', () => {
    const onOpen = vi.fn()
    const onRow = vi.fn()
    render(
      <div onClick={onRow}>
        <PlatformChip tags={['PS3', 'PC']} itemTitle="Assassin’s Creed" onOpen={onOpen} />
      </div>,
    )

    const chip = screen.getByRole('button', { name: /Assassin’s Creed/ })
    fireEvent.click(chip)

    expect(chip.textContent).toBe('MULTI')
    expect(onOpen).toHaveBeenCalledWith(chip)
    expect(onRow).not.toHaveBeenCalled()
  })

  it('leaves an untagged row an empty, unfocusable slot of the same width', () => {
    render(<PlatformChip tags={[]} itemTitle="Prologue" onOpen={vi.fn()} widthCh={5} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(document.querySelector('.q-plat-gap')).toBeTruthy()
  })
})
