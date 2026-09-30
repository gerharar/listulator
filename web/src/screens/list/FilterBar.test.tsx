// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FacetGroup } from '../../../../server/src/catalog/facets.js'
import { FilterBar, type FilterBarProps } from './FilterBar.js'
import { hoverTooltip } from '../../components/quantum/Tooltip/hoverTooltip.js'

afterEach(cleanup)

const platform: FacetGroup = {
  key: 'platform',
  label: 'Platform',
  options: [
    { key: 'ps3', label: 'PS3' },
    { key: 'pc', label: 'PC' },
    { key: '__untagged', label: '(unknown)' },
  ],
  keepOrder: true,
}

function bar(over: Partial<FilterBarProps> = {}) {
  const props: FilterBarProps = {
    text: '',
    onText: vi.fn(),
    facets: [],
    selection: {},
    onSelect: vi.fn(),
    fold: null,
    note: '8 items',
    ...over,
  }
  render(<FilterBar {...props} />)

  return props
}

describe('FilterBar', () => {
  it('always has the text field and the note', () => {
    bar()
    expect(screen.getByPlaceholderText('Filter items…')).toBeTruthy()
    expect(screen.getByText('8 items')).toBeTruthy()
  })

  it('keeps the OS from spell-checking or correcting what is typed', () => {
    bar()
    const input = screen.getByPlaceholderText('Filter items…')
    expect(input.getAttribute('spellcheck')).toBe('false')
    expect(input.getAttribute('autocorrect')).toBe('off')
    expect(input.getAttribute('autocapitalize')).toBe('off')
  })

  it('reports what is typed', () => {
    const props = bar()
    fireEvent.change(screen.getByPlaceholderText('Filter items…'), { target: { value: 'creed' } })
    expect(props.onText).toHaveBeenCalledWith('creed')
  })

  it('shows no facet row for a category without facets', () => {
    bar()
    expect(screen.queryByText('Platform')).toBeNull()
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull()
  })

  it('shows a facet row with All and one button per option', () => {
    bar({ facets: [platform] })
    expect(screen.getByText('Platform')).toBeTruthy()
    for (const name of ['All', 'PS3', 'PC', '(unknown)']) expect(screen.getByRole('button', { name })).toBeTruthy()
  })

  it('puts a facet’s options A–Z by shown name, Untagged last, unless it keeps its own order (owner, 2026-09-27)', () => {
    const medium: FacetGroup = {
      key: 'type',
      label: 'Medium',
      options: [
        { key: 'movie', label: 'Movie' },
        { key: '__untagged', label: '(unknown)' },
        { key: 'game', label: 'Game' },
        { key: 'book', label: 'Book' },
      ],
      keepOrder: false,
    }
    bar({ facets: [medium] })
    const names = () => screen.getAllByRole('button').map((button) => button.textContent).filter((name) => name !== 'All')
    expect(names().slice(0, 4)).toEqual(['Book', 'Game', 'Movie', '(unknown)'])

    cleanup()
    bar({ facets: [{ ...medium, keepOrder: true }] })
    expect(names().slice(0, 4)).toEqual(['Movie', '(unknown)', 'Game', 'Book'])
  })

  it('marks a flag’s option with the chip’s dot, to its left, as a hint (owner)', () => {
    const recording: FacetGroup = { key: 'extra', label: 'Recording', options: [{ key: 'live', label: 'Live' }], keepOrder: false, flag: true }
    bar({ facets: [platform, recording] })

    const live = screen.getByRole('button', { name: 'Live' })
    expect(live.firstElementChild?.classList.contains('q-facet-mark')).toBe(true)
    expect(screen.getByRole('button', { name: 'PS3' }).querySelector('.q-facet-mark')).toBeNull()
  })

  it('toggles an option additively and clears with All', () => {
    const props = bar({ facets: [platform], selection: { platform: new Set(['ps3']) } })
    fireEvent.click(screen.getByRole('button', { name: 'PC' }))
    expect(props.onSelect).toHaveBeenCalledWith('platform', new Set(['ps3', 'pc']))
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(props.onSelect).toHaveBeenLastCalledWith('platform', new Set())
  })

  it('lights All instead when the last remaining option is picked (U1)', () => {
    const props = bar({ facets: [platform], selection: { platform: new Set(['ps3', 'pc']) } })

    fireEvent.click(screen.getByRole('button', { name: '(unknown)' }))

    expect(props.onSelect).toHaveBeenCalledWith('platform', new Set())
  })

  it('names a platform in full in its hint', async () => {
    bar({ facets: [platform] })
    expect(await hoverTooltip(screen.getByRole('button', { name: 'PS3' }))).toContain('PlayStation 3')
  })

  it('offers fold-all only when told, and says which way it will go', () => {
    const onToggle = vi.fn()
    bar({ fold: { collapse: true, onToggle } })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(onToggle).toHaveBeenCalled()
  })

  it('reads Expand all when nothing is open', () => {
    bar({ fold: { collapse: false, onToggle: vi.fn() } })
    expect(screen.getByRole('button', { name: 'Expand' })).toBeTruthy()
  })
})
