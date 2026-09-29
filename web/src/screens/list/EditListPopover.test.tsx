// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect, useReducer, useRef } from 'react'
import { OverlayManagerProvider, useEscLadder } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { EditListPopover } from './EditListPopover.js'
import type { ListFields } from './listActions.js'

afterEach(cleanup)

const LIST: ListFields = { title: 'Loki', description: 'The trickster', status: 'ongoing' }

function EscLadder() {
  useEscLadder(() => undefined)
  return null
}

function renderPopover(overrides: Partial<Parameters<typeof EditListPopover>[0]> = {}) {
  const props = { list: LIST, itemCount: 7, onCommit: vi.fn(), onDiscard: vi.fn(), ...overrides }

  function Harness() {
    const ref = useRef<HTMLButtonElement>(null)
    const [, force] = useReducer((n: number) => n + 1, 0)
    useLayoutEffect(() => force(), [])

    return (
      <>
        <button ref={ref}>anchor</button>
        <EditListPopover {...props} anchorEl={ref.current} />
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

const title = () => screen.getByLabelText('Title') as HTMLInputElement
const description = () => screen.getByLabelText(/Description/) as HTMLTextAreaElement
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
const clickAway = () => fireEvent.click(document.querySelector('.q-catcher')!)

describe('EditListPopover', () => {
  it('opens on the list’s own title, description and status', () => {
    renderPopover()

    expect(title().value).toBe('Loki')
    expect(description().value).toBe('The trickster')
    expect(screen.getByRole('button', { name: 'Ongoing' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows how many items the list has on its head row', () => {
    renderPopover({ itemCount: 1 })

    expect(screen.getByText('1 item')).toBeTruthy()
  })

  it('cannot be saved until something changes', () => {
    renderPopover()
    expect(save().disabled).toBe(true)

    fireEvent.change(title(), { target: { value: 'Loki S2' } })

    expect(save().disabled).toBe(false)
  })

  it('cannot be saved with a blank title', () => {
    renderPopover()

    fireEvent.change(title(), { target: { value: '  ' } })

    expect(save().disabled).toBe(true)
  })

  it('Save commits only what changed, as the explicit save', () => {
    const { onCommit } = renderPopover()

    fireEvent.change(title(), { target: { value: 'Loki S2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    fireEvent.click(save())

    expect(onCommit).toHaveBeenCalledWith({ title: 'Loki S2', status: 'complete' }, 'save')
  })

  it('clicking away commits the change as the safety net', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.change(description(), { target: { value: 'Changed' } })
    clickAway()

    expect(onCommit).toHaveBeenCalledWith({ description: 'Changed' }, 'clickaway')
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('Enter in a field saves', () => {
    const { onCommit } = renderPopover()

    fireEvent.change(title(), { target: { value: 'Loki S2' } })
    fireEvent.keyDown(title(), { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledWith({ title: 'Loki S2' }, 'save')
  })

  it('Enter with nothing to save does nothing', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.keyDown(title(), { key: 'Enter' })

    expect(onCommit).not.toHaveBeenCalled()
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('Esc cancels: the edits are thrown away, not saved (Enter saves, Esc cancels)', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.change(description(), { target: { value: 'Changed' } })
    fireEvent.keyDown(description(), { key: 'Escape' })

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('clicking away with nothing changed just closes', () => {
    const { onCommit, onDiscard } = renderPopover()

    clickAway()

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('clicking away with an unsaveable draft discards it', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.change(title(), { target: { value: '' } })
    clickAway()

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('Discard closes without committing what was typed', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.change(title(), { target: { value: 'Typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Don\'t Save' }))

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('clearing the description sends null, so it can really be emptied', () => {
    const { onCommit } = renderPopover()

    fireEvent.change(description(), { target: { value: '' } })
    fireEvent.click(save())

    expect(onCommit).toHaveBeenCalledWith({ description: null }, 'save')
  })

  it('checks spelling in the description but not in the title', () => {
    renderPopover()

    expect(title().getAttribute('spellcheck')).toBe('false')
    expect(description().getAttribute('spellcheck')).not.toBe('false')
  })
})
