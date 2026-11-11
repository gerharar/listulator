// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { api, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ThemeContext } from '../../components/quantum/DocumentTheme/ThemeContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import type { Theme } from '../../lib/preferences/theme.js'
import { ListScreen } from './ListScreen.js'

/**
 * The list header's category banner (X-006, 50.9): drawn under eX-Zed only, from the list's registry key, in a clip box that fills the header and sits behind the header's own
 * content; a key with no art draws nothing; Quantum's header is exactly as it was.
 */
vi.mock('../../lib/preferences/store.js', () => ({
  getPreferencesStore: () => ({ get: async () => undefined, set: async () => {} }),
  listPreferenceKey: (listId: string, key: string) => `list:${listId}:${key}`,
}))
vi.mock('../../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: { list: vi.fn(), setConsumed: vi.fn(), itemSource: vi.fn(), restoreOrder: vi.fn() },
}))

const TYPES: MediaType[] = [
  { key: 'movie', label: 'Movies', sortOrder: 1, defaultDurationMinutes: 120, searchAvailable: true, previewable: true },
  { key: 'podcast', label: 'Podcasts', sortOrder: 2, defaultDurationMinutes: 40, searchAvailable: false, previewable: false },
]

const detail = (mediaType: string): MediaListDetail =>
  ({ id: 'L1', title: 'Header list', description: null, mediaType, source: 'manual', externalRef: null, status: null, createdAt: '', updatedAt: '', stats: {} as never, items: [], groups: [] }) as MediaListDetail

beforeEach(() => {
  vi.mocked(api.itemSource).mockResolvedValue({ sourced: false, tags: null })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

async function open(mediaType: string, theme: Theme) {
  vi.mocked(api.list).mockResolvedValue(detail(mediaType))
  render(
    <ThemeContext.Provider value={theme}>
      <LiveRegionProvider>
        <ToastProvider>
          <OverlayManagerProvider>
            <ListScreen listId="L1" mediaTypes={TYPES} pendingUpdates={createPendingUpdates({ get: async () => undefined, set: async () => {} })} />
          </OverlayManagerProvider>
        </ToastProvider>
      </LiveRegionProvider>
    </ThemeContext.Provider>,
  )
  await screen.findByRole('heading', { name: /Header list/ })
  await act(async () => {})
}

const head = () => document.querySelector('.q-list-head')!
const banners = () => head().querySelectorAll<HTMLElement>('.q-catbanner')

describe('the list header’s banner', () => {
  it('under eX-Zed the header holds one banner for the list’s category, in a clip box before the header’s content, two screen pixels to an art pixel', async () => {
    await open('movie', 'exzed')

    await waitFor(() => expect(banners()).toHaveLength(1))
    const banner = banners()[0]!
    expect(banner.dataset.art).toBe('movies')
    expect(banner.dataset.where).toBe('header')
    expect(banner.style.getPropertyValue('--banner-w')).toBe('386px')
    expect(banner.style.getPropertyValue('--banner-h')).toBe('106px')
    const clip = banner.parentElement!
    expect(clip.className).toBe('q-catbanner-clip')
    expect(clip.getAttribute('aria-hidden')).toBe('true')
    expect(clip.parentElement).toBe(head())
    expect(clip.compareDocumentPosition(head().querySelector('.q-list-top')!) & Node.DOCUMENT_POSITION_FOLLOWING, 'behind the text: before it in the header').toBeTruthy()
  })

  it('a list of a type with no art has no banner and no empty box', async () => {
    await open('podcast', 'exzed')

    expect(head().querySelector('.q-catbanner-clip')).toBeNull()
    expect(banners()).toHaveLength(0)
  })

  it('Quantum’s header has no banner', async () => {
    await open('movie', 'quantum')

    expect(head().querySelector('.q-catbanner-clip')).toBeNull()
    expect(banners()).toHaveLength(0)
  })
})
