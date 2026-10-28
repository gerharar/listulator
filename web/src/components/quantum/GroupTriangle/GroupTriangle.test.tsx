// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import { GroupLineProvider, GroupTriangle, useGroupLineSetting } from './GroupTriangle.js'

afterEach(cleanup)

/** Canvas H-022: the group triangle as a drawn shape with a 1px line, behind the `markOpenGroups` preference. */
describe('GroupTriangle', () => {
  it('is today\'s glyph exactly while the preference is off (the default): one ▼ in `.q-chev`, no drawing, no line', () => {
    const { container } = render(<GroupTriangle />)

    const chev = container.querySelector('.q-chev')!
    expect(chev.tagName).toBe('SPAN')
    expect(chev.textContent).toBe('▼')
    expect(chev.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('.q-chev-rule')).toBeNull()
  })

  it('draws the 14 x 12 triangle and the line, and no glyph, when the preference is on', () => {
    const { container } = render(
      <GroupLineProvider on>
        <GroupTriangle />
      </GroupLineProvider>,
    )

    const root = container.querySelector('.q-chev-line')!
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.textContent).toBe('')
    expect(container.querySelector('.q-chev')).toBeNull()
    const svg = root.querySelector('svg.q-chev-tri')!
    expect(svg.getAttribute('width')).toBe('14')
    expect(svg.getAttribute('height')).toBe('12')
    expect(svg.querySelector('path')!.getAttribute('d')).toBe('M0 0H14L7 12Z')
    expect(svg.querySelector('path')!.getAttribute('fill')).toBe('currentColor')
    expect(root.querySelector('.q-chev-rule')).not.toBeNull()
  })

  it('is off for a provider that says off', () => {
    const { container } = render(
      <GroupLineProvider on={false}>
        <GroupTriangle />
      </GroupLineProvider>,
    )

    expect(container.querySelector('.q-chev')!.textContent).toBe('▼')
    expect(container.querySelector('svg')).toBeNull()
  })
})

/** H-022 as a Settings checkbox: the provider keeps the state, so a change draws every group head at once. */
describe('GroupLineProvider as a setting', () => {
  function Switch() {
    const { on, setOn } = useGroupLineSetting()

    return (
      <button type="button" onClick={() => setOn(!on)}>
        {on ? 'on' : 'off'}
      </button>
    )
  }

  function fakeStore() {
    const data = new Map<string, string>()
    const store: PreferencesStore = { get: async (key) => data.get(key), set: vi.fn(async (key: string, value: string) => void data.set(key, value)) }

    return { data, store }
  }

  it('starts from `on`, and setOn redraws the triangle at once and persists the choice under markOpenGroups', async () => {
    const { data, store } = fakeStore()
    const { container } = render(
      <GroupLineProvider on={false} store={store}>
        <Switch />
        <GroupTriangle />
      </GroupLineProvider>,
    )
    expect(container.querySelector('.q-chev')).not.toBeNull()
    expect(container.querySelector('.q-chev-line')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'off' }))

    expect(container.querySelector('.q-chev-line')).not.toBeNull()
    expect(container.querySelector('.q-chev')).toBeNull()
    await waitFor(() => expect(data.get('markOpenGroups')).toBe('true'))

    fireEvent.click(screen.getByRole('button', { name: 'on' }))

    expect(container.querySelector('.q-chev')).not.toBeNull()
    await waitFor(() => expect(data.get('markOpenGroups')).toBe('false'))
  })

  it('works without a store (a test, or a component alone): the state changes, nothing is written', () => {
    const { container } = render(
      <GroupLineProvider on>
        <Switch />
        <GroupTriangle />
      </GroupLineProvider>,
    )
    expect(container.querySelector('.q-chev-line')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'on' }))

    expect(container.querySelector('.q-chev')).not.toBeNull()
  })

  it('outside any provider: off, and a setOn that does nothing', () => {
    render(<Switch />)

    fireEvent.click(screen.getByRole('button', { name: 'off' }))

    expect(screen.getByRole('button', { name: 'off' })).toBeTruthy()
  })
})

