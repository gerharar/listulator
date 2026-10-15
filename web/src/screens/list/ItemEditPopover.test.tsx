// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect, useReducer, useRef } from 'react'
import type { ListItem } from '../../lib/api.js'
import { OverlayManagerProvider, useEscLadder } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ItemEditPopover } from './ItemEditPopover.js'
import { copy } from '../../locale/index.js'

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
  yearUnk: 0,
  isNew: false,
}

function EscLadder() {
  useEscLadder(() => undefined)
  return null
}

function renderPopover(overrides: Partial<Parameters<typeof ItemEditPopover>[0]> = {}) {
  const props = {
    item: ITEM,
    groups: ['Season 1', 'Season 2'],
    defaultMinutes: 120,
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
      <EscLadder />
      <Harness />
    </OverlayManagerProvider>,
  )

  return props
}

const title = () => screen.getByLabelText('Title') as HTMLInputElement
const year = () => screen.getByLabelText('Year') as HTMLInputElement
const minutes = () => screen.getByLabelText('Duration (Minutes)') as HTMLInputElement
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
const clickAway = () => fireEvent.click(document.querySelector('.q-catcher')!)

describe('ItemEditPopover', () => {
  it('stops typing at 255 characters in the title and the group: the limit on names', () => {
    renderPopover()

    expect(title().maxLength).toBe(255)
    expect((screen.getByLabelText('Group') as HTMLInputElement).maxLength).toBe(255)
  })

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

  it('Save is never disabled by what the fields hold (H-006): not for nothing changed, not for a wrong field', () => {
    renderPopover()
    expect(save().disabled).toBe(false)

    fireEvent.change(title(), { target: { value: 'Renamed' } })
    fireEvent.change(minutes(), { target: { value: 'abc' } })
    fireEvent.change(year(), { target: { value: '19' } })
    expect(save().disabled).toBe(false)
  })

  it('keeps the cursor in the field when a button is pressed, so a sentence that appears on leaving it cannot move the button out from under the click', () => {
    renderPopover()

    // A mouse-down nobody cancelled would take the focus, which shows the sentence, which moves Save down.
    expect(fireEvent.mouseDown(save())).toBe(false)
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Don\'t Save' }))).toBe(false)
  })

  it('Save with nothing changed closes the window with no message', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.click(save())

    expect(onCommit).not.toHaveBeenCalled()
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: 'Don\'t Save' }))

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('clicking away commits the edits — the safety net', () => {
    const { onCommit } = renderPopover()

    fireEvent.change(title(), { target: { value: 'Renamed' } })
    clickAway()

    expect(onCommit).toHaveBeenCalledWith({ title: 'Renamed' }, 'clickaway')
  })

  it('Enter in a field saves', () => {
    const { onCommit } = renderPopover()

    fireEvent.change(title(), { target: { value: 'Renamed' } })
    fireEvent.keyDown(title(), { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledWith({ title: 'Renamed' }, 'save')
  })

  it('Enter with nothing changed closes the window, like Save', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.keyDown(title(), { key: 'Enter' })

    expect(onCommit).not.toHaveBeenCalled()
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('Esc cancels: the edits are thrown away, not saved (Enter saves, Esc cancels)', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.change(title(), { target: { value: 'Renamed' } })
    fireEvent.keyDown(title(), { key: 'Escape' })

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('clicking away with nothing changed just closes', () => {
    const { onCommit, onDiscard } = renderPopover()

    clickAway()

    expect(onCommit).not.toHaveBeenCalled()
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('clicking away with edits that cannot be saved keeps the window open and says what is wrong (H-006)', () => {
    const { onCommit, onDiscard } = renderPopover()

    fireEvent.change(title(), { target: { value: '   ' } })
    clickAway()

    expect(onCommit).not.toHaveBeenCalled()
    expect(onDiscard).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(copy.quantum.list.itemActions.titleRequired)
  })

  it('can move the item to a group that does not exist yet by typing it', () => {
    const { onCommit } = renderPopover()

    fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'Season 3' } })
    const press = () => {
      fireEvent.pointerDown(save())
      fireEvent.pointerUp(save())
      fireEvent.click(save())
    }
    // The list is open while typing: the first press on Save only closes it (owner: as every picker).
    press()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onCommit).not.toHaveBeenCalled()

    press()
    expect(onCommit).toHaveBeenCalledWith({ group: 'Season 3' }, 'save')
  })
})

