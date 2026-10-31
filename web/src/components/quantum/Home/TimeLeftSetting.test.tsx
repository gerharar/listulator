// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import { TimeLeftProvider, useTimeLeftSetting } from './TimeLeftSetting.js'

afterEach(cleanup)

function Probe() {
  const { on, setOn } = useTimeLeftSetting()

  return (
    <button type="button" onClick={() => setOn(!on)}>
      {on ? 'on' : 'off'}
    </button>
  )
}

function fakeStore(): PreferencesStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
  }
}

describe('the "Show time left in My Lists" setting (H-024)', () => {
  it('is off for a screen with no provider (a test, a stray render)', () => {
    render(<Probe />)

    expect(screen.getByRole('button').textContent).toBe('off')
  })

  it('starts as the value App read at boot', () => {
    render(
      <TimeLeftProvider on>
        <Probe />
      </TimeLeftProvider>,
    )

    expect(screen.getByRole('button').textContent).toBe('on')
  })

  it('changes at once for everything under it, and is written when there is a store', async () => {
    const store = fakeStore()
    render(
      <TimeLeftProvider on={false} store={store}>
        <Probe />
        <Probe />
      </TimeLeftProvider>,
    )

    act(() => screen.getAllByRole('button')[0]!.click())

    expect(screen.getAllByRole('button').map((entry) => entry.textContent)).toEqual(['on', 'on'])
    await waitFor(() => expect(store.data.get('showTimeLeft')).toBe('true'))

    act(() => screen.getAllByRole('button')[1]!.click())

    expect(screen.getAllByRole('button').map((entry) => entry.textContent)).toEqual(['off', 'off'])
    await waitFor(() => expect(store.data.get('showTimeLeft')).toBe('false'))
  })

  it('only changes, with nothing written, when there is no store', () => {
    render(
      <TimeLeftProvider on={false}>
        <Probe />
      </TimeLeftProvider>,
    )

    act(() => screen.getByRole('button').click())

    expect(screen.getByRole('button').textContent).toBe('on')
  })
})
