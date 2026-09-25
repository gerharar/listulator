// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api, type MediaList, type SuggestionPick } from '../../../lib/api.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { FinalizerSheet } from './FinalizerSheet.js'

vi.mock('../../../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: { finalizer: vi.fn() },
}))

const pick = (id: string, status: MediaList['status'] = null): SuggestionPick =>
  ({
    list: { id, title: `List ${id}`, status, stats: { completionPercent: 90, timeRemainingMinutes: 60 } },
    nextItem: { id: `${id}-1`, title: `Next in ${id}`, timeToConsumeMinutes: 30 },
    score: 1,
    factors: { status_band: 1, completion_percent: 1 },
  }) as unknown as SuggestionPick

function renderSheet(over: Partial<Parameters<typeof FinalizerSheet>[0]> = {}) {
  const props = { open: true, onClose: vi.fn(), onOpenList: vi.fn(), ...over }
  render(
    <LiveRegionProvider>
      <OverlayManagerProvider>
        <FinalizerSheet {...props} />
      </OverlayManagerProvider>
    </LiveRegionProvider>,
  )

  return props
}

beforeEach(() => {
  vi.mocked(api.finalizer).mockResolvedValue({ picks: [pick('x', 'complete'), pick('y'), pick('z'), pick('w'), pick('v')] })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('Finalizer', () => {
  it('asks straight away and shows the top pick with three alternates, no list to name', async () => {
    renderSheet()

    expect(await screen.findByText('Next in x')).toBeTruthy()
    expect(screen.getByText('Finish Him!')).toBeTruthy()
    expect(screen.getByText('Tie up loose ends from lists that are closest to being finished')).toBeTruthy()
    expect(screen.queryByText("I'm tired of going through")).toBeNull()
    expect(screen.getByText(/Closest to the finish line: 90% done, only 1h left\. The list is complete/)).toBeTruthy()
    expect(['Next in y', 'Next in z', 'Next in w'].every((title) => screen.queryByText(title))).toBe(true)
    expect(screen.queryByText('Next in v')).toBeNull()
    expect(api.finalizer).toHaveBeenCalledTimes(1)
  })

  it('renders nothing, and asks nothing, when closed', () => {
    renderSheet({ open: false })

    expect(screen.queryByText('Finish Him!')).toBeNull()
    expect(api.finalizer).not.toHaveBeenCalled()
  })

  it('Not That moves on, and Open The List opens the list', async () => {
    const props = renderSheet()
    await screen.findByText('Next in x')

    fireEvent.click(screen.getByRole('button', { name: 'Not That' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open The List' }))

    expect(props.onOpenList).toHaveBeenCalledWith('y')
  })

  it('goes back to the strongest pick once everything was turned down, and says so', async () => {
    vi.mocked(api.finalizer).mockResolvedValue({ picks: [pick('x'), pick('y')] })
    renderSheet()
    await screen.findByText('Next in x')

    fireEvent.click(screen.getByRole('button', { name: 'Not That' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not That' }))

    await waitFor(() => expect(document.querySelector('.q-live')!.textContent).toBe('Back to the strongest pick'))
  })

  it('says there is nothing when every list is finished or empty', async () => {
    vi.mocked(api.finalizer).mockResolvedValue({ picks: [] })
    renderSheet()

    expect(await screen.findByText('Nothing left unfinished — add a list.')).toBeTruthy()
  })

  it('says what failed and can try again', async () => {
    vi.mocked(api.finalizer).mockRejectedValueOnce(new Error('offline'))
    renderSheet()

    expect(await screen.findByText('Could not get a suggestion')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Next in x')).toBeTruthy()
  })

  it('closes with the ✕', async () => {
    const props = renderSheet()
    await screen.findByText('Next in x')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(props.onClose).toHaveBeenCalled()
  })
})
