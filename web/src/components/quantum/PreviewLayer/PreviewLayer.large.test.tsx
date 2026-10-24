// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { api, type MediaType, type PreviewItem } from '../../../lib/api.js'
import type { PreviewSource } from '../../../lib/preview.js'
import { LayerStackProvider } from '../layerStack/LayerStackContext.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { PreviewLayer } from './PreviewLayer.js'

/**
 * Task 15.8: the Preview now lists a whole source (a studio of 2,161 films, TOHO) without lengths. How long
 * does such a layer take to render? jsdom is several times slower than a browser, so a time under the bound
 * here is comfortable in the app; the number is printed for the record (docs/DECISIONS.md, "15.8").
 */

vi.mock('../../../lib/api.js', async () => ({
  ApiError: class extends Error {},
  api: { preview: vi.fn(), createFromSource: vi.fn() },
}))

// This test counts every row in the DOM, which is what the switch `off` draws; the window (26.2) has its own tests (`PreviewLayer.window.test.tsx`).
vi.mock('../../../lib/preferences/store.js', () => ({
  getPreferencesStore: () => ({ get: async (key: string) => (key === 'listVirtualization' ? 'off' : undefined), set: async () => {} }),
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const MOVIE: MediaType = { key: 'movie', label: 'Movies', sortOrder: 10, defaultDurationMinutes: 120, searchAvailable: true, previewable: true, sourceName: 'TMDB' }
const SOURCE: PreviewSource = { mediaType: 'movie', externalRef: 'company:1', title: 'TOHO', options: {} }
const home = { id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }

const films = (count: number, grouped: boolean): PreviewItem[] =>
  Array.from({ length: count }, (_, index) => ({
    title: `Film number ${index + 1}`,
    year: 1950 + (index % 75),
    ...(grouped ? { group: `Season ${Math.floor(index / 25) + 1}` } : {}),
  }))

async function renderMs(items: PreviewItem[]): Promise<number> {
  vi.mocked(api.preview).mockResolvedValue({ itemCount: items.length, items })
  const started = performance.now()
  render(
    <LiveRegionProvider>
    <LayerStackProvider home={home}>
      <PreviewLayer source={SOURCE} mediaType={MOVIE} onBuilt={vi.fn()} />
    </LayerStackProvider>
</LiveRegionProvider>,
  )
  await screen.findByText(new RegExp(`^${items.length} items`))

  return performance.now() - started
}

describe('a whole-source Preview (15.8)', () => {
  it.each([
    ['without groups', false],
    ['in season groups of 25', true],
  ])('renders 2,161 rows %s, every one with "-" for its length', async (_label, grouped) => {
    const ms = await renderMs(films(2161, grouped))

    console.info(`[15.8] 2,161-row preview ${grouped ? 'in groups' : 'flat'}: ${Math.round(ms)} ms in jsdom`)
    expect(document.querySelectorAll('.q-preview-row')).toHaveLength(2161)
    expect(document.querySelectorAll('.q-preview-row .mins.none')).toHaveLength(2161)
    expect(ms).toBeLessThan(6000)
  })
})
