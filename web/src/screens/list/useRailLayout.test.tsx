// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { RailPlacementProvider, type RailPlacementState } from './RailPlacementContext.js'
import { useRailLayout } from './useRailLayout.js'

/** What the list screen and the Preview both work out from where the rail sits (H-019). */

function layout(where: RailPlacementState, entries = 3, active = true) {
  const wrapper = ({ children }: { children: ReactNode }) => <RailPlacementProvider value={where}>{children}</RailPlacementProvider>

  return renderHook(() => useRailLayout(entries, active), { wrapper }).result.current
}

const INSIDE: RailPlacementState = { placement: 'inside', windowWidth: 1440 }
const OUTSIDE: RailPlacementState = { placement: 'outside', windowWidth: 1728 }

describe('useRailLayout', () => {
  it('shows the rail for two or more entries, and never for fewer', () => {
    expect(layout(INSIDE, 2).show).toBe(true)
    expect(layout(INSIDE, 1).show).toBe(false)
    expect(layout(INSIDE, 0).show).toBe(false)
  })

  it('shows an outside rail on the active layer only, and an inside one on every layer', () => {
    expect(layout(OUTSIDE, 3, true).show).toBe(true)
    expect(layout(OUTSIDE, 3, false).show).toBe(false)
    expect(layout(INSIDE, 3, false).show).toBe(true)
  })

  it('says whether the rail is outside, and how wide it may be there: the margin less 16px', () => {
    expect(layout(INSIDE).outside).toBe(false)
    expect(layout(OUTSIDE).outside).toBe(true)
    // Window 1728: margin 304.
    expect(layout(OUTSIDE).maxWidth).toBe(288)
  })

  it('draws the stored width inside, capped outside, and following the window while carried', () => {
    expect(layout(INSIDE).shownWidth(324)).toBe(324)
    expect(layout(OUTSIDE).shownWidth(480)).toBe(288)
    expect(layout({ placement: 'inside', windowWidth: 1500, carried: true }).shownWidth(324)).toBe(174)
  })

  it('ends the carry before it passes a width on, so what the reader sets is what is shown', () => {
    const order: string[] = []
    const release = vi.fn(() => void order.push('release'))
    const set = vi.fn(() => void order.push('set'))

    layout({ placement: 'inside', windowWidth: 1500, carried: true, release }).resizing(set)(260)

    expect(order).toEqual(['release', 'set'])
    expect(set).toHaveBeenCalledWith(260)
  })

  it('passes the width on when there is no carry to end', () => {
    const set = vi.fn()

    layout(INSIDE).resizing(set)(260)

    expect(set).toHaveBeenCalledWith(260)
  })
})
