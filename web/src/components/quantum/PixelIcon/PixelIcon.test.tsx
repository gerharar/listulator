// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Settings } from 'lucide-react'
import { ThemeContext } from '../DocumentTheme/ThemeContext.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { AppHeader } from '../AppHeader/AppHeader.js'
import { PIXEL_ICONS, PixelIcon, ThemedIcon } from './PixelIcon.js'

afterEach(cleanup)

/** The paths are design's own (design system `project/assets/Icons`: settings, info, quit, check-for-updates), 8x8 cells at 2px. */
const DESIGN = {
  settings: 'M3 0h2v1H3zM1 1h6v1H1zM0 3h1v2H0zM7 3h1v2H7zM1 2h2v4H1zM5 2h2v4H5zM3 2h2v1H3zM3 5h2v1H3zM1 6h6v1H1zM3 7h2v1H3z',
  about: 'M2 0h4v1H2zM1 1h1v1H1zM6 1h1v1H6zM0 2h1v4H0zM7 2h1v4H7zM1 6h1v1H1zM6 6h1v1H6zM2 7h4v1H2zM3 2h2v1H3zM3 4h2v2H3z',
  quit: 'M3 0h2v4H3zM1 1h1v1H1zM6 1h1v1H6zM0 2h1v4H0zM7 2h1v4H7zM1 6h1v1H1zM6 6h1v1H6zM2 7h4v1H2z',
  refresh: 'M2 0h4v1H2zM1 1h1v1H1zM0 2h1v4H0zM7 0h1v3H7zM5 2h2v1H5zM1 6h1v1H1zM7 4h1v2H7zM6 6h1v1H6zM2 7h4v1H2z',
  more: 'M0 3h2v2H0zM3 3h2v2H3zM6 3h2v2H6z',
  close: 'M0 0h2v1H0zM6 0h2v1H6zM1 1h2v1H1zM5 1h2v1H5zM2 2h4v1H2zM3 3h2v2H3zM2 5h4v1H2zM1 6h2v1H1zM5 6h2v1H5zM0 7h2v1H0zM6 7h2v1H6z',
  // Design's D46 (57.9): the list toolbar's icons, from the Icons group: collapse-all, to-the-top, to-the-bottom, hide-done.
  'collapse-all': 'M1 0h1v1H1zM2 1h1v1H2zM3 2h2v1H3zM5 1h1v1H5zM6 0h1v1H6zM3 5h2v1H3zM2 6h1v1H2zM5 6h1v1H5zM1 7h1v1H1zM6 7h1v1H6z',
  'to-the-top':
    'M3 0h1v1H3zM4 0h1v1H4zM2 1h1v1H2zM3 1h1v1H3zM4 1h1v1H4zM5 1h1v1H5zM1 2h1v1H1zM2 2h1v1H2zM3 2h1v1H3zM4 2h1v1H4zM5 2h1v1H5zM6 2h1v1H6zM0 3h1v1H0zM1 3h1v1H1zM3 3h1v1H3zM4 3h1v1H4zM6 3h1v1H6zM7 3h1v1H7zM3 4h1v1H3zM4 4h1v1H4zM3 5h1v1H3zM4 5h1v1H4zM3 6h1v1H3zM4 6h1v1H4zM3 7h1v1H3zM4 7h1v1H4z',
  'to-the-bottom':
    'M3 7h1v1H3zM4 7h1v1H4zM2 6h1v1H2zM3 6h1v1H3zM4 6h1v1H4zM5 6h1v1H5zM1 5h1v1H1zM2 5h1v1H2zM3 5h1v1H3zM4 5h1v1H4zM5 5h1v1H5zM6 5h1v1H6zM0 4h1v1H0zM1 4h1v1H1zM3 4h1v1H3zM4 4h1v1H4zM6 4h1v1H6zM7 4h1v1H7zM3 3h1v1H3zM4 3h1v1H4zM3 2h1v1H3zM4 2h1v1H4zM3 1h1v1H3zM4 1h1v1H4zM3 0h1v1H3zM4 0h1v1H4z',
  'hide-done': 'M3 1h2v1H3zM1 2h2v1H1zM5 2h2v1H5zM0 3h1v1H0zM3 3h2v1H3zM7 3h1v1H7zM0 4h1v1H0zM3 4h2v1H3zM7 4h1v1H7zM1 5h2v1H1zM5 5h2v1H5zM3 6h2v1H3zM0 0h1v1H0zM1 1h1v1H1zM6 6h1v1H6zM7 7h1v1H7z',
}

function Providers({ theme, children }: { theme: 'quantum' | 'exzed'; children: ReactNode }) {
  return (
    <ThemeContext.Provider value={theme}>
      <LiveRegionProvider>
        <OverlayManagerProvider>{children}</OverlayManagerProvider>
      </LiveRegionProvider>
    </ThemeContext.Provider>
  )
}

