// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect, useReducer, useRef } from 'react'
import { OverlayManagerProvider, useEscLadder } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { copy } from '../../locale/index.js'
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
  it('stops typing at 255 characters in the title: the limit on names', () => {
    renderPopover()

    expect(title().maxLength).toBe(255)
  })

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

  it('Save is never disabled by what the fields hold (H-006): not for nothing changed, not for a blank title', () => {
    renderPopover()
    expect(save().disabled).toBe(false)

    fireEvent.change(title(), { target: { value: '  ' } })

    expect(save().disabled).toBe(false)
  })

  it('Save with nothing changed closes the window with no message', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.click(save())

    expect(onCommit).not.toHaveBeenCalled()
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  describe('a blank title (H-006)', () => {
    const sentence = copy.quantum.list.editPopover.titleRequired
    const alerts = () => screen.queryAllByRole('alert').map((alert) => alert.textContent)

    it.each([['Save', () => fireEvent.click(save())], ['Enter', () => fireEvent.keyDown(title(), { key: 'Enter' })], ['a click away', clickAway]])(
      '%s saves nothing, keeps the window open, says a list needs a title and puts the cursor in Title',
      (_name, press) => {
        const { onCommit, onDiscard } = renderPopover()
        fireEvent.change(title(), { target: { value: '   ' } })

        press()

        expect(onCommit).not.toHaveBeenCalled()
        expect(onDiscard).not.toHaveBeenCalled()
        expect(alerts()).toEqual([sentence])
        expect(title().getAttribute('aria-invalid')).toBe('true')
        expect(document.activeElement).toBe(title())
      },
    )

    it('says nothing while the title is being emptied, nor when it is left empty: only when something is pressed', () => {
      renderPopover()

      fireEvent.change(title(), { target: { value: '' } })
      fireEvent.blur(title())

      expect(alerts()).toEqual([])
    })

    it('takes the sentence away once there is a title, and Save then saves', () => {
      const { onCommit } = renderPopover()
      fireEvent.change(title(), { target: { value: '' } })
      fireEvent.click(save())
      expect(alerts()).toEqual([sentence])

      fireEvent.change(title(), { target: { value: 'Loki S2' } })
      expect(alerts()).toEqual([])
      fireEvent.click(save())

      expect(onCommit).toHaveBeenCalledWith({ title: 'Loki S2' }, 'save')
    })

    it('Don’t Save and Esc still close it', () => {
      const { onDiscard } = renderPopover()
      fireEvent.change(title(), { target: { value: '' } })

      fireEvent.keyDown(title(), { key: 'Escape' })

      expect(onDiscard).toHaveBeenCalledTimes(1)
    })
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

  it('Enter with nothing changed closes the window, like Save', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.keyDown(title(), { key: 'Enter' })

    expect(onCommit).not.toHaveBeenCalled()
    expect(onDiscard).toHaveBeenCalledTimes(1)
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
