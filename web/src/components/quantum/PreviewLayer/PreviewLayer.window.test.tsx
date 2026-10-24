// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { api, type MediaType, type PreviewItem } from '../../../lib/api.js'
import type { PreviewSource } from '../../../lib/preview.js'
import { LayerStackProvider } from '../layerStack/LayerStackContext.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { PreviewLayer } from './PreviewLayer.js'

/**
 * Phase 26.2: a long Preview draws only the rows near the view, with spacers of the exact height for the rest. jsdom has no layout, so the
 * scroller's height is given and a scroll is announced by hand; what is checked is which rows are drawn and where the reader is.
 */

vi.mock('../../../lib/api.js', async () => ({
  ApiError: class extends Error {},
  api: { preview: vi.fn(), createFromSource: vi.fn() },
}))

/** The app's preferences: the switch is `listVirtualization` (Phase 25.7). */
const preferences = vi.hoisted(() => ({ values: new Map<string, string>() }))
vi.mock('../../../lib/preferences/store.js', () => ({
  getPreferencesStore: () => ({ get: async (key: string) => preferences.values.get(key), set: async () => {} }),
}))

const MOVIE: MediaType = { key: 'movie', label: 'Movies', sortOrder: 10, defaultDurationMinutes: 120, searchAvailable: true, previewable: true, sourceName: 'List Vault' }
const SOURCE: PreviewSource = { mediaType: 'movie', externalRef: 'canonical:lists/mega/big.yaml', title: 'Big', options: {} }
const home = { id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }
const VIEWPORT = 400

beforeEach(() => {
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT)
  preferences.values.clear()
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.restoreAllMocks()
  preferences.values.clear()
})

const films = (count: number, perGroup?: number): PreviewItem[] =>
  Array.from({ length: count }, (_, index) => ({
    title: `Film ${index}`,
    ...(perGroup ? { group: `Season ${Math.floor(index / perGroup)}` } : {}),
  }))

async function mount(items: PreviewItem[]) {
  vi.mocked(api.preview).mockResolvedValue({ itemCount: items.length, items })
  render(
    <LiveRegionProvider>
      <LayerStackProvider home={home}>
        <PreviewLayer source={SOURCE} mediaType={MOVIE} onBuilt={vi.fn()} />
      </LayerStackProvider>
    </LiveRegionProvider>,
  )
  await screen.findByText(new RegExp(`^${items.length} items ·`))
  const body = document.querySelector('.q-preview-body') as HTMLElement

  return {
    body,
    rows: () => document.querySelectorAll('.q-preview-row').length,
    heads: () => document.querySelectorAll('.q-preview-group').length,
    spacers: () => [...body.querySelectorAll('.q-list-spacer')].map((node) => Number.parseInt((node as HTMLElement).style.height, 10)),
    scrollTo: async (top: number) => {
      Object.defineProperty(body, 'scrollTop', { value: top, configurable: true, writable: true })
      await act(async () => {
        body.dispatchEvent(new Event('scroll'))
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      })
    },
  }
}

