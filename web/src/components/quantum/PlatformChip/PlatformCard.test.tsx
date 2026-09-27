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
    expect(screen.getByText('WIN', { selector: '.code' })).toBeTruthy()
  })

  it('makes the code column as wide as the longest code, so a long one never runs into the name (F10)', () => {
    render(<PlatformCard tags={['PC', 'XBOX360', 'Windows']} />)

    expect((document.querySelector('.q-platcard') as HTMLElement).style.getPropertyValue('--code-w')).toBe('7ch')
  })

  it('keeps the design’s 5ch code column for short codes', () => {
    render(<PlatformCard tags={['PS3', 'pc']} />)

    expect((document.querySelector('.q-platcard') as HTMLElement).style.getPropertyValue('--code-w')).toBe('5ch')
  })

  it('shows old codes as today’s, in capitals (10.24c)', () => {
    render(<PlatformCard tags={['PC', 'firetv']} />)
    expect(screen.getByText('WIN', { selector: '.code' })).toBeTruthy()
    expect(screen.getByText('Windows')).toBeTruthy()
    expect(screen.getByText('FIRETV', { selector: '.code' })).toBeTruthy()
  })

  it('shows a bare multi like any code the table does not know: no claim behind it (owner, U5)', () => {
    render(<PlatformCard tags={['multi']} />)
    expect(screen.queryByText('Multi-platform')).toBeNull()
    expect(screen.getByText('MULTI', { selector: '.code' })).toBeTruthy()
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
