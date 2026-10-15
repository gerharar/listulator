// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AddItemForm } from './AddItemForm.js'
import { copy } from '../../locale/index.js'

afterEach(cleanup)

function renderForm(overrides: Partial<Parameters<typeof AddItemForm>[0]> = {}) {
  const props = {
    groups: ['Season 1', 'Season 2'],
    defaultMinutes: 30,
    onAdd: vi.fn(async () => {}),
    ...overrides,
  }
  render(<AddItemForm {...props} />)
  return props
}

const title = () => screen.getByLabelText('Title') as HTMLInputElement
const minutes = () => screen.getByLabelText('Minutes') as HTMLInputElement
const group = () => screen.getByLabelText('Group') as HTMLInputElement
const addButton = () => screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement
const alerts = () => screen.queryAllByRole('alert').map((alert) => alert.textContent)
const sentences = copy.quantum.list.itemActions

describe('AddItemForm', () => {
  it('is never disabled by what the fields hold (H-006): not empty, not wrong', () => {
    renderForm()
    expect(addButton().disabled).toBe(false)

    fireEvent.change(title(), { target: { value: '   ' } })
    fireEvent.change(minutes(), { target: { value: 'abc' } })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '19' } })

    expect(addButton().disabled).toBe(false)
  })

  it('pressing Add with nothing typed adds nothing, says to type a title and puts the cursor in Title (no group name can be added here)', () => {
    const { onAdd } = renderForm()

    fireEvent.click(addButton())

    expect(onAdd).not.toHaveBeenCalled()
    expect(alerts()).toEqual([sentences.titleRequired])
    expect(title().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(title())
  })

  it('treats a title of spaces as no title', () => {
    const { onAdd } = renderForm()

    fireEvent.change(title(), { target: { value: '   ' } })
    fireEvent.click(addButton())

    expect(onAdd).not.toHaveBeenCalled()
    expect(alerts()).toEqual([sentences.titleRequired])
  })

  it('adds with the title, minutes and group as typed', async () => {
    const { onAdd } = renderForm()

    fireEvent.change(title(), { target: { value: '  Bonus  ' } })
    fireEvent.change(minutes(), { target: { value: '12' } })
    fireEvent.change(group(), { target: { value: 'Season 2' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ title: 'Bonus', minutes: 12, group: 'Season 2' }))
  })

  it('leaves the minutes for the category default when blank, and says what that is', async () => {
    const { onAdd } = renderForm({ defaultMinutes: 40 })

    expect(minutes().placeholder).toBe('40')
    fireEvent.change(title(), { target: { value: 'X' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ title: 'X', minutes: null, group: '' }))
  })

  it('adds into a group that does not exist yet by typing its name', async () => {
    const { onAdd } = renderForm()

    fireEvent.change(title(), { target: { value: 'X' } })
    fireEvent.change(group(), { target: { value: 'Season 3' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ title: 'X', minutes: null, group: 'Season 3' }))
  })

  it('trims the group name it is given', async () => {
    const { onAdd } = renderForm()

    fireEvent.change(title(), { target: { value: 'X' } })
    fireEvent.change(group(), { target: { value: '  Season 3  ' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ title: 'X', minutes: null, group: 'Season 3' }))
  })

  describe('the minutes (H-006, H-007)', () => {
    it('is a text field, so h, m and : can be typed, and its placeholder is the category default, as before', () => {
      renderForm({ defaultMinutes: 40 })

      expect(minutes().getAttribute('inputmode')).toBeNull()
      expect(minutes().placeholder).toBe('40')
    })

    it.each([
      ['1h 35m', 95],
      ['1:35', 95],
      ['45 min', 45],
      ['12', 12],
    ])('adds %j as %d minutes', async (value, expected) => {
      const { onAdd } = renderForm()

      fireEvent.change(title(), { target: { value: 'X' } })
      fireEvent.change(minutes(), { target: { value } })
      fireEvent.click(addButton())

      await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ title: 'X', minutes: expected, group: '' }))
    })

    it.each([
      ['4.5', () => sentences.minutesForm],
      ['abc', () => sentences.minutesForm],
      ['1:61', () => sentences.minutesForm],
      ['0', () => sentences.minutesZero(30)],
      ['100000', () => sentences.minutesRange],
    ])('adds nothing for %j, says why and puts the cursor in Minutes', (value, sentence) => {
      const { onAdd } = renderForm()
      fireEvent.change(title(), { target: { value: 'X' } })

      fireEvent.change(minutes(), { target: { value } })
      fireEvent.click(addButton())

      expect(onAdd).not.toHaveBeenCalled()
      expect(alerts()).toEqual([sentence()])
      expect(minutes().getAttribute('aria-invalid')).toBe('true')
      expect(document.activeElement).toBe(minutes())
    })

    it('says so when a wrong length is left, before anything is pressed', () => {
      renderForm()

      fireEvent.change(minutes(), { target: { value: 'abc' } })
      fireEvent.blur(minutes())

      expect(alerts()).toEqual([sentences.minutesForm])
    })
  })

  it('stacks the sentences of several wrong fields under the row, the title first, and puts the cursor on the first', () => {
    const { onAdd } = renderForm()
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '3500' } })
    fireEvent.change(minutes(), { target: { value: 'abc' } })

    fireEvent.click(addButton())

    expect(onAdd).not.toHaveBeenCalled()
    expect(alerts()).toEqual([sentences.titleRequired, sentences.yearTooLate('3500'), sentences.minutesForm])
    expect(document.activeElement).toBe(title())
    const row = document.querySelector('.q-add-item-row')!
    for (const alert of screen.getAllByRole('alert')) expect(row.contains(alert)).toBe(false)
  })

  it('takes the sentences away once the fields are right, and after an add leaves no sentence behind', async () => {
    const { onAdd } = renderForm()
    fireEvent.click(addButton())
    expect(alerts()).toHaveLength(1)

    fireEvent.change(title(), { target: { value: 'Now with a title' } })
    expect(alerts()).toEqual([])
    fireEvent.click(addButton())

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(title().value).toBe(''))
    expect(alerts()).toEqual([])
    expect(title().getAttribute('aria-invalid')).toBeNull()
  })

  it('adds on Enter in the title field', async () => {
    const { onAdd } = renderForm()
    fireEvent.change(title(), { target: { value: 'By keyboard' } })

    fireEvent.submit(title().closest('form')!)

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
  })

  it('clears the title and minutes after adding, and keeps the group for the next one', async () => {
    renderForm()
    fireEvent.change(title(), { target: { value: 'One' } })
    fireEvent.change(minutes(), { target: { value: '9' } })
    fireEvent.change(group(), { target: { value: 'Season 1' } })

    fireEvent.click(addButton())

    await waitFor(() => expect(title().value).toBe(''))
    expect(minutes().value).toBe('')
    expect(group().value).toBe('Season 1')
  })

  it('locks while adding', async () => {
    let finish: () => void = () => {}
    renderForm({ onAdd: () => new Promise<void>((resolve) => (finish = resolve)) })
    fireEvent.change(title(), { target: { value: 'One' } })

    fireEvent.click(addButton())

    await waitFor(() => expect(screen.getByRole('button', { name: 'Adding…' })).toBeTruthy())
    expect(title().disabled).toBe(true)
    finish()
  })

  it('keeps what was typed and says so when adding fails', async () => {
    renderForm({
      onAdd: async () => {
        throw new Error('Could not add that')
      },
    })
    fireEvent.change(title(), { target: { value: 'Keep me' } })

    fireEvent.click(addButton())

    expect(await screen.findByText('Could not add that')).toBeTruthy()
    expect(title().value).toBe('Keep me')
    expect(title().disabled).toBe(false)
  })

  it('turns spellcheck off on the title: it is a name', () => {
    renderForm()

    expect(title().getAttribute('spellcheck')).toBe('false')
  })

  it('stops typing at 255 characters in the title and the group: the limit on names', () => {
    renderForm()

    expect(title().maxLength).toBe(255)
    expect(group().maxLength).toBe(255)
  })

  describe('an empty group (11.17)', () => {
    const groupButton = () => screen.getByRole('button', { name: 'Add Group' }) as HTMLButtonElement

    it('turns Add into Add Group when a group name is typed and the title is blank, and creates that group', async () => {
      const { onAdd, onCreateGroup } = renderForm({ onCreateGroup: vi.fn(async () => {}) })

      fireEvent.change(group(), { target: { value: '  Extras  ' } })
      expect(groupButton().disabled).toBe(false)
      fireEvent.click(groupButton())

      await waitFor(() => expect(onCreateGroup).toHaveBeenCalledWith('Extras'))
      expect(onAdd).not.toHaveBeenCalled()
    })

    it('keeps the group in the field, so the first item can go straight into it', async () => {
      renderForm({ onCreateGroup: vi.fn(async () => {}) })

      fireEvent.change(group(), { target: { value: 'Extras' } })
      fireEvent.click(groupButton())

      await waitFor(() => expect(groupButton().disabled).toBe(false))
      expect(group().value).toBe('Extras')
    })

    it('adds the item as before once there is a title, whatever the group field says', async () => {
      const { onAdd, onCreateGroup } = renderForm({ onCreateGroup: vi.fn(async () => {}) })

      fireEvent.change(group(), { target: { value: 'Season 2' } })
      fireEvent.change(title(), { target: { value: 'Bonus' } })
      fireEvent.click(addButton())

      await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ title: 'Bonus', minutes: null, group: 'Season 2' }))
      expect(onCreateGroup).not.toHaveBeenCalled()
    })

    it('with a blank title and a blank group, adds nothing and says to type a title or a new group name', () => {
      const { onAdd, onCreateGroup } = renderForm({ onCreateGroup: vi.fn(async () => {}) })

      fireEvent.click(addButton())

      expect(onAdd).not.toHaveBeenCalled()
      expect(onCreateGroup).not.toHaveBeenCalled()
      expect(alerts()).toEqual([copy.quantum.list.addItem.titleOrGroupRequired])
      expect(document.activeElement).toBe(title())
    })

    it('takes that sentence away when a group name is typed instead: the group can be added', () => {
      renderForm({ onCreateGroup: vi.fn(async () => {}) })
      fireEvent.click(addButton())
      expect(alerts()).toHaveLength(1)

      fireEvent.change(group(), { target: { value: 'Extras' } })

      expect(alerts()).toEqual([])
    })

    it.each([
      ['a wrong length', () => fireEvent.change(minutes(), { target: { value: 'abc' } }), () => sentences.minutesForm],
      ['a wrong year', () => fireEvent.change(screen.getByLabelText('Year'), { target: { value: '19' } }), () => sentences.yearForm],
    ])('does not create the group while there is %s: a wrong field is wrong whatever is being added (owner)', (_name, type, sentence) => {
      const { onCreateGroup } = renderForm({ onCreateGroup: vi.fn(async () => {}) })
      fireEvent.change(group(), { target: { value: 'Extras' } })
      type()

      fireEvent.click(screen.getByRole('button', { name: 'Add Group' }))

      expect(onCreateGroup).not.toHaveBeenCalled()
      expect(alerts()).toEqual([sentence()])
    })

    it('says why, and keeps the name, when the group is refused (a name the list already has)', async () => {
      renderForm({
        onCreateGroup: vi.fn(async () => {
          throw new Error('This list already has a group with such name.')
        }),
      })

      fireEvent.change(group(), { target: { value: 'Season 1' } })
      fireEvent.click(groupButton())

      expect(await screen.findByText('This list already has a group with such name.')).toBeTruthy()
      expect(group().value).toBe('Season 1')
    })

    it('still cannot add a group where the screen gives no way to (no onCreateGroup): it asks for a title', () => {
      const { onAdd } = renderForm()

      fireEvent.change(group(), { target: { value: 'Extras' } })
      fireEvent.click(addButton())

      expect(onAdd).not.toHaveBeenCalled()
      expect(alerts()).toEqual([sentences.titleRequired])
    })
  })
})

