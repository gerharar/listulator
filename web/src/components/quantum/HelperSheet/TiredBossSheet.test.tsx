// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api, type MediaList, type MediaType, type SuggestionPick } from '../../../lib/api.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { TiredBossSheet } from './TiredBossSheet.js'

vi.mock('../../../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: { tiredBoss: vi.fn() },
}))

const list = (id: string, title = id.toUpperCase()): MediaList =>
  ({ id, title, mediaType: 'tv', stats: { completionPercent: 40, timeRemainingMinutes: 90 } }) as MediaList

const pick = (id: string, itemTitle = `Next in ${id}`, minutes = 45): SuggestionPick =>
  ({
    list: { ...list(id), title: `List ${id}` },
    nextItem: { id: `${id}-1`, title: itemTitle, timeToConsumeMinutes: minutes },
    score: 1,
    factors: { neglect_time: 1, completion_percent: 1 },
  }) as unknown as SuggestionPick

const LISTS = [list('a', 'Alpha'), list('b', 'Beta'), list('c', 'Gamma')]

function renderSheet(over: Partial<Parameters<typeof TiredBossSheet>[0]> = {}) {
  const props = { open: true, onClose: vi.fn(), lists: LISTS, initialTarget: 'a', onOpenList: vi.fn(), ...over }
  render(
    <LiveRegionProvider>
      <OverlayManagerProvider>
        <TiredBossSheet {...props} />
      </OverlayManagerProvider>
    </LiveRegionProvider>,
  )

  return props
}

beforeEach(() => {
  vi.mocked(api.tiredBoss).mockResolvedValue({ picks: [pick('x'), pick('y'), pick('z'), pick('w'), pick('v')] })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('opening', () => {
  it('starts from the list opened last and offers just the top pick, no alternates', async () => {
    renderSheet()

    expect(await screen.findByText('Next in x')).toBeTruthy()
    expect(api.tiredBoss).toHaveBeenCalledWith('a')
    expect(screen.getByText('And Now For Something Completely Different')).toBeTruthy()
    expect(screen.getByText("I'm tired of going through")).toBeTruthy()
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeTruthy()
    expect(screen.getByText('Top pick')).toBeTruthy()
    expect(screen.getByText('List x · 45m')).toBeTruthy()
    expect(screen.getByText(/Different medium, and you haven't touched it/)).toBeTruthy()
    expect(['Next in y', 'Next in z', 'Next in w', 'Next in v'].every((title) => screen.queryByText(title) === null)).toBe(true)
    expect(screen.queryByText('Alternates')).toBeNull()
  })

  it('asks nothing and says so when there is no list to start from', () => {
    renderSheet({ initialTarget: undefined })

    expect(api.tiredBoss).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Pick a list/ })).toBeTruthy()
    expect(screen.queryByText('Top pick')).toBeNull()
  })

  it('ignores a starting list that no longer exists', () => {
    renderSheet({ initialTarget: 'gone' })

    expect(api.tiredBoss).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Pick a list/ })).toBeTruthy()
  })

  it('renders nothing when closed', () => {
    renderSheet({ open: false })

    expect(screen.queryByText('And Now For Something Completely Different')).toBeNull()
    expect(api.tiredBoss).not.toHaveBeenCalled()
  })
})

