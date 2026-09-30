// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { FacetConvention } from '../../../../../server/src/catalog/facets.js'
import { PreviewRow } from './PreviewRow.js'
import { hoverTooltip } from '../Tooltip/hoverTooltip.js'

afterEach(cleanup)

/** Music's Type as the registry defines it: Mini covers EP and Single, Comp is Compilation's short name, Live is a flag. */
const MUSIC: FacetConvention = [
  {
    key: 'type',
    label: 'Type',
    prevails: 'Compilation',
    values: [
      'Album',
      { tag: 'Mini', label: 'Mini', aliases: ['EP', 'Single'] },
      { tag: 'Compilation', label: 'Compilation', short: 'Comp', aliases: ['Comp'] },
    ],
  },
  { key: 'extra', label: 'Recording', flag: true, values: ['Live'] },
]
const GAMES: FacetConvention = [{ key: 'platform', label: 'Platform' }]

function row(tags: string[] | undefined, props: { facets?: FacetConvention; platformWidthCh?: number } = {}) {
  render(<PreviewRow item={{ title: 'Some Title', tags }} grouped={false} defaultMinutes={60} {...props} />)
}

describe('PreviewRow tag column: the same chip the created list shows', () => {
  it('shows Music’s Mini for an EP or a Single, never the raw tag', () => {
    row(['EP'], { facets: MUSIC })

    expect(screen.getByText('Mini')).toBeTruthy()
    expect(screen.queryByText('EP')).toBeNull()
  })

  it('shows Comp for a compilation, and Live as a mark on the chip, not as the chip', () => {
    row(['Album', 'Compilation'], { facets: MUSIC })
    expect(screen.getByText('Comp')).toBeTruthy()

    cleanup()
    row(['EP', 'Live'], { facets: MUSIC })
    expect(document.querySelector('.q-tag')?.textContent).toContain('Mini')
    expect(document.querySelector('.q-tag-mark')).not.toBeNull()
  })

  it('falls back to the first tag as written when the category has no convention', () => {
    row(['Hardcover'])

    expect(screen.getByText('Hardcover')).toBeTruthy()
  })

  it('shows a platform chip, MULTI for several, read-only: nothing to click, the names on hover', async () => {
    row(['PS3', 'X360', 'PC'], { facets: GAMES, platformWidthCh: 5 })

    const chip = document.querySelector('.q-plat') as HTMLElement
    expect(chip.textContent).toBe('MULTI')
    expect(chip.tagName).not.toBe('BUTTON')
    expect(screen.queryByRole('button')).toBeNull()
    expect(await hoverTooltip(chip)).toMatch(/PlayStation 3.*Xbox 360/)
  })

  it('shows one platform as its own code', () => {
    row(['PS3'], { facets: GAMES, platformWidthCh: 5 })

    expect(document.querySelector('.q-plat')?.textContent).toBe('PS3')
  })

  it('keeps an empty slot for an untagged game, so the titles stay in line', () => {
    row(undefined, { facets: GAMES, platformWidthCh: 5 })

    expect(document.querySelector('.q-plat-gap')).not.toBeNull()
    expect(document.querySelector('.q-plat')).toBeNull()
  })
})
