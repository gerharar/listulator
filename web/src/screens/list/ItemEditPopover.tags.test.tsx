// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useLayoutEffect, useReducer, useRef } from 'react'
import type { ListItem } from '../../lib/api.js'
import { OverlayManagerProvider, useEscLadder } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ItemEditPopover } from './ItemEditPopover.js'
import { tagField } from './tagFields.js'

afterEach(cleanup)

const GAME: ListItem = {
  id: 'i1',
  listId: 'L',
  title: 'Assassin’s Creed',
  orderIndex: 0,
  timeToConsumeMinutes: 900,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'import',
  year: 2007,
  group: null,
  tags: ['PS3', 'WIN'],
  notes: null,
  isNew: false,
}

const PLATFORM = tagField([{ key: 'platform', label: 'Platform' }])
const MUSIC = tagField([{ key: 'type', label: 'Type', values: ['Album', 'EP', 'Single', 'Live', 'Compilation'] }])

function EscLadder() {
  useEscLadder(() => undefined)
  return null
}

function renderEdit(overrides: Partial<Parameters<typeof ItemEditPopover>[0]> = {}) {
  const props = {
    item: GAME,
    groups: [],
    onCommit: vi.fn(),
    onDiscard: vi.fn(),
    tagField: PLATFORM,
    listTags: ['PS3', 'WIN', 'X360'],
    ...overrides,
  }

  function Harness() {
    const ref = useRef<HTMLButtonElement>(null)
    const [, force] = useReducer((n: number) => n + 1, 0)
    useLayoutEffect(() => force(), [])
    return (
      <>
        <button ref={ref}>anchor</button>
        <ItemEditPopover
          {...props}
          anchorEl={ref.current}
          // A fresh function on every render, as the list screen passes it.
          loadSource={props.loadSource && (() => props.loadSource!())}
        />
      </>
    )
  }
  render(
    <OverlayManagerProvider>
      <EscLadder />
      <Harness />
    </OverlayManagerProvider>,
  )
  return props
}

const field = () => screen.getByRole('button', { name: /^Platform:/ })
const panel = () => screen.getByRole('dialog', { name: 'Choose platforms' })
const save = () => screen.getByRole('button', { name: 'Save' })
const clickAway = () => fireEvent.click(document.querySelector('.q-catcher')!)