describe('the list picker', () => {
  it('offers every list, marks the current one, and asks again for the one chosen', async () => {
    renderSheet()
    await screen.findByText('Next in x')

    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
    const menu = await screen.findByText('OR?')
    expect(menu).toBeTruthy()
    expect(screen.getByText('3 of 3')).toBeTruthy()

    vi.mocked(api.tiredBoss).mockResolvedValue({ picks: [pick('q', 'Something else')] })
    fireEvent.click(screen.getByRole('button', { name: 'Gamma' }))

    expect(await screen.findByText('Something else')).toBeTruthy()
    expect(api.tiredBoss).toHaveBeenLastCalledWith('c')
    expect(screen.queryByText('OR?')).toBeNull()
  })

  it('has a filter field only for a long shelf, and says when nothing matches', async () => {
    const many = Array.from({ length: 9 }, (_, i) => list(`l${i}`, `List number ${i}`))
    renderSheet({ lists: many, initialTarget: undefined })

    fireEvent.click(screen.getByRole('button', { name: /Pick a list/ }))
    const filter = await screen.findByPlaceholderText('Find the culprit…')
    fireEvent.change(filter, { target: { value: 'number 3' } })
    expect(screen.getByText('1 of 9')).toBeTruthy()

    fireEvent.change(filter, { target: { value: 'zzz' } })
    expect(screen.getByText('No list matches “zzz”.')).toBeTruthy()
  })

  it('has no filter field for a short shelf', async () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
    await screen.findByText('OR?')

    expect(screen.queryByPlaceholderText('Find the culprit…')).toBeNull()
  })

  it('shows only the newest answer when the choice changes while one is on its way', async () => {
    let releaseFirst!: (value: { picks: SuggestionPick[] }) => void
    vi.mocked(api.tiredBoss)
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce({ picks: [pick('n', 'The newer answer')] })
    renderSheet()

    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Beta' }))
    expect(await screen.findByText('The newer answer')).toBeTruthy()

    await act(async () => releaseFirst({ picks: [pick('o', 'The stale answer')] }))

    expect(screen.queryByText('The stale answer')).toBeNull()
    expect(screen.getByText('The newer answer')).toBeTruthy()
  })
})

describe('Not That', () => {
  it('turns down the top pick and moves the next one up', async () => {
    renderSheet()
    await screen.findByText('Next in x')

    fireEvent.click(screen.getByRole('button', { name: 'Not That' }))

    expect(screen.queryByText('Next in x')).toBeNull()
    expect(within(screen.getByText('Top pick').parentElement!).getByText('Next in y')).toBeTruthy()
  })

  it('goes back to the strongest pick, and says so, once everything has been turned down', async () => {
    vi.mocked(api.tiredBoss).mockResolvedValue({ picks: [pick('x'), pick('y')] })
    renderSheet()
    await screen.findByText('Next in x')

    fireEvent.click(screen.getByRole('button', { name: 'Not That' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not That' }))

    expect(within(screen.getByText('Top pick').parentElement!).getByText('Next in x')).toBeTruthy()
    await waitFor(() => expect(document.querySelector('.q-live')!.textContent).toBe('…Time is a flat circle…'))
  })

  it('starts fresh when another list is chosen', async () => {
    renderSheet()
    await screen.findByText('Next in x')
    fireEvent.click(screen.getByRole('button', { name: 'Not That' }))

    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Beta' }))

    expect(await screen.findByText('Next in x')).toBeTruthy()
  })
})

describe('opening a suggestion', () => {
  it('Open The List opens the top pick’s list', async () => {
    const props = renderSheet()
    await screen.findByText('Next in x')

    fireEvent.click(screen.getByRole('button', { name: 'Open List' }))

    expect(props.onOpenList).toHaveBeenCalledWith('x')
  })
})

describe('when there is nothing, or something goes wrong', () => {
  it('says so when nothing from another medium has anything left', async () => {
    vi.mocked(api.tiredBoss).mockResolvedValue({ picks: [] })
    renderSheet()

    expect(await screen.findByText(/everything unfinished is in the same medium/)).toBeTruthy()
    expect(screen.queryByText('Top pick')).toBeNull()
  })

  it('says what failed and can try again', async () => {
    vi.mocked(api.tiredBoss).mockRejectedValueOnce(new Error('offline'))
    renderSheet()

    expect(await screen.findByText('Couldn\'t find anything to suggest')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(await screen.findByText('Next in x')).toBeTruthy()
    expect(api.tiredBoss).toHaveBeenCalledTimes(2)
  })

  it('closes with the ✕', async () => {
    const props = renderSheet()
    await screen.findByText('Next in x')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(props.onClose).toHaveBeenCalled()
  })
})

describe('naming the source on the pick (task 12.5)', () => {
  const types = [{ key: 'youtube', label: 'YouTube', sourceName: 'YouTube' }] as MediaType[]

  it('adds where a fetched list came from to the list and time line', async () => {
    const fetched = { ...pick('x'), list: { ...pick('x').list, source: 'api', mediaType: 'youtube' } } as unknown as SuggestionPick
    vi.mocked(api.tiredBoss).mockResolvedValue({ picks: [fetched] })

    renderSheet({ mediaTypes: types })

    expect(await screen.findByText('List x \u00b7 45m \u00b7 YouTube')).toBeTruthy()
  })
})
