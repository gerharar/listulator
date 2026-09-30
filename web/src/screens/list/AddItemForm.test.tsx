// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AddItemForm, parseMinutes } from './AddItemForm.js'

afterEach(cleanup)

describe('parseMinutes', () => {
  it('reads whole minutes, and nothing as "use the default"', () => {
    expect(parseMinutes('45')).toBe(45)
    expect(parseMinutes(' 45 ')).toBe(45)
    expect(parseMinutes('')).toBeNull()
    expect(parseMinutes('   ')).toBeNull()
    expect(parseMinutes('0')).toBe(0)
  })

  it('says invalid for anything else', () => {
    expect(parseMinutes('4.5')).toBeNaN()
    expect(parseMinutes('-3')).toBeNaN()
    expect(parseMinutes('1h')).toBeNaN()
  })
})

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

describe('AddItemForm', () => {
  it('cannot add without a title', () => {
    renderForm()
    expect(addButton().disabled).toBe(true)

    fireEvent.change(title(), { target: { value: 'New thing' } })
    expect(addButton().disabled).toBe(false)

    fireEvent.change(title(), { target: { value: '   ' } })
    expect(addButton().disabled).toBe(true)
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

  it('will not add with minutes that are not a whole number', () => {
    renderForm()
    fireEvent.change(title(), { target: { value: 'X' } })

    fireEvent.change(minutes(), { target: { value: '4.5' } })

    expect(addButton().disabled).toBe(true)
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

    it('does nothing with a blank title and a blank group', () => {
      renderForm({ onCreateGroup: vi.fn(async () => {}) })

      expect(addButton().disabled).toBe(true)
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

    it('still cannot add a group where the screen gives no way to (no onCreateGroup)', () => {
      renderForm()

      fireEvent.change(group(), { target: { value: 'Extras' } })

      expect(addButton().disabled).toBe(true)
    })
  })
})