describe('ItemEditPopover — Platform (U5)', () => {
  it('shows the item’s platforms in the table’s order, or Not set', () => {
    renderEdit({ item: { ...GAME, tags: ['WIN', 'PS3'] } })
    expect(field().textContent).toContain('WIN · PS3')
    cleanup()
    renderEdit({ item: { ...GAME, tags: null } })
    expect(field().textContent).toContain('Not set')
  })

  it('opens the panel beside the window; a pick joins the draft, and Save writes the platforms in the table’s order', () => {
    const props = renderEdit()
    fireEvent.click(field())

    fireEvent.click(within(panel()).getByRole('button', { name: /^X360/ }))
    expect(field().textContent).toContain('WIN · PS3 · X360')
    fireEvent.click(save())

    expect(props.onCommit).toHaveBeenCalledWith({ tags: ['WIN', 'PS3', 'X360'] }, 'save')
  })

  it('does not rewrite old tag spellings when only the title changed', () => {
    const props = renderEdit({ item: { ...GAME, tags: ['pc', 'PS3'] } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'AC' } })
    fireEvent.click(save())

    expect(props.onCommit).toHaveBeenCalledWith({ title: 'AC' }, 'save')
  })

  it('clears every platform with Clear, saving none', () => {
    const props = renderEdit()
    fireEvent.click(field())
    fireEvent.click(within(panel()).getByRole('button', { name: 'Clear' }))
    fireEvent.click(save())

    expect(props.onCommit).toHaveBeenCalledWith({ tags: null }, 'save')
  })

  it('Esc closes the panel first and keeps the draft; the next Esc cancels the edit', () => {
    const props = renderEdit()
    fireEvent.click(field())
    fireEvent.click(within(panel()).getByRole('button', { name: /^X360/ }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Choose platforms' })).toBeNull()
    expect(props.onDiscard).not.toHaveBeenCalled()
    expect(field().textContent).toContain('X360')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onDiscard).toHaveBeenCalled()
  })

  it('clicking away with the panel open closes only the panel; the window stays', () => {
    const props = renderEdit()
    fireEvent.click(field())
    clickAway()

    expect(screen.queryByRole('dialog', { name: 'Choose platforms' })).toBeNull()
    expect(props.onCommit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Title')).toBeTruthy()
  })

  it('a click anywhere in the Edit window closes the panel; the Platform field toggles it', () => {
    renderEdit()
    fireEvent.click(field())
    fireEvent.pointerDown(document.querySelector('.q-pop')!)
    expect(screen.queryByRole('dialog', { name: 'Choose platforms' })).toBeNull()

    fireEvent.click(field())
    fireEvent.pointerDown(screen.getByLabelText('Title'))
    expect(screen.queryByRole('dialog', { name: 'Choose platforms' })).toBeNull()

    fireEvent.click(field())
    // The field's own press does not close it first: its click toggles it shut.
    fireEvent.pointerDown(field())
    expect(panel()).toBeTruthy()
    fireEvent.click(field())
    expect(screen.queryByRole('dialog', { name: 'Choose platforms' })).toBeNull()
  })

  it('a click inside the panel leaves it open', () => {
    renderEdit()
    fireEvent.click(field())
    fireEvent.pointerDown(within(panel()).getByPlaceholderText('Search 186 platforms'))
    expect(panel()).toBeTruthy()
  })

  it('can open with the panel already open (the row’s [+] and the platform card’s Edit)', () => {
    renderEdit({ openPanel: true })
    expect(panel()).toBeTruthy()
  })

  it('says what the source has and resets to it', async () => {
    const loadSource = vi.fn(async () => ({ sourced: true, tags: ['PS3'] }))
    const props = renderEdit({ loadSource })
    fireEvent.click(field())

    await waitFor(() => expect(within(panel()).getByText('Source says PS3.')).toBeTruthy())
    fireEvent.click(within(panel()).getByRole('button', { name: 'Reset to source' }))
    expect(within(panel()).queryByText('Source says PS3.')).toBeNull()
    fireEvent.click(save())

    expect(props.onCommit).toHaveBeenCalledWith({ tags: ['PS3'] }, 'save')
  })

  it('asks the source once per opening, however often the window re-renders while it answers', async () => {
    let answer: (found: { sourced: boolean; tags: string[] | null }) => void = () => undefined
    const spy = vi.fn(() => new Promise<{ sourced: boolean; tags: string[] | null }>((resolve) => (answer = resolve)))
    renderEdit({ loadSource: spy })
    fireEvent.click(field())
    // Re-renders before the source answers (the panel's positioning does this in a browser).
    for (const title of ['A', 'AB', 'ABC']) fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } })
    answer({ sourced: true, tags: ['PS3'] })

    await waitFor(() => expect(within(panel()).getByText('Source says PS3.')).toBeTruthy())
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('says nothing about a source for an item with none', async () => {
    const loadSource = vi.fn(async () => ({ sourced: false, tags: null }))
    renderEdit({ loadSource })
    fireEvent.click(field())

    await waitFor(() => expect(loadSource).toHaveBeenCalled())
    expect(within(panel()).queryByRole('button', { name: 'Reset to source' })).toBeNull()
  })
})

describe('ItemEditPopover — a short fixed set (U5)', () => {
  const ALBUM: ListItem = { ...GAME, title: 'Panopticon', tags: ['Album', 'Bonus'] }

  it('offers the facet’s values under its own name, and keeps the item’s other tags', () => {
    const props = renderEdit({ item: ALBUM, tagField: MUSIC })
    const type = screen.getByRole('button', { name: /^Type:/ })
    expect(type.textContent).toContain('Album')

    fireEvent.click(type)
    fireEvent.click(screen.getByRole('option', { name: 'EP' }))
    fireEvent.click(save())

    expect(props.onCommit).toHaveBeenCalledWith({ tags: ['Bonus', 'EP'] }, 'save')
  })

  it('can set none', () => {
    const props = renderEdit({ item: ALBUM, tagField: MUSIC })
    fireEvent.click(screen.getByRole('button', { name: /^Type:/ }))
    fireEvent.click(screen.getByRole('option', { name: 'None' }))
    fireEvent.click(save())

    expect(props.onCommit).toHaveBeenCalledWith({ tags: ['Bonus'] }, 'save')
  })
})

describe('ItemEditPopover — no tag field (U5)', () => {
  it('has none for a category without a fixed set', () => {
    renderEdit({ tagField: null })
    expect(screen.queryByRole('button', { name: /^Platform:/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Type:/ })).toBeNull()
  })
})
