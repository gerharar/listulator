// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { FacetDropdown, facetSummary } from './FacetDropdown.js'
import type { FacetOption } from './FacetToggle.js'
import { hoverTooltip } from '../Tooltip/hoverTooltip.js'
import { en } from '../../../locale/en.js'

afterEach(cleanup)

const OPTIONS: FacetOption[] = ['AND', 'PS4', 'PS5', 'WIN', 'X360', 'XONE'].map((code) => ({
  key: code.toLowerCase(),
  label: code,
  name: `${code} in full`,
}))

describe('facetSummary (H-023)', () => {
  it('says All when nothing is picked', () => {
    expect(facetSummary(OPTIONS, new Set())).toBe('All')
  })

  it('names one or two picks in the options’ order', () => {
    expect(facetSummary(OPTIONS, new Set(['win']))).toBe('WIN')
    expect(facetSummary(OPTIONS, new Set(['win', 'ps4']))).toBe('PS4, WIN')
  })

  it('counts three or more as “n of total”, the total being the facet’s options', () => {
    expect(facetSummary(OPTIONS, new Set(['x360', 'win', 'ps4']))).toBe('3 of 6')
    expect(facetSummary(OPTIONS, new Set(['xone', 'x360', 'win', 'ps4', 'and']))).toBe('5 of 6')
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

  it('fills the button and lists every pick in full in its hint once anything is picked', async () => {
    renderDropdown(new Set(['xone', 'x360', 'win', 'ps4', 'and']))
    expect(summaryButton().textContent).toBe('5 of 6')
    expect(summaryButton().getAttribute('data-on')).toBe('true')
    expect(await hoverTooltip(summaryButton())).toBe(
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

describe('FacetDropdown’s names (H-023)', () => {
  it('spells out every pick in its accessible name, though the button only counts them', () => {
    renderDropdown(new Set(['xone', 'x360', 'win', 'ps4', 'and']))

    expect(summaryButton().getAttribute('aria-label')).toBe('Platform: AND, PS4, WIN, X360, XONE')
  })

  it('names All when nothing is picked, and offers the choice as its hint', async () => {
    renderDropdown()

    expect(summaryButton().getAttribute('aria-label')).toBe('Platform: All')
    expect(await hoverTooltip(summaryButton())).toBe(en.quantum.list.filter.facetPickTip)
  })
})

describe('FacetDropdown’s width (H-023)', () => {
  const css = readFileSync(join(import.meta.dirname, 'FacetToggle.css'), 'utf8')

  it('is as wide as its label, up to 180px, and never narrower than its chevron', () => {
    expect(css).toMatch(/\.q-facet \.q-facet-summary\s*\{[^}]*max-width:\s*180px/)
    expect(css).toMatch(/\.q-facet-summary-text\s*\{[^}]*text-overflow:\s*ellipsis/)
    expect(css).toMatch(/\.q-facet-summary svg\s*\{[^}]*flex:\s*none/)
  })

  it('puts the words in a box of their own, so the ellipsis comes before the chevron', () => {
    renderDropdown(new Set(['ps4']))

    expect(summaryButton().querySelector('.q-facet-summary-text')!.textContent).toBe('PS4')
    expect(summaryButton().querySelector('svg')).not.toBeNull()
  })
})