describe('PixelIcon', () => {
  for (const [name, d] of Object.entries(DESIGN)) {
    it(`draws design's ${name} icon: 8x8 cells at 2px, one ink, sharp edges, hidden from assistive technology`, () => {
      const { container } = render(<PixelIcon name={name as keyof typeof DESIGN} />)
      const svg = container.querySelector('svg')!

      expect(svg.getAttribute('width')).toBe('16')
      expect(svg.getAttribute('height')).toBe('16')
      expect(svg.getAttribute('viewBox')).toBe('0 0 8 8')
      expect(svg.getAttribute('shape-rendering')).toBe('crispEdges')
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.getAttribute('data-pixel-icon')).toBe(name)
      expect(svg.querySelector('path')!.getAttribute('fill')).toBe('currentColor')
      expect(svg.querySelector('path')!.getAttribute('d')).toBe(d)
      expect(PIXEL_ICONS[name as keyof typeof DESIGN]).toBe(d)
    })
  }

  it('keeps a class the caller gives it (the refresh icon turns by `q-spin`)', () => {
    const { container } = render(<PixelIcon name="refresh" className="q-spin" />)
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('q-spin')
  })

  /**
   * The design system has no expand-all twin (57.9 lists it to design): ours is collapse-all's two chevrons turned outward, each in its own half, so the pair that closes every group and the pair
   * that opens them are the same drawing. Cells are read from the paths, so the test is the derivation, not a second copy of the string.
   */
  it('draws expand-all as collapse-all with each chevron turned outward in place (ours: design has none)', () => {
    const cells = (d: string) => new Set([...d.matchAll(/M(\d+) (\d+)h(\d+)v1H\d+z/g)].flatMap((m) => Array.from({ length: Number(m[3]) }, (_, n) => `${Number(m[1]) + n},${m[2]}`)))
    const collapse = cells(PIXEL_ICONS['collapse-all'])
    const expand = cells(PIXEL_ICONS['expand-all'])
    const turned = new Set(
      [...collapse].map((cell) => {
        const [x, y] = cell.split(',').map(Number) as [number, number]
        // The top half (rows 0 to 2) and the bottom half (rows 5 to 7) each turn about their own middle row.
        return `${x},${y <= 2 ? 2 - y : 12 - y}`
      }),
    )

    expect([...expand].sort()).toEqual([...turned].sort())
    expect(PIXEL_ICONS['expand-all']).not.toBe(PIXEL_ICONS['collapse-all'])
  })
})

describe('ThemedIcon', () => {
  it('is the pixel icon under eX-Zed and Quantum’s own icon otherwise', () => {
    const view = (theme: 'quantum' | 'exzed') => (
      <Providers theme={theme}>
        <ThemedIcon name="settings" fallback={<Settings data-testid="lucide" />} />
      </Providers>
    )
    const { rerender, container } = render(view('quantum'))
    expect(screen.getByTestId('lucide')).toBeTruthy()
    expect(container.querySelector('[data-pixel-icon]')).toBeNull()

    rerender(view('exzed'))
    expect(screen.queryByTestId('lucide')).toBeNull()
    expect(container.querySelector('[data-pixel-icon="settings"]')).not.toBeNull()
  })
})

describe('the app header’s icons', () => {
  const header = (theme: 'quantum' | 'exzed') => (
    <Providers theme={theme}>
      <AppHeader
        skin="dark-orange"
        onSkinChange={vi.fn()}
        exzedSkin="exzed-1d"
        onExzedSkinChange={vi.fn()}
        onSettings={vi.fn()}
        onAbout={vi.fn()}
        quit={{ platform: 'mac', quit: vi.fn(() => Promise.resolve()), holdClose: vi.fn(() => Promise.resolve()), onQuitWhileRunning: vi.fn(() => Promise.resolve(() => {})) }}
      />
    </Providers>
  )

  it('are design’s pixel icons under eX-Zed: Settings, About and Quit', () => {
    render(header('exzed'))
    for (const [label, icon] of [['Settings', 'settings'], ['About', 'about'], ['Quit', 'quit']] as const) {
      expect(screen.getByRole('button', { name: label }).querySelector(`[data-pixel-icon="${icon}"]`), label).not.toBeNull()
    }
  })

  it('are Quantum’s own under Quantum', () => {
    render(header('quantum'))
    for (const label of ['Settings', 'About', 'Quit']) {
      const button = screen.getByRole('button', { name: label })
      expect(button.querySelector('[data-pixel-icon]'), label).toBeNull()
      expect(button.querySelector('svg'), label).not.toBeNull()
    }
  })
})
