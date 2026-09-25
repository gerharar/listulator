// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect, useReducer, useRef } from 'react'
import type { ListItem } from '../../lib/api.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ItemEditPopover } from './ItemEditPopover.js'

afterEach(cleanup)

const ITEM: ListItem = {
  id: 'i1',
  listId: 'L',
  title: 'Glorious Purpose',
  orderIndex: 0,
  timeToConsumeMinutes: 51,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'import',
  year: 2021,
  group: 'Season 1',
  tags: null,
  notes: null,
}

function renderPopover(overrides: Partial<Parameters<typeof ItemEditPopover>[0]> = {}) {
  const props = {
    item: ITEM,
    groups: ['Season 1', 'Season 2'],
    onCommit: vi.fn(),
    onDiscard: vi.fn(),
    ...overrides,
  }

  function Harness() {
    const ref = useRef<HTMLButtonElement>(null)
    const [, force] = useReducer((n: number) => n + 1, 0)
    useLayoutEffect(() => force(), [])

    return (
      <>
        <button ref={ref}>anchor</button>
        <ItemEditPopover {...props} anchorEl={ref.current} />
      </>
    )
  }
  render(
    <OverlayManagerProvider>
      <Harness />
    </OverlayManagerProvider>,
  )

  return props
}

const title = () => screen.getByLabelText('Title') as HTMLInputElement
const minutes = () => screen.getByLabelText('Minutes') as HTMLInputElement
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
const clickAway = () => fireEvent.click(document.querySelector('.q-catcher')!)

describe('ItemEditPopover', () => {
  it('opens on the item’s own title, minutes and group', () => {
    renderPopover()

    expect(title().value).toBe('Glorious Purpose')
    expect(minutes().value).toBe('51')
    expect((screen.getByLabelText('Group') as HTMLInputElement).value).toBe('Season 1')
  })

  it('has no field for notes: they are read-only', () => {
    renderPopover()

    expect(screen.queryByLabelText(/notes/i)).toBeNull()
  })

  it('Save is only there to press once something has changed and can be saved', () => {
    renderPopover()
    expect(save().disabled).toBe(true)

    fireEvent.change(title(), { target: { value: 'Renamed' } })
    expect(save().disabled).toBe(false)

    fireEvent.change(minutes(), { target: { value: 'abc' } })
    expect(save().disabled).toBe(true)
  })

  it('Save commits only what changed, as an explicit save', () => {
    const { onCommit } = renderPopover()

    fireEvent.change(title(), { target: { value: 'Renamed' } })
    fireEvent.click(save())

    expect(onCommit).toHaveBeenCalledWith({ title: 'Renamed' }, 'save')
  })

  it('Discard throws the edits away', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.change(title(), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('clicking away commits the edits — the safety net', () => {
    const { onCommit } = renderPopover()

    fireEvent.change(title(), { target: { value: 'Renamed' } })
    clickAway()

    expect(onCommit).toHaveBeenCalledWith({ title: 'Renamed' }, 'clickaway')
  })

  it('clicking away with nothing changed just closes', () => {
    const { onCommit, onDiscard } = renderPopover()

    clickAway()

    expect(onCommit).not.toHaveBeenCalled()
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('clicking away with edits that cannot be saved discards them', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.change(title(), { target: { value: '   ' } })
    clickAway()

    expect(onCommit).not.toHaveBeenCalled()
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('can move the item to a group that does not exist yet by typing it', () => {
    const { onCommit } = renderPopover()

    fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'Season 3' } })
    fireEvent.click(save())

    expect(onCommit).toHaveBeenCalledWith({ group: 'Season 3' }, 'save')
  })
})
