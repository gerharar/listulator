// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { api, type MediaType } from '../../../lib/api.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { ToastProvider } from '../Toast/Toast.js'
import { SurpriseSheet } from './SurpriseSheet.js'

vi.mock('../../../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: { libraryUntracked: vi.fn() },
}))

const TYPES: MediaType[] = [
  { key: 'mega', label: 'Mega', sortOrder: 1, defaultDurationMinutes: 120, searchAvailable: true, previewable: true },
  { key: 'book', label: 'Books', sortOrder: 2, defaultDurationMinutes: 240, searchAvailable: true, previewable: true },
  { key: 'mma', label: 'MMA', sortOrder: 3, defaultDurationMinutes: 180, searchAvailable: true, previewable: true },
  { key: 'tv', label: 'TV Shows', sortOrder: 4, defaultDurationMinutes: 50, searchAvailable: true, previewable: true },
]

const ENTRIES = [
  { externalRef: 'canonical:lists/mega/mcu.yaml', title: 'MCU', category: 'mega', itemCount: 23, description: 'Every film, in release order.', status: 'complete' as const },
  { externalRef: 'canonical:lists/book/lotr.yaml', title: 'The Lord of the Rings', category: 'book', itemCount: 3 },
  { externalRef: 'canonical:lists/book/hobbit.yaml', title: 'The Hobbit', category: 'book' },
  { externalRef: 'canonical:lists/mma/ufc.yaml', title: 'All UFC Events', category: 'mma', itemCount: 757 },
]

function renderSheet(over: Partial<Parameters<typeof SurpriseSheet>[0]> = {}) {
  // A "random" that always picks the first candidate, so the landing is known.
  const props = { open: true, onClose: vi.fn(), mediaTypes: TYPES, onTake: vi.fn(), random: () => 0, ...over }
  render(
    <LiveRegionProvider>
      <ToastProvider>
        <OverlayManagerProvider>
          <SurpriseSheet {...props} />
        </OverlayManagerProvider>
      </ToastProvider>
    </LiveRegionProvider>,
  )

  return props
}

const reduced = (on: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: on && query.includes('reduce'), addEventListener() {}, removeEventListener() {} }))

