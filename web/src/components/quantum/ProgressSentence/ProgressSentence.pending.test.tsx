// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { TOOLTIP_DELAY_MS } from '../Tooltip/useTooltip.js'
import { ProgressSentence } from './ProgressSentence.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const wait = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

function renderSentence(runtimesPending?: number) {
  render(
    <OverlayManagerProvider>
      <ProgressSentence done={16} total={38} minutesLeft={883} status={null} size="row" {...(runtimesPending === undefined ? {} : { runtimesPending })} />
    </OverlayManagerProvider>,
  )
}

describe('the progress sentence while lengths are being looked up (15.7)', () => {
  it('shows the time left as approximate, and says on hover how many lengths are still to come', async () => {
    renderSentence(12)

    const left = screen.getByText('≈ 14h 43m left')
    fireEvent.pointerEnter(left, { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS + 50)

    expect(screen.getByRole('tooltip').textContent).toBe('Looking up runtimes: 12 still to go')
  })

  it('is the plain sentence, with no tooltip, when nothing is pending', async () => {
    renderSentence(0)

    const left = screen.getByText('14h 43m left')
    fireEvent.pointerEnter(left, { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS + 50)

    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('is the plain sentence when the caller says nothing about pending lengths', () => {
    renderSentence()

    expect(screen.getByText('14h 43m left')).toBeTruthy()
  })
})