describe('AddItemForm: the year (H-004, H-005)', () => {
  const year = () => screen.getByLabelText('Year') as HTMLInputElement
  it('has a Year field between the title and the minutes', () => {
    renderForm()

    expect(year().placeholder).toBe('Year')
    expect(year().maxLength).toBe(4)
    expect(title().compareDocumentPosition(year()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(year().compareDocumentPosition(minutes()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps only digits and then ?, four at most', () => {
    renderForm()

    fireEvent.change(year(), { target: { value: '1?9x' } })

    expect(year().value).toBe('1?')
  })

  it('adds without a year when the field is empty, as it always did', async () => {
    const { onAdd } = renderForm()

    fireEvent.change(title(), { target: { value: 'Bonus' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ title: 'Bonus', minutes: null, group: '' }))
  })

  it('adds with an exact year and with a partial one, with the digits it does not know', async () => {
    const { onAdd } = renderForm()

    fireEvent.change(title(), { target: { value: 'Single' } })
    fireEvent.change(year(), { target: { value: '1994' } })
    fireEvent.click(addButton())
    await waitFor(() => expect(onAdd).toHaveBeenLastCalledWith({ title: 'Single', minutes: null, group: '', year: { year: 1994, yearUnk: 0 } }))

    fireEvent.change(title(), { target: { value: 'Tape' } })
    fireEvent.change(year(), { target: { value: '198?' } })
    fireEvent.click(addButton())
    await waitFor(() => expect(onAdd).toHaveBeenLastCalledWith({ title: 'Tape', minutes: null, group: '', year: { year: 1980, yearUnk: 1 } }))
  })

  it('clears the year with the title after an add: each item has its own', async () => {
    renderForm()

    fireEvent.change(title(), { target: { value: 'Single' } })
    fireEvent.change(year(), { target: { value: '1994' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(title().value).toBe(''))
    expect(year().value).toBe('')
  })

  it.each([
    ['1', () => sentences.yearForm],
    ['199', () => sentences.yearForm],
    ['19?4', () => sentences.yearForm],
    ['0999', () => sentences.yearTooEarly],
    ['3500', () => sentences.yearTooLate('3500')],
    ['31??', () => sentences.yearTooLate('31??')],
  ])('adds nothing for a year of %j, says why under the row and puts the cursor in Year with its text selected', (value, sentence) => {
    const { onAdd } = renderForm()
    fireEvent.change(title(), { target: { value: 'Bonus' } })

    fireEvent.change(year(), { target: { value } })
    fireEvent.click(addButton())

    expect(onAdd).not.toHaveBeenCalled()
    expect(alerts()).toEqual([sentence()])
    expect(year().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(year())
    expect([year().selectionStart, year().selectionEnd]).toEqual([0, year().value.length])
  })

  it('says nothing about a year while it is being typed, only when it is left', () => {
    renderForm()

    fireEvent.change(year(), { target: { value: '19' } })
    expect(alerts()).toEqual([])

    fireEvent.blur(year())
    expect(alerts()).toEqual([sentences.yearForm])
  })

  it('has no tooltip on Add and no sentence while the year is right', () => {
    renderForm()
    fireEvent.change(title(), { target: { value: 'Bonus' } })
    fireEvent.change(year(), { target: { value: '1994' } })

    expect(addButton().disabled).toBe(false)
    expect(addButton().getAttribute('title')).toBeNull()
    expect(alerts()).toEqual([])
  })
})