describe('ItemEditPopover: the year (H-004, H-005)', () => {
  const hint = () => screen.queryByRole('alert')
  const text = copy.quantum.list.itemActions

  it('has a Year field before the duration, holding the item’s year as the field writes it', () => {
    renderPopover()

    expect(year().value).toBe('2021')
    expect(year().placeholder).toBe('1994, 199?')
    expect(year().maxLength).toBe(4)
    // Beside the duration, on the same line: Year first.
    expect(year().compareDocumentPosition(minutes()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(year().closest('.q-edit-pair')).toBe(minutes().closest('.q-edit-pair'))
  })

  it('shows a partial year with its ?, and an empty field for an item with none', () => {
    renderPopover({ item: { ...ITEM, year: 1990, yearUnk: 1 } })
    expect(year().value).toBe('199?')
    cleanup()

    renderPopover({ item: { ...ITEM, year: null } })
    expect(year().value).toBe('')
  })

  it('shows a year stored below 1000 as it is (the range is 1000 to 2100 since 2026-10-15)', () => {
    renderPopover({ item: { ...ITEM, year: 800 } })

    expect(year().value).toBe('800')
  })

  it('keeps only digits and then ?, four at most, as they are typed', () => {
    renderPopover()

    fireEvent.change(year(), { target: { value: '1?9x' } })
    expect(year().value).toBe('1?')
    fireEvent.change(year(), { target: { value: '19999' } })
    expect(year().value).toBe('1999')
  })

  it('saves a changed year with the digits it does not know', () => {
    const { onCommit } = renderPopover()

    fireEvent.change(year(), { target: { value: '199?' } })
    fireEvent.click(save())

    expect(onCommit).toHaveBeenCalledWith({ year: 1990, yearUnk: 1 }, 'save')
  })

  it('clears the year when the field is emptied', () => {
    const { onCommit } = renderPopover()

    fireEvent.change(year(), { target: { value: '' } })
    fireEvent.click(save())

    expect(onCommit).toHaveBeenCalledWith({ year: null, yearUnk: 0 }, 'save')
  })

  it('says nothing while the year is a year', () => {
    renderPopover()

    expect(hint()).toBeNull()
    expect(year().getAttribute('aria-invalid')).not.toBe('true')
  })

  it('does not say anything about a wrong year while it is being typed, before it is left', () => {
    renderPopover()

    fireEvent.change(year(), { target: { value: '19' } })

    expect(hint()).toBeNull()
  })

  it.each([
    ['1', () => text.yearForm],
    ['199', () => text.yearForm],
    ['1?', () => text.yearForm],
    ['19?4', () => text.yearForm],
    ['0999', () => text.yearTooEarly],
    ['0000', () => text.yearTooEarly],
    ['3500', () => text.yearTooLate('3500')],
    ['31??', () => text.yearTooLate('31??')],
    ['2101', () => text.yearTooLate('2101')],
  ])('says so when the year %j is left: its own sentence under the pair', (value, sentence) => {
    renderPopover()

    fireEvent.change(year(), { target: { value } })
    fireEvent.blur(year())

    expect(hint()?.textContent).toBe(sentence())
    expect(year().getAttribute('aria-invalid')).toBe('true')
    expect(year().getAttribute('aria-describedby')).toBe(hint()!.id)
  })

  it('does not say anything on leaving an empty year: empty is no year', () => {
    renderPopover({ item: { ...ITEM, year: null } })

    fireEvent.blur(year())

    expect(hint()).toBeNull()
  })

  it('follows the year once shown: it goes when the year is right and returns when it is not', () => {
    renderPopover()
    fireEvent.change(year(), { target: { value: '19' } })
    fireEvent.blur(year())
    expect(hint()).not.toBeNull()

    fireEvent.change(year(), { target: { value: '1999' } })
    expect(hint()).toBeNull()

    fireEvent.change(year(), { target: { value: '3500' } })
    expect(hint()?.textContent).toBe(text.yearTooLate('3500'))
  })

  it('Save with a wrong year saves nothing, keeps the window open and puts the cursor on Year with its text selected', () => {
    const { onCommit, onDiscard } = renderPopover()
    fireEvent.change(title(), { target: { value: 'Renamed' } })
    fireEvent.change(year(), { target: { value: '19' } })

    fireEvent.click(save())

    expect(onCommit).not.toHaveBeenCalled()
    expect(onDiscard).not.toHaveBeenCalled()
    expect(hint()?.textContent).toBe(text.yearForm)
    expect(document.activeElement).toBe(year())
    expect([year().selectionStart, year().selectionEnd]).toEqual([0, 2])
  })

  it('Enter and a click away do the same with a wrong year; Don’t Save and Esc still close', () => {
    const { onCommit, onDiscard } = renderPopover()
    fireEvent.change(year(), { target: { value: '19' } })

    fireEvent.keyDown(title(), { key: 'Enter' })
    clickAway()
    expect(onCommit).not.toHaveBeenCalled()
    expect(onDiscard).not.toHaveBeenCalled()

    fireEvent.keyDown(title(), { key: 'Escape' })
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('does not check a year it was opened with, so an old one outside the range never stops another edit', () => {
    const { onCommit } = renderPopover({ item: { ...ITEM, year: 800 } })

    fireEvent.change(title(), { target: { value: 'Renamed' } })
    fireEvent.click(save())

    expect(onCommit).toHaveBeenCalledWith({ title: 'Renamed' }, 'save')
  })
})

describe('ItemEditPopover: the title and the duration (H-006, H-007)', () => {
  const alerts = () => screen.queryAllByRole('alert').map((alert) => alert.textContent)
  const text = copy.quantum.list.itemActions

  it('says an item needs a title when Save is pressed on an empty one, with the cursor there', () => {
    const { onCommit } = renderPopover()
    fireEvent.change(title(), { target: { value: '' } })

    fireEvent.click(save())

    expect(onCommit).not.toHaveBeenCalled()
    expect(alerts()).toEqual([text.titleRequired])
    expect(title().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(title())
  })

  describe('an item whose length is an estimate (owner, 2026-10-15: empty = the category default)', () => {
    const estimated = { ...ITEM, timeToConsumeMinutes: 90, timeToConsumeIsEstimated: true }

    it('opens with an empty Duration and the category default as its placeholder, not with the estimate’s number', () => {
      renderPopover({ item: estimated })

      expect(minutes().value).toBe('')
      expect(minutes().placeholder).toBe(text.minutesPlaceholder(120))
    })

    it('Save with it still empty changes nothing: the window just closes', () => {
      const { onCommit, onDiscard } = renderPopover({ item: estimated })

      fireEvent.click(save())

      expect(onCommit).not.toHaveBeenCalled()
      expect(onDiscard).toHaveBeenCalledTimes(1)
    })

    it('typing a length over it makes it a typed length, even the estimate’s own number', () => {
      const { onCommit } = renderPopover({ item: estimated })

      fireEvent.change(minutes(), { target: { value: '1h 30m' } })
      fireEvent.click(save())

      expect(onCommit).toHaveBeenCalledWith({ timeToConsumeIsEstimated: false }, 'save')
    })

    it('says so when what is typed over it is wrong', () => {
      renderPopover({ item: estimated })

      fireEvent.change(minutes(), { target: { value: 'abc' } })
      fireEvent.blur(minutes())

      expect(alerts()).toEqual([text.minutesForm])
    })
  })

  it('is a text input, so h, m and : can be typed, with the category default as its placeholder', () => {
    renderPopover()

    expect(minutes().getAttribute('inputmode')).toBeNull()
    expect(minutes().placeholder).toBe(text.minutesPlaceholder(120))
  })

  it.each([
    ['1h 30m', { timeToConsumeMinutes: 90, timeToConsumeIsEstimated: false }],
    ['1:30', { timeToConsumeMinutes: 90, timeToConsumeIsEstimated: false }],
    ['', { timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true }],
  ])('saves a duration typed as %j', (value, patch) => {
    const { onCommit } = renderPopover()

    fireEvent.change(minutes(), { target: { value } })
    fireEvent.click(save())

    expect(onCommit).toHaveBeenCalledWith(patch, 'save')
  })

  it.each([
    ['abc', () => text.minutesForm],
    ['1.5h', () => text.minutesForm],
    ['1:61', () => text.minutesForm],
    ['0', () => text.minutesZero(120)],
    ['100000', () => text.minutesRange],
  ])('says so when the duration %j is left', (value, sentence) => {
    renderPopover()

    fireEvent.change(minutes(), { target: { value } })
    fireEvent.blur(minutes())

    expect(alerts()).toEqual([sentence()])
    expect(minutes().getAttribute('aria-invalid')).toBe('true')
  })

  it('marks every wrong field on Save, the title above the year above the duration, and puts the cursor on the first', () => {
    const { onCommit } = renderPopover()
    fireEvent.change(title(), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '3500' } })
    fireEvent.change(minutes(), { target: { value: 'abc' } })

    fireEvent.click(save())

    expect(onCommit).not.toHaveBeenCalled()
    expect(alerts()).toEqual([text.titleRequired, text.yearTooLate('3500'), text.minutesForm])
    expect(document.activeElement).toBe(title())
  })

  it('does not check a duration it was opened with, so an old length never stops another edit', () => {
    const { onCommit } = renderPopover({ item: { ...ITEM, timeToConsumeMinutes: 0 } })

    fireEvent.change(title(), { target: { value: 'Renamed' } })
    fireEvent.click(save())

    expect(onCommit).toHaveBeenCalledWith({ title: 'Renamed' }, 'save')
  })
})
