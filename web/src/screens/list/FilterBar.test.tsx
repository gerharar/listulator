// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { FacetGroup } from '../../../../server/src/catalog/facets.js'
import { en } from '../../locale/en.js'
import { FilterBar, type FilterBarProps } from './FilterBar.js'
import { hoverTooltip } from '../../components/quantum/Tooltip/hoverTooltip.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'

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

const language: FacetGroup = {
  key: 'language',
  label: 'Language',
  options: [
    { key: 'en', label: 'EN' },
    { key: 'ja', label: 'JA' },
    { key: '__untagged', label: '(unknown)' },
  ],
  keepOrder: true,
}

function bar(over: Partial<FilterBarProps> = {}) {
  const props: FilterBarProps = {
    text: '',
    onText: vi.fn(),
    onClear: vi.fn(),
    facets: [],
    selection: {},
    onSelect: vi.fn(),
    fold: null,
    hideDone: null,
    ends: null,
    note: '8 items',
    noteRoom: '8 of 8 shown',
    ...over,
  }
  render(
    <OverlayManagerProvider>
      <FilterBar {...props} />
    </OverlayManagerProvider>,
  )

  return props
}

/** A facet's popover, opened from its button (every value facet is a dropdown, H-023). */
function openFacet(label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}: `) }))

  return within(screen.getByRole('dialog'))
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

  describe('the ✕ that clears the text (H-008)', () => {
    const input = () => screen.getByPlaceholderText('Filter items…') as HTMLInputElement
    const clear = () => screen.queryByRole('button', { name: 'Clear filter' })

    it('is only there while the field has text, spaces included', () => {
      bar({ text: '' })
      expect(clear()).toBeNull()
      cleanup()

      bar({ text: 'creed' })
      expect(clear()).not.toBeNull()
      cleanup()

      bar({ text: '   ' })
      expect(clear()).not.toBeNull()
    })

    it('asks to clear when pressed, and says what it is on hover', async () => {
      const props = bar({ text: 'creed' })

      expect(await hoverTooltip(clear()!)).toBe('Clear filter')
      fireEvent.click(clear()!)

      expect(props.onClear).toHaveBeenCalledTimes(1)
      expect(props.onText).not.toHaveBeenCalled()
    })

    it('keeps the cursor in the field: the press is not a press on a button that is about to go', () => {
      bar({ text: 'creed' })
      input().focus()

      // Cancelled mouse-down: the browser does not move focus to the button.
      expect(fireEvent.mouseDown(clear()!)).toBe(false)
      fireEvent.click(clear()!)

      expect(document.activeElement).toBe(input())
    })

    it('sits in the field’s own wrapper, with the room for it always reserved', () => {
      bar({ text: 'creed' })

      const wrapper = input().parentElement!
      expect(wrapper.contains(clear())).toBe(true)
      expect(wrapper.classList.contains('q-filter-field')).toBe(true)
      // The padding that keeps the text off the ✕ is the field's own, there with or without it (the css is read: jsdom has none).
      const css = readFileSync(join(import.meta.dirname, 'ListScreen.css'), 'utf8')
      expect(css).toMatch(/\.q-filter-input\s*\{[^}]*padding:\s*9px 30px 9px 12px/)
    })
  })

  it('does not handle Esc itself: the Esc ladder does, wherever the cursor is (H-008, owner 2026-10-15)', () => {
    const props = bar({ text: 'creed' })

    // Not prevented, nothing cleared by the bar: the step the list screen registers does it.
    expect(fireEvent.keyDown(screen.getByPlaceholderText('Filter items…'), { key: 'Escape' })).toBe(true)
    expect(props.onClear).not.toHaveBeenCalled()
  })

  it('shows no facet row for a category without facets', () => {
    bar()
    expect(screen.queryByText('Platform')).toBeNull()
    expect(screen.queryByRole('button', { name: /All/ })).toBeNull()
  })

  it('shows each facet as its label and one button, the options in its popover', () => {
    bar({ facets: [language] })

    expect(screen.getByText('Language')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'EN' })).toBeNull()
    const pop = openFacet('Language')
    for (const name of ['All', 'EN', 'JA', '(unknown)']) expect(pop.getByRole('button', { name })).toBeTruthy()
  })

  it('draws every value facet as a dropdown, never as chips, on any width (H-023)', () => {
    bar({ facets: [platform, language] })

    expect(document.querySelectorAll('.q-filterbar > .q-facet-drop')).toHaveLength(2)
    expect(document.querySelector('.q-filterbar .q-facet-seg')).toBeNull()
    expect(screen.queryByRole('button', { name: 'PS3' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'EN' })).toBeNull()
    const pop = openFacet('Platform')
    for (const name of ['All', 'PS3', 'PC', '(unknown)']) expect(pop.getByRole('button', { name })).toBeTruthy()
  })

  it('says what is picked on the button: names for one or two, a count for more', () => {
    const type: FacetGroup = {
      key: 'type',
      label: 'Medium',
      options: ['Book', 'Game', 'TV', 'Movie'].map((label) => ({ key: label.toLowerCase(), label })),
      keepOrder: true,
    }
    bar({ facets: [type], selection: { type: new Set(['book', 'tv']) } })
    expect(screen.getByRole('button', { name: 'Category: Book, TV' }).textContent).toBe('Book, TV')
    cleanup()

    bar({ facets: [type], selection: { type: new Set(['book', 'game', 'tv']) } })
    expect(screen.getByRole('button', { name: 'Category: Book, Game, TV' }).textContent).toBe('3 of 4')
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
    const names = () => within(screen.getByRole('dialog')).getAllByRole('button').map((button) => button.textContent).filter((name) => name !== 'All')
    openFacet('Category')
    expect(names().slice(0, 4)).toEqual(['Book', 'Game', 'Movie', '(unknown)'])

    cleanup()
    bar({ facets: [{ ...medium, keepOrder: true }] })
    openFacet('Category')
    expect(names().slice(0, 4)).toEqual(['Movie', '(unknown)', 'Game', 'Book'])
  })

  it('marks a flag’s option with the chip’s dot, to its left, as a hint (owner)', () => {
    const recording: FacetGroup = { key: 'extra', label: 'Recording', options: [{ key: 'live', label: 'Live' }], keepOrder: false, flag: true }
    bar({ facets: [language, recording] })

    const live = openFacet('Recording').getByRole('button', { name: 'Live' })
    expect(live.firstElementChild?.classList.contains('q-facet-mark')).toBe(true)
    cleanup()
    bar({ facets: [language, recording] })
    expect(openFacet('Language').getByRole('button', { name: 'EN' }).querySelector('.q-facet-mark')).toBeNull()
  })

  it('toggles an option additively and clears with All', () => {
    const props = bar({ facets: [language], selection: { language: new Set(['en']) } })
    const pop = openFacet('Language')
    fireEvent.click(pop.getByRole('button', { name: 'JA' }))
    expect(props.onSelect).toHaveBeenCalledWith('language', new Set(['en', 'ja']))
    fireEvent.click(pop.getByRole('button', { name: 'All' }))
    expect(props.onSelect).toHaveBeenLastCalledWith('language', new Set())
  })

  it('lights All instead when the last remaining option is picked (U1)', () => {
    const props = bar({ facets: [language], selection: { language: new Set(['en', 'ja']) } })

    fireEvent.click(openFacet('Language').getByRole('button', { name: '(unknown)' }))

    expect(props.onSelect).toHaveBeenCalledWith('language', new Set())
  })

  it('names a platform in full in its hint', async () => {
    bar({ facets: [platform] })
    expect(await hoverTooltip(openFacet('Platform').getByRole('button', { name: 'PS3' }))).toContain(
      'PlayStation 3',
    )
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

  it('offers Hide Completed, pressed while it is on, and reports a click', () => {
    const onToggle = vi.fn()
    bar({ hideDone: { on: false, onToggle } })

    const button = screen.getByRole('button', { name: en.quantum.list.filter.hideDone })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('shows Hide Completed pressed, with a hint that a click brings the done items back', async () => {
    bar({ hideDone: { on: true, onToggle: vi.fn() } })

    const button = screen.getByRole('button', { name: en.quantum.list.filter.hideDone })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(await hoverTooltip(button)).toContain('Show done items again')
  })

  it('puts Hide Completed just before fold-all', () => {
    bar({ hideDone: { on: false, onToggle: vi.fn() }, fold: { collapse: true, onToggle: vi.fn() } })

    const names = screen.getAllByRole('button').map((button) => button.textContent)
    expect(names.slice(-2)).toEqual([en.quantum.list.filter.hideDone, 'Collapse'])
  })

  it('puts the note before Hide Completed and fold-all, which keep to the right edge (owner, 2026-10-05)', () => {
    bar({ hideDone: { on: false, onToggle: vi.fn() }, fold: { collapse: true, onToggle: vi.fn() } })

    const note = screen.getByText('8 items')
    const hide = screen.getByRole('button', { name: en.quantum.list.filter.hideDone })
    expect(note.compareDocumentPosition(hide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps fold-all as wide as its longer word, so switching it moves nothing', () => {
    bar({ fold: { collapse: true, onToggle: vi.fn() } })

    const label = screen.getByText('Collapse')
    expect(label.closest('[data-room]')?.getAttribute('data-room')).toBe('Expand')
  })
})

describe('the split Up / Down button in the bar (H-019)', () => {
  it('comes last, after Hide Completed and Collapse, and only when it is given', () => {
    bar({ fold: { collapse: true, onToggle: vi.fn() }, hideDone: { on: false, onToggle: vi.fn() }, ends: { atTop: true, atBottom: false, inView: false, onGo: vi.fn() } })

    const parts = [...document.querySelectorAll('.q-filterbar > *')]
    expect(parts.at(-1)).toBe(screen.getByRole('group', { name: 'Jump to an end of the list' }))
    expect(parts.at(-2)!.classList.contains('q-fold')).toBe(true)
  })

  it('is not drawn without it', () => {
    bar()

    expect(screen.queryByRole('group', { name: 'Jump to an end of the list' })).toBeNull()
  })
})

describe('the count note keeps a fixed slot (H-019, revision 2026-10-27)', () => {
  it('is as wide, in characters, as the longest form it takes, and right-aligned by its stylesheet', () => {
    bar({ note: '8 items', noteRoom: '598 of 598 shown' })

    expect(screen.getByText('8 items').style.minWidth).toBe('16ch')
  })

  it('does not change when the note does', () => {
    const props = bar({ note: '8 items', noteRoom: '598 of 598 shown' })
    cleanup()
    bar({ ...props, note: '3 of 8 shown', noteRoom: '598 of 598 shown' })

    expect(screen.getByText('3 of 8 shown').style.minWidth).toBe('16ch')
  })
})

describe('Recording as Live or Studio (H-023)', () => {
  const recording: FacetGroup = {
    key: 'extra',
    label: 'Recording',
    options: [
      { key: 'live', label: 'Live' },
      { key: '__rest', label: 'Studio', rest: true },
    ],
    keepOrder: false,
    flag: true,
    covers: true,
  }

  it('is a dropdown whose popover has Live, with the chip’s dot, and Studio, without one', () => {
    bar({ facets: [recording] })

    const pop = openFacet('Recording')
    expect(pop.getByRole('button', { name: 'Live' }).querySelector('.q-facet-mark')).not.toBeNull()
    expect(pop.getByRole('button', { name: 'Studio' }).querySelector('.q-facet-mark')).toBeNull()
  })

  it('keeps Live before Studio, though the other facets go A to Z', () => {
    bar({ facets: [recording] })

    const names = openFacet('Recording').getAllByRole('button').map((button) => button.textContent)
    expect(names).toEqual(['All', 'Live', 'Studio'])
  })

  it('goes back to All when both are picked', () => {
    const props = bar({ facets: [recording], selection: { extra: new Set(['live']) } })

    fireEvent.click(openFacet('Recording').getByRole('button', { name: 'Studio' }))

    expect(props.onSelect).toHaveBeenCalledWith('extra', new Set())
  })

  it('still filters when a flag has no Studio to go with it: its one option on is not All', () => {
    const props = bar({ facets: [{ ...recording, covers: false, options: [recording.options[0]!] }] })

    fireEvent.click(openFacet('Recording').getByRole('button', { name: 'Live' }))

    expect(props.onSelect).toHaveBeenCalledWith('extra', new Set(['live']))
  })
})

/** BL-152 / SR-119: an option's label is text from a list file; one named like an inherited object member is shown as written. */
describe('FilterBar with hostile tags', () => {
  it.each(['__proto__', 'constructor', 'toString'])('shows an option labelled %s as it is, and the dropdown still opens', (label) => {
    const language: FacetGroup = { key: 'language', label: 'Language', options: [{ key: 'en', label: 'EN' }, { key: label.toLowerCase(), label }], keepOrder: false }
    bar({ facets: [language] })

    const popover = openFacet('Language')

    expect(popover.getByRole('button', { name: label })).toBeTruthy()
  })
})

