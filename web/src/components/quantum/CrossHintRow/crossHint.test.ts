import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type ListSourceResult } from '../../../lib/api.js'
import { lookupCrossHint } from './crossHint.js'

vi.mock('../../../lib/api.js', () => ({ api: { searchSources: vi.fn() } }))

afterEach(() => vi.resetAllMocks())

const MEGA = { key: 'mega' }
const LISTS: ListSourceResult[] = [
  { externalRef: 'canonical:lists/mega/a.yaml', title: 'Breaking Bad - main', detail: 'Canonical list', description: 'The main story', itemCount: 126 },
  { externalRef: 'canonical:lists/mega/b.yaml', title: 'Breaking Bad - all', detail: 'Canonical list' },
]

describe('lookupCrossHint', () => {
  it('asks the library-scope category for the same search the user made, and keeps what a row needs', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({ sources: LISTS })

    const hint = await lookupCrossHint(MEGA, 'breaking bad')

    expect(api.searchSources).toHaveBeenCalledExactlyOnceWith('mega', 'breaking bad')
    expect(hint).toEqual({
      category: 'mega',
      query: 'breaking bad',
      lists: [
        { externalRef: 'canonical:lists/mega/a.yaml', title: 'Breaking Bad - main', description: 'The main story', itemCount: 126 },
        { externalRef: 'canonical:lists/mega/b.yaml', title: 'Breaking Bad - all' },
      ],
    })
  })

  it('is nothing when no list matches', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({ sources: [] })

    expect(await lookupCrossHint(MEGA, 'zzz')).toBeNull()
  })

  it('is nothing, never an error, when the library cannot be reached', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({ sources: LISTS, libraryUnreachable: true })

    expect(await lookupCrossHint(MEGA, 'breaking bad')).toBeNull()
  })

  it('is nothing, never an error, when the search fails', async () => {
    vi.mocked(api.searchSources).mockRejectedValue(new Error('offline'))

    expect(await lookupCrossHint(MEGA, 'breaking bad')).toBeNull()
  })
})