describe('a long Preview draws a window (26.2)', () => {
  it('draws a few dozen rows of 10,000, and spacers and rows add up to 40px a row', async () => {
    const { rows, heads, spacers } = await mount(films(10_000))

    expect(rows()).toBeGreaterThan(9)
    expect(rows()).toBeLessThan(100)
    expect(heads()).toBe(0)
    expect(spacers().reduce((sum, height) => sum + height, 0) + rows() * 40).toBe(10_000 * 40)
  })

  it('follows a scroll: the rows at the new place are drawn, the first are not', async () => {
    const { scrollTo, body } = await mount(films(10_000))

    await scrollTo(200_000)

    expect(screen.getByText('Film 5000')).toBeTruthy()
    expect(screen.queryByText('Film 0')).toBeNull()
    expect(body.querySelectorAll('.q-preview-row').length).toBeLessThan(100)
  })

  it('the end of the list is reachable: the last row is drawn at the bottom', async () => {
    const { scrollTo, spacers } = await mount(films(10_000))

    await scrollTo(10_000 * 40 - VIEWPORT)

    expect(screen.getByText('Film 9999')).toBeTruthy()
    expect(spacers().reduce((sum, height) => sum + height, 0) + document.querySelectorAll('.q-preview-row').length * 40).toBe(10_000 * 40)
  })

  it('draws groups as flat markup, a head and its rows in the body, with a spacer for the rows not drawn', async () => {
    const { body, spacers } = await mount(films(10_000, 100))

    expect(document.querySelectorAll('.q-preview-group').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.q-preview-group').length).toBeLessThan(5)
    for (const node of body.querySelectorAll('.q-preview-group, .q-preview-row')) expect(node.parentElement).toBe(body)
    expect(spacers().length).toBeGreaterThan(0)
  })

  it('draws every row, with no spacer, under 200 rows', async () => {
    const { rows, heads, spacers } = await mount(films(150, 25))

    expect([rows(), heads(), spacers()]).toEqual([150, 6, []])
  })

  it('draws every row, with no spacer, when the switch is off, in the app preference', async () => {
    preferences.values.set('listVirtualization', 'off')
    const { rows, spacers } = await mount(films(600))

    expect([rows(), spacers()]).toEqual([600, []])
  })

  it('folding a group in the middle keeps the reader at that group, whatever the rows around it', async () => {
    const { body, scrollTo } = await mount(films(10_000, 100))
    // Group 50 starts at 50 * 101 * 40; the view is 1,000px into it.
    const start = 50 * 101 * 40
    await scrollTo(start + 1000)

    fireEvent.click(screen.getByRole('button', { name: /Fold Season 50|Collapse Season 50/i }))

    expect(body.scrollTop).toBe(start)
    expect(screen.getByRole('button', { name: /Expand Season 50/i })).toBeTruthy()
    expect(document.querySelectorAll('.q-preview-row').length).toBeLessThan(100)
  })

  it('a group head that has the focus stays drawn when it is scrolled far away', async () => {
    const { scrollTo } = await mount(films(10_000, 100))
    const head = screen.getByRole('button', { name: 'Collapse Season 0' })
    act(() => head.focus())

    await scrollTo(300_000)

    expect(screen.getByRole('button', { name: 'Collapse Season 0' })).toBe(head)
  })
})

describe('a windowed Preview tells a screen reader where each row is (26.3)', () => {
  const place = () => [...document.querySelectorAll('.q-place')].map((node) => node.textContent)

  it('says what is drawn once, in a sentence that tells to scroll, and where each row is', async () => {
    await mount(films(10_000))

    expect(place()[0]).toBe('10000 items. Only the rows near the screen are drawn. Scroll to reach the others.')
    expect(place()[1]).toBe('1 of 10000')
    expect(place()[2]).toBe('2 of 10000')
  })

  it('counts a row among the rows there are, after a scroll as well', async () => {
    const { scrollTo } = await mount(films(10_000))

    await scrollTo(200_000)

    const row = screen.getByText('Film 5000').closest('.q-preview-row')!
    expect(row.querySelector('.q-place')!.textContent).toBe('5001 of 10000')
  })

  it('numbers the group heads among the groups, and describes the head with it without changing its name', async () => {
    await mount(films(10_000, 100))
    const head = screen.getByRole('button', { name: 'Collapse Season 0' })

    expect(head.querySelector('.q-place')!.textContent).toBe('Group 1 of 100')
    expect(document.getElementById(head.getAttribute('aria-describedby')!)!.textContent).toBe('Group 1 of 100')
    expect(place()[0]).toBe('10000 items. Only the rows near the screen are drawn. Scroll to reach the others.')
  })

  it('does not count the rows of a folded group', async () => {
    await mount(films(10_000, 100))

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Season 0' }))

    expect(place()[0]).toBe('9900 items. Only the rows near the screen are drawn. Scroll to reach the others.')
  })

  it('says nothing under 200 rows, or with the switch off', async () => {
    await mount(films(150, 25))
    expect(place()).toEqual([])
    cleanup()

    preferences.values.set('listVirtualization', 'off')
    await mount(films(600))
    expect(place()).toEqual([])
  })
})

describe('Home and End in a long Preview (32.5b)', () => {
  const live = () => document.querySelector('.q-live')!.textContent
  // 10,000 items in groups of 100: a head is a row too.
  const FULL = (10_000 + 100) * 40
  const LAST = FULL - VIEWPORT

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(FULL)
  })

  /** A browser keeps a scroll position within the last screenful; jsdom does not. */
  function clampScroll(body: HTMLElement) {
    let top = 0
    Object.defineProperty(body, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => void (top = Math.max(0, Math.min(value, LAST))) })
  }

  it('End from a group head goes to the very bottom: the last row is drawn, and the live region says so', async () => {
    const { body } = await mount(films(10_000, 100))
    clampScroll(body)
    const head = screen.getAllByRole('button', { name: /^Collapse Season/ })[0]!
    head.focus()

    await act(async () => {
      fireEvent.keyDown(head, { key: 'End' })
    })

    expect(body.scrollTop).toBe(LAST)
    expect(screen.getByText('Film 9999')).toBeTruthy()
    expect(screen.queryByText('Film 0')).toBeNull()
    await vi.waitFor(() => expect(live()).toBe('Bottom of the list'))
  })

  it('Home goes back to the very top, from far away', async () => {
    const { body, scrollTo } = await mount(films(10_000, 100))
    await scrollTo(200_000)
    const head = screen.getAllByRole('button', { name: /^Collapse Season/ })[0]!

    await act(async () => {
      fireEvent.keyDown(head, { key: 'Home' })
    })

    expect(body.scrollTop).toBe(0)
    expect(screen.getByText('Film 0')).toBeTruthy()
    await vi.waitFor(() => expect(live()).toBe('Top of the list'))
  })

  it('moves focus to the rows’ own scroller, so a group head left at the other end is not the focused element (WebKit scrolls to it)', async () => {
    const { body } = await mount(films(10_000, 100))
    clampScroll(body)
    const head = screen.getAllByRole('button', { name: /^Collapse Season/ })[0]!
    head.focus()

    await act(async () => {
      fireEvent.keyDown(head, { key: 'End' })
    })

    expect(document.activeElement).toBe(body)
    expect(body.tabIndex).toBe(-1)
  })

  it('takes over the key, so the browser does not scroll a second time', async () => {
    await mount(films(10_000, 100))
    const head = screen.getAllByRole('button', { name: /^Collapse Season/ })[0]!

    const notPrevented = fireEvent.keyDown(head, { key: 'End' })

    expect(notPrevented).toBe(false)
  })

  it('works on a short Preview that is not drawn as a window', async () => {
    const { body } = await mount(films(20, 10))
    clampScroll(body)
    const head = screen.getAllByRole('button', { name: /^Collapse Season/ })[0]!

    await act(async () => {
      fireEvent.keyDown(head, { key: 'End' })
    })

    expect(body.scrollTop).toBe(LAST)
  })

  it('leaves a modifier and every other key alone', async () => {
    const { body } = await mount(films(10_000, 100))
    const head = screen.getAllByRole('button', { name: /^Collapse Season/ })[0]!

    await act(async () => {
      fireEvent.keyDown(head, { key: 'End', ctrlKey: true })
      fireEvent.keyDown(head, { key: 'End', metaKey: true })
      fireEvent.keyDown(head, { key: 'End', shiftKey: true })
      fireEvent.keyDown(head, { key: 'PageDown' })
    })

    expect(body.scrollTop).toBe(0)
    expect(live() ?? '').toBe('')
  })
})

