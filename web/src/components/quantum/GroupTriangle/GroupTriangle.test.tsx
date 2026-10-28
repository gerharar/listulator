// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import { GroupLineProvider, GroupTriangle, groupLineThickness, useGroupLineSetting } from './GroupTriangle.js'

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

/**
 * BL-153 (the owner, Windows at 125%, 2026-10-28): the 1px line is 1.25 device pixels there, so it was snapped to 1 pixel row on some group heads and
 * 2 on others (rows 58.75 device pixels apart). Its thickness is a whole number of device pixels, as the meter cells' sizes are (1.0.1).
 */
describe('groupLineThickness', () => {
  it('is exactly 1 CSS pixel at 100%, 200% and 300%: the look that was approved is unchanged', () => {
    expect(groupLineThickness(1)).toBe(1)
    expect(groupLineThickness(2)).toBe(1)
    expect(groupLineThickness(3)).toBe(1)
  })

  it('is a whole number of device pixels at the fractional scales Windows has', () => {
    for (const scale of [1.1, 1.25, 1.5, 1.75, 2.25, 2.5]) {
      const device = groupLineThickness(scale) * scale

      expect(Math.abs(device - Math.round(device)), `${scale}`).toBeLessThan(1e-9)
      expect(Math.round(device)).toBeGreaterThanOrEqual(1)
    }
    expect(groupLineThickness(1.25)).toBeCloseTo(0.8, 9)
    // 150% is a tie between 1 and 2 device pixels, and 1 is what the screen draws today, uniformly: only what was broken changes.
    expect(groupLineThickness(1.5)).toBeCloseTo(1 / 1.5, 9)
    expect(groupLineThickness(1.75)).toBeCloseTo(2 / 1.75, 9)
  })

  it('is at least one device pixel on a screen zoomed out below 100%, and 1 for a ratio that cannot be read', () => {
    expect(groupLineThickness(0.8) * 0.8).toBeCloseTo(1, 9)
    expect(groupLineThickness(0)).toBe(1)
    expect(groupLineThickness(Number.NaN)).toBe(1)
  })
})

describe('the line follows the screen scale', () => {
  afterEach(() => vi.unstubAllGlobals())
  const line = (container: HTMLElement) => container.querySelector<HTMLElement>('.q-chev-line')!

  it('hands the thickness to every drawn head as --group-line, from the screen scale read when it is drawn', () => {
    vi.stubGlobal('devicePixelRatio', 1.25)
    const { container } = render(
      <GroupLineProvider on>
        <GroupTriangle />
      </GroupLineProvider>,
    )

    expect(line(container).style.getPropertyValue('--group-line')).toBe(`${groupLineThickness(1.25)}px`)
  })

  it('stays 1px at 100% and 200%, where nothing was wrong', () => {
    for (const scale of [1, 2]) {
      vi.stubGlobal('devicePixelRatio', scale)
      const { container, unmount } = render(
        <GroupLineProvider on>
          <GroupTriangle />
        </GroupLineProvider>,
      )

      expect(line(container).style.getPropertyValue('--group-line')).toBe('1px')
      unmount()
    }
  })
})