beforeEach(() => {
  reduced(false)
  vi.mocked(api.libraryUntracked).mockResolvedValue({ entries: ENTRIES, reachable: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

async function ready() {
  await screen.findByRole('button', { name: 'Spin To Win!' })
}
const chip = (name: string) => screen.getByRole('button', { name })
const digits = () => Array.from(document.querySelectorAll('.q-digit')).map((d) => d.textContent).join('')
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(2500)))

describe('opening', () => {
  it('shows the frame, one chip per shelf plus Any, and how many candidates are in play', async () => {
    renderSheet()
    await ready()

    expect(screen.getByText('Surprise, MFer!')).toBeTruthy()
    expect(screen.getByText(/Random canonical list you're not tracking yet/)).toBeTruthy()
    expect(['Any', 'Mega', 'Books', 'MMA', 'TV Series'].every((label) => chip(label))).toBe(true)
    expect(chip('Any').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('4 candidates across all categories')).toBeTruthy()
    expect(screen.queryByText('Spin to win!')).toBeNull()
    expect(screen.getAllByText('Spin To Win!')).toHaveLength(1) // the button only: no SPIN kicker above the dials
    expect(document.querySelector('.q-reel-head .q-kicker')).toBeNull()
    expect(document.querySelector('.q-reel-meta')).toBeNull()
    expect(digits()).toBe('000000')
    expect(screen.getByText('Choose your categories and try your luck!')).toBeTruthy()
  })

  it('renders nothing, and asks nothing, when closed', () => {
    renderSheet({ open: false })

    expect(screen.queryByText('Surprise, MFer!')).toBeNull()
    expect(api.libraryUntracked).not.toHaveBeenCalled()
  })

  it('says the library could not be reached, and can try again', async () => {
    vi.mocked(api.libraryUntracked).mockResolvedValueOnce({ entries: [], reachable: false })
    renderSheet()

    expect(await screen.findByText('Could not reach the List Vault.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))

    expect(await screen.findByRole('button', { name: 'Spin To Win!' })).toBeTruthy()
  })
})

describe('the shelves', () => {
  it('are additive toggles; Any clears them; the count follows', async () => {
    renderSheet()
    await ready()

    fireEvent.click(chip('Books'))
    expect(screen.getByText('2 candidates in this category')).toBeTruthy()
    expect(chip('Any').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(chip('MMA'))
    expect(screen.getByText('3 candidates in 2 categories')).toBeTruthy()

    fireEvent.click(chip('Any'))
    expect(screen.getByText('4 candidates across all categories')).toBeTruthy()
  })

  it('say when nothing is left on a shelf, and dim it', async () => {
    renderSheet()
    await ready()

    expect(chip('TV Series').getAttribute('title')).toBe('Nothing left here: you are tracking everything')
    expect(chip('TV Series').className).toContain('none')
    expect(chip('Books').getAttribute('title')).toBe('2 candidates in this category')
    fireEvent.click(chip('TV Series'))
    expect(screen.getByText('Nothing left here: you are tracking everything')).toBeTruthy()
  })
})

describe('its styles', () => {
  it('do not reuse the Spinner component’s class, whose rotation would spin the whole panel', async () => {
    renderSheet()
    await ready()

    expect(document.querySelector('.q-reel')).toBeTruthy()
    // The loading Spinner is gone by now; nothing of the reel may carry its class.
    expect(document.querySelector('.q-reel.q-spinner, .q-reel .q-spinner')).toBeNull()
    expect(document.querySelectorAll('.q-spinner')).toHaveLength(0)
  })
})

describe('spinning', () => {
  it('spins the dials, locks the button, then lands on a list and shows what it is', async () => {
    vi.useFakeTimers()
    renderSheet()
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)))

    fireEvent.click(screen.getByRole('button', { name: 'Spin To Win!' }))
    expect(screen.getByRole('button', { name: 'Spinning…' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getAllByText('Spinning…')).toHaveLength(1) // the button's label; no second line above it
    expect(document.querySelector('.q-reel-meta')).toBeNull()

    await settle()

    expect(screen.getByText('MCU')).toBeTruthy()
    expect(screen.getByText('Mega · 23 items · canonical list')).toBeTruthy()
    expect(screen.getByText('Every film, in release order.')).toBeTruthy()
    expect(screen.getByText('Complete')).toBeTruthy()
    expect(digits()).toBe('000023')
    expect(screen.getByRole('button', { name: 'Spin Again' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'This One' })).toBeTruthy()
    expect(document.querySelectorAll('.q-digit.on')).toHaveLength(3)
    expect(document.querySelector('.q-live')!.textContent).toBe('Landed on MCU')
  })

  it('draws only from the shelves picked', async () => {
    vi.useFakeTimers()
    renderSheet()
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)))

    fireEvent.click(chip('MMA'))
    fireEvent.click(screen.getByRole('button', { name: 'Spin To Win!' }))
    await settle()

    expect(screen.getByText('All UFC Events')).toBeTruthy()
    expect(screen.getByText('MMA · 757 items · canonical list')).toBeTruthy()
  })

  it('shows dashes for the count when the index does not carry one', async () => {
    reduced(true)
    // On the Books shelf, a random of .99 picks the second book, which has no count.
    renderSheet({ random: () => 0.99 })
    await ready()

    fireEvent.click(chip('Books'))
    fireEvent.click(screen.getByRole('button', { name: 'Spin To Win!' }))

    expect(await screen.findByText('The Hobbit')).toBeTruthy()
    expect(screen.getByText('Books · canonical list')).toBeTruthy()
    expect(digits()).toBe('——————')
  })

  it('skips the show under reduced motion and lands at once', async () => {
    reduced(true)
    renderSheet()
    await ready()

    fireEvent.click(screen.getByRole('button', { name: 'Spin To Win!' }))

    expect(await screen.findByText('MCU')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'This One' })).toBeTruthy()
  })

  it('starts over when a shelf changes, forgetting what landed', async () => {
    vi.useFakeTimers()
    renderSheet()
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)))
    fireEvent.click(screen.getByRole('button', { name: 'Spin To Win!' }))
    await settle()
    expect(screen.getByRole('button', { name: 'This One' })).toBeTruthy()

    fireEvent.click(chip('Books'))

    expect(screen.queryByRole('button', { name: 'This One' })).toBeNull()
    expect(digits()).toBe('000000')
    expect(screen.queryByText('Spin to win!')).toBeNull()
  })

  it('says there is nothing to spin when nothing is left on the shelves, instead of spinning', async () => {
    renderSheet()
    await ready()

    fireEvent.click(chip('TV Series'))
    fireEvent.click(screen.getByRole('button', { name: 'Spin To Win!' }))

    expect(await screen.findByText('Nothing left in this category: you already track every canonical list there.')).toBeTruthy()
    expect(screen.queryByText('Spinning…')).toBeNull()
  })

  it('stops the spin for good when the sheet closes mid-spin', async () => {
    vi.useFakeTimers()
    const random = vi.fn(() => 0)
    renderSheet({ random })
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)))
    fireEvent.click(screen.getByRole('button', { name: 'Spin To Win!' }))
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)))
    const during = random.mock.calls.length
    expect(during).toBeGreaterThan(2)

    cleanup()
    await vi.advanceTimersByTimeAsync(3000)

    // A timer left running would keep asking for random faces.
    expect(random.mock.calls.length).toBe(during)
  })
})

describe('taking the pick', () => {
  it('This One hands the entry over, to be previewed and added through the ordinary path', async () => {
    reduced(true)
    const props = renderSheet()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Spin To Win!' }))
    await screen.findByText('MCU')

    fireEvent.click(screen.getByRole('button', { name: 'This One' }))

    expect(props.onTake).toHaveBeenCalledWith(ENTRIES[0])
  })

  it('closes with the ✕', async () => {
    const props = renderSheet()
    await ready()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(props.onClose).toHaveBeenCalled()
  })
})
