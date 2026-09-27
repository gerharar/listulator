// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { FacetDropdown, facetsToCompact, facetSummary } from './FacetDropdown.js'
import type { FacetOption } from './FacetToggle.js'

afterEach(cleanup)

const OPTIONS: FacetOption[] = ['AND', 'PS4', 'PS5', 'WIN', 'X360', 'XONE'].map((code) => ({
  key: code.toLowerCase(),
  label: code,
  name: `${code} in full`,
}))

describe('facetSummary (U4)', () => {
  it('says All when nothing is picked', () => {
    expect(facetSummary(OPTIONS, new Set())).toBe('All')
  })

  it('names up to three picks in the options’ order', () => {
    expect(facetSummary(OPTIONS, new Set(['win', 'ps4']))).toBe('PS4, WIN')
    expect(facetSummary(OPTIONS, new Set(['x360', 'win', 'ps4']))).toBe('PS4, WIN, X360')
  })

  it('counts the rest after three', () => {
    expect(facetSummary(OPTIONS, new Set(['xone', 'x360', 'win', 'ps4', 'and']))).toBe('AND, PS4, WIN +2')
  })
})

describe('facetsToCompact (U4)', () => {
  const gap = 10

  it('keeps every facet inline when the row fits', () => {
    expect(facetsToCompact(1000, [250, 100], gap, [{ key: 'platform', inline: 500, compact: 120 }])).toEqual(
      new Set(),
    )
  })

  it('turns a facet into a dropdown when its chips would push the row past the bar', () => {
    // 250 + 100 + 900 + three 10px gaps = 1280 > 1000
    expect(facetsToCompact(1000, [250, 100], gap, [{ key: 'platform', inline: 900, compact: 120 }])).toEqual(
      new Set(['platform']),
    )
  })

  it('turns the facet that saves most first, and stops once the row fits', () => {
    const facets = [
      { key: 'kind', inline: 200, compact: 120 },
      { key: 'platform', inline: 700, compact: 120 },
    ]
    // 250 + 200 + 700 + two gaps(20) + ... = 1170 > 1000; compacting platform saves 580 → fits.
    expect(facetsToCompact(1000, [250], gap, facets)).toEqual(new Set(['platform']))
    expect(facetsToCompact(500, [250], gap, facets)).toEqual(new Set(['platform', 'kind']))
  })
})

function renderDropdown(selected = new Set<string>(), onChange = vi.fn()) {
  render(
    <OverlayManagerProvider>
      <FacetDropdown label="Platform" options={OPTIONS} selected={selected} onChange={onChange} />
    </OverlayManagerProvider>,
  )
  return onChange
}

const summaryButton = () => screen.getByRole('button', { name: /^Platform:/ })

describe('FacetDropdown (U4)', () => {
  it('shows the facet’s name and the selection on its button, plain when nothing is picked', () => {
    renderDropdown()
    expect(screen.getByText('Platform')).toBeTruthy()
    expect(summaryButton().textContent).toBe('All')
    expect(summaryButton().getAttribute('data-on')).toBe('false')
  })

  it('fills the button and lists every pick in full in its hint once anything is picked', () => {
    renderDropdown(new Set(['xone', 'x360', 'win', 'ps4', 'and']))
    expect(summaryButton().textContent).toBe('AND, PS4, WIN +2')
    expect(summaryButton().getAttribute('data-on')).toBe('true')
    expect(summaryButton().getAttribute('title')).toBe(
      'AND in full, PS4 in full, WIN in full, X360 in full, XONE in full',
    )
  })

  it('opens the chips in a popover; a chip toggles additively and the popover stays open', () => {
    const onChange = renderDropdown(new Set(['ps4']))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(summaryButton())
    const pop = screen.getByRole('dialog')
    expect(within(pop).getByText('Platform · 6')).toBeTruthy()
    fireEvent.click(within(pop).getByRole('button', { name: 'WIN' }))

    expect(onChange).toHaveBeenCalledWith(new Set(['ps4', 'win']))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(within(pop).getByRole('button', { name: 'All' }))
    expect(onChange).toHaveBeenLastCalledWith(new Set())
  })

  it('closes again from its button', () => {
    renderDropdown()
    fireEvent.click(summaryButton())
    expect(summaryButton().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(summaryButton())
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
