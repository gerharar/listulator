// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FacetGroup } from '../../../../server/src/catalog/facets.js'
import { FilterBar, type FilterBarProps } from './FilterBar.js'

afterEach(cleanup)

const platform: FacetGroup = {
  key: 'platform',
  label: 'Platform',
  options: [
    { key: 'ps3', label: 'PS3' },
    { key: 'pc', label: 'PC' },
    { key: '__untagged', label: 'Untagged' },
  ],
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
    for (const name of ['All', 'PS3', 'PC', 'Untagged']) expect(screen.getByRole('button', { name })).toBeTruthy()
  })

  it('toggles an option additively and clears with All', () => {
    const props = bar({ facets: [platform], selection: { platform: new Set(['ps3']) } })
    fireEvent.click(screen.getByRole('button', { name: 'PC' }))
    expect(props.onSelect).toHaveBeenCalledWith('platform', new Set(['ps3', 'pc']))
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(props.onSelect).toHaveBeenLastCalledWith('platform', new Set())
  })

  it('names a platform in full in its hint', () => {
    bar({ facets: [platform] })
    expect(screen.getByRole('button', { name: 'PS3' }).getAttribute('title')).toContain('PlayStation 3')
  })

  it('offers fold-all only when told, and says which way it will go', () => {
    const onToggle = vi.fn()
    bar({ fold: { collapse: true, onToggle } })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(onToggle).toHaveBeenCalled()
  })

  it('reads Expand all when nothing is open', () => {
    bar({ fold: { collapse: false, onToggle: vi.fn() } })
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeTruthy()
  })
})
