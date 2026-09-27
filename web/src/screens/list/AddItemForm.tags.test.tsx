// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { OverlayManagerProvider, useEscLadder } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { AddItemForm } from './AddItemForm.js'
import { tagField } from './tagFields.js'

afterEach(cleanup)

const PLATFORM = tagField([{ key: 'platform', label: 'Platform' }])
const MEGA = tagField([
  { key: 'type', label: 'Medium', values: [{ tag: 'movie', label: 'Movie' }, { tag: 'game', label: 'Game' }] },
])

function EscLadder() {
  useEscLadder(() => undefined)
  return null
}

function renderForm(overrides: Partial<Parameters<typeof AddItemForm>[0]> = {}) {
  const props = {
    groups: [],
    defaultMinutes: 600,
    onAdd: vi.fn(async () => {}),
    tagField: PLATFORM,
    listTags: ['PS3'],
    ...overrides,
  }
  render(
    <OverlayManagerProvider>
      <EscLadder />
      <AddItemForm {...props} />
    </OverlayManagerProvider>,
  )
  return props
}

const title = () => screen.getByLabelText('Title') as HTMLInputElement
const addButton = () => screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement
const platformButton = () => screen.getByRole('button', { name: /^Platform for the next item:/ })
const panel = () => screen.getByRole('dialog', { name: 'Choose platforms' })

describe('AddItemForm — the next item’s platforms (U5)', () => {
  it('starts on the list’s remembered platforms, or None', () => {
    renderForm()
    expect(platformButton().textContent).toContain('None')
    cleanup()
    renderForm({ defaultTags: ['PS4', 'WIN'] })
    expect(platformButton().textContent).toContain('WIN · PS4')
  })

  it('picks in the Platform panel, headed for the next item, and adds with them', async () => {
    const { onAdd } = renderForm()
    fireEvent.click(platformButton())
    expect(within(panel()).getByText('Next item you add')).toBeTruthy()
    fireEvent.click(within(panel()).getByRole('button', { name: /^PS3/ }))
    expect(platformButton().textContent).toContain('PS3')

    fireEvent.change(title(), { target: { value: 'Unity' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ title: 'Unity', minutes: null, group: '', tags: ['PS3'] }))
  })

  it('keeps the platforms for the next item after adding, as it keeps the group', async () => {
    const { onAdd } = renderForm({ defaultTags: ['PS4'] })
    fireEvent.change(title(), { target: { value: 'One' } })
    fireEvent.click(addButton())
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))

    fireEvent.change(title(), { target: { value: 'Two' } })
    fireEvent.click(addButton())
    await waitFor(() => expect(onAdd).toHaveBeenLastCalledWith({ title: 'Two', minutes: null, group: '', tags: ['PS4'] }))
  })

  it('closes the panel on Add, on a click away and on Esc', async () => {
    renderForm()
    fireEvent.click(platformButton())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Choose platforms' })).toBeNull()

    fireEvent.click(platformButton())
    fireEvent.click(document.querySelector('.q-catcher')!)
    expect(screen.queryByRole('dialog', { name: 'Choose platforms' })).toBeNull()

    fireEvent.click(platformButton())
    fireEvent.change(title(), { target: { value: 'Three' } })
    fireEvent.submit(title().closest('form')!)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose platforms' })).toBeNull())
  })
})

describe('AddItemForm — a short fixed set (U5)', () => {
  it('picks the next item’s Medium from the list, and adds with it', async () => {
    const { onAdd } = renderForm({ tagField: MEGA })
    fireEvent.click(screen.getByRole('button', { name: /^Medium:/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Game' }))

    fireEvent.change(title(), { target: { value: 'Halo' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ title: 'Halo', minutes: null, group: '', tags: ['game'] }))
  })
})

describe('AddItemForm — the Type/Medium list closes without focus (WebKit never focuses a clicked button)', () => {
  it('closes on a press anywhere past it, and not on a press inside it', () => {
    renderForm({ tagField: MEGA })
    fireEvent.click(screen.getByRole('button', { name: /^Medium:/ }))
    fireEvent.pointerDown(screen.getByRole('listbox'))
    expect(screen.queryByRole('listbox')).toBeTruthy()

    fireEvent.pointerDown(document.body)
    fireEvent.pointerUp(document.body)
    fireEvent.click(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('a click past it only closes it, like every other picker: the button under it does not act (owner)', async () => {
    const { onAdd } = renderForm({ tagField: MEGA })
    fireEvent.change(title(), { target: { value: 'Halo' } })
    fireEvent.click(screen.getByRole('button', { name: /^Medium:/ }))

    fireEvent.pointerDown(addButton())
    fireEvent.pointerUp(addButton())
    fireEvent.click(addButton())
    expect(screen.queryByRole('listbox')).toBeNull()
    await act(async () => {})
    expect(onAdd).not.toHaveBeenCalled()

    // The next click acts as usual.
    fireEvent.pointerDown(addButton())
    fireEvent.pointerUp(addButton())
    fireEvent.click(addButton())
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
  })

  it('a press past it that never becomes a click (a drag) leaves the next click alone', async () => {
    const { onAdd } = renderForm({ tagField: MEGA })
    fireEvent.change(title(), { target: { value: 'Halo' } })
    fireEvent.click(screen.getByRole('button', { name: /^Medium:/ }))

    fireEvent.pointerDown(document.body)
    fireEvent.pointerUp(document.body)
    await act(() => new Promise((done) => setTimeout(done, 0)))
    // A key's click: no press before it.
    fireEvent.click(addButton())

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
  })

  it('closes on Esc wherever focus is, and the Esc goes no further', () => {
    renderForm({ tagField: MEGA })
    fireEvent.click(screen.getByRole('button', { name: /^Medium:/ }))
    // fireEvent answers false when the event was cancelled.
    const notCancelled = fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(notCancelled).toBe(false)
  })
})

describe('AddItemForm — no tag field (U5)', () => {
  it('shows no picker and adds without tags', async () => {
    const { onAdd } = renderForm({ tagField: null })
    expect(screen.queryByRole('button', { name: /^Platform for the next item:/ })).toBeNull()

    fireEvent.change(title(), { target: { value: 'Pilot' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ title: 'Pilot', minutes: null, group: '' }))
  })
})
