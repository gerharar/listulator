// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { setActiveLanguage } from '../../../locale/index.js'
import { CrossHintRow, type CrossHintRowProps } from './CrossHintRow.js'
import type { CrossHintList } from './crossHint.js'

afterEach(() => {
  cleanup()
  setActiveLanguage('en')
})

const MAIN: CrossHintList = {
  externalRef: 'canonical:lists/mega/breaking-bad-main-watch.yaml',
  title: 'Breaking Bad franchise - main list',
  description: 'Main releases in the recommended viewing order',
  itemCount: 126,
}
const ALL: CrossHintList = {
  externalRef: 'canonical:lists/mega/breaking-bad-all.yaml',
  title: 'Breaking Bad franchise - full list',
  description: 'Every release, in release order',
  itemCount: 197,
}
const third = (n: number): CrossHintList => ({ externalRef: `canonical:lists/mega/extra-${n}.yaml`, title: `Extra list ${n}`, itemCount: n })

function renderRow(over: Partial<CrossHintRowProps> = {}) {
  const props: CrossHintRowProps = {
    lists: [MAIN, ALL],
    categoryLabel: 'Mega',
    expanded: false,
    onToggle: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  }

  return { props, ...render(<CrossHintRow {...props} />) }
}

const row = () => screen.getByRole('button', { name: /Fuller list/ })

describe('the row, folded', () => {
  it('says Fuller lists in Mega for several, with the count and the unit lists, and the first list’s description under it', () => {
    const { container } = renderRow()

    expect(screen.getByText('Fuller lists in Mega')).toBeTruthy()
    expect(container.querySelector('.n')?.firstChild?.textContent).toBe('2')
    expect(container.querySelector('.n .q-kicker')?.textContent).toBe('lists')
    expect(screen.getByText('Main releases in the recommended viewing order')).toBeTruthy()
    expect(row().getAttribute('aria-expanded')).toBe('false')
  })

  it('says Fuller list in Mega and 1 list for a single match', () => {
    const { container } = renderRow({ lists: [MAIN] })

    expect(screen.getByText('Fuller list in Mega')).toBeTruthy()
    expect(container.querySelector('.n .q-kicker')?.textContent).toBe('list')
  })

  it('has no subline when the first list has no description', () => {
    const { container } = renderRow({ lists: [{ externalRef: 'canonical:lists/mega/mcu.yaml', title: 'MCU', itemCount: 23 }] })

    expect(container.querySelector('.q-hint .meta')).toBeNull()
  })

  it('draws the folded ▶ and, open, the ▼, like every result row', () => {
    const { container, rerender, props } = renderRow()
    expect(container.querySelector('.chev')?.textContent).toBe('▶')

    rerender(<CrossHintRow {...props} expanded />)

    expect(container.querySelector('.chev')?.textContent).toBe('▼')
  })

  it('names the Mega category with its icon, in ink, never the curated star', () => {
    const { container } = renderRow()

    expect(container.querySelector('.q-hint-icon')).not.toBeNull()
    expect(container.querySelector('.q-star')).toBeNull()
  })

  it('toggles from a click and from Enter or Space, and never opens Mega by itself', () => {
    const { props } = renderRow()

    fireEvent.click(row())
    fireEvent.keyDown(row(), { key: 'Enter' })
    fireEvent.keyDown(row(), { key: ' ' })

    expect(props.onToggle).toHaveBeenCalledTimes(3)
    expect(props.onOpen).not.toHaveBeenCalled()
  })
})

describe('the row, open', () => {
  it('shows one sub-row per list with its title, its description and its item count, and an Open button each', () => {
    const { container } = renderRow({ expanded: true })
    const subRows = container.querySelectorAll('.q-hint-list')

    expect(subRows).toHaveLength(2)
    expect(within(subRows[0] as HTMLElement).getByText('Breaking Bad franchise - main list')).toBeTruthy()
    expect(within(subRows[0] as HTMLElement).getByText('Main releases in the recommended viewing order · 126 items')).toBeTruthy()
    expect(within(subRows[1] as HTMLElement).getByText('Every release, in release order · 197 items')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Add List/ })).toBeNull()
  })

  it('falls back to just the count, or just the description, when the other is missing', () => {
    renderRow({
      expanded: true,
      lists: [
        { externalRef: 'canonical:lists/mega/a.yaml', title: 'A', itemCount: 1 },
        { externalRef: 'canonical:lists/mega/b.yaml', title: 'B', description: 'Only a description' },
      ],
    })

    expect(screen.getByText('1 item')).toBeTruthy()
    expect(screen.getByText('Only a description')).toBeTruthy()
  })

  it('opens Mega with the list that was chosen', () => {
    const { props } = renderRow({ expanded: true })

    fireEvent.click(screen.getByRole('button', { name: 'Open Breaking Bad franchise - full list' }))

    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(ALL)
    expect(props.onToggle).not.toHaveBeenCalled()
  })

  it('shows two lists at most, then See all N in Mega, which opens Mega with no list open', () => {
    const { props } = renderRow({ expanded: true, lists: [MAIN, ALL, third(3), third(4), third(5)] })

    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(2)
    expect(screen.queryByText('Extra list 3')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'See all 5 in Mega' }))

    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('has no See all when two lists or fewer are all there is', () => {
    renderRow({ expanded: true })

    expect(screen.queryByRole('button', { name: /See all/ })).toBeNull()
  })

  it('folds the row from the empty space of the details, but not from a button', () => {
    const { container, props } = renderRow({ expanded: true })

    fireEvent.click(container.querySelector('.q-result-more')!)
    expect(props.onToggle).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Open Breaking Bad franchise - main list' }))
    expect(props.onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('in other languages', () => {
  it.each([
    ['de', 'Umfassendere Listen in Mega'],
    ['ru', 'Более полные списки в Mega'],
  ] as const)('%s: says its own title', (language, title) => {
    setActiveLanguage(language)
    renderRow()

    expect(screen.getByText(title)).toBeTruthy()
  })
})
