// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ThemeContext } from '../DocumentTheme/ThemeContext.js'
import { HeaderPlate } from '../HeaderPlate/HeaderPlate.js'
import { SLOTS, ThemeBackdrop } from './ThemeBackdrop.js'
import type { Theme } from '../../../lib/preferences/theme.js'

afterEach(cleanup)

const inTheme = (theme: Theme, node: React.ReactNode) => render(<ThemeContext.Provider value={theme}>{node}</ThemeContext.Provider>)

describe('ThemeBackdrop', () => {
  it('is Quantum’s Atmosphere with no theme around it, and nothing else', () => {
    const { container } = render(<ThemeBackdrop />)

    expect(container.querySelector('.q-atmo')).not.toBeNull()
    expect(container.querySelector('.q-backdrop')).toBeNull()
    expect(container.children).toHaveLength(1)
  })

  it('is Quantum’s Atmosphere, unchanged, in Quantum', () => {
    const { container } = inTheme('quantum', <ThemeBackdrop />)

    expect([...container.querySelector('.q-atmo')!.children].map((el) => el.className)).toEqual(['wash', 'fine', 'coarse', 'hatch', 'ring1', 'ring2', 'ruler'])
  })

  it('is five named, empty slots in eX-Zed, and no Atmosphere', () => {
    const { container } = inTheme('exzed', <ThemeBackdrop />)

    expect(container.querySelector('.q-atmo')).toBeNull()
    const slots = [...container.querySelectorAll('.q-backdrop > [data-slot]')]
    expect(slots.map((el) => el.getAttribute('data-slot'))).toEqual(['window', 'header', 'bottom', 'sides', 'scene'])
    expect(SLOTS).toEqual(['window', 'header', 'bottom', 'sides', 'scene'])
    for (const slot of slots) expect(slot.childNodes, slot.getAttribute('data-slot') ?? '').toHaveLength(0)
  })

  it('is decoration: hidden from assistive tech', () => {
    const { container } = inTheme('exzed', <ThemeBackdrop />)

    expect(container.querySelector('.q-backdrop')!.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('HeaderPlate under a theme', () => {
  it('is drawn in Quantum and with no theme around it', () => {
    expect(render(<HeaderPlate side="left" seed={1} />).container.querySelector('.q-plate')).not.toBeNull()
    cleanup()
    expect(inTheme('quantum', <HeaderPlate side="left" seed={1} wash />).container.querySelector('.q-plate.q-wash')).not.toBeNull()
  })

  it('is not rendered in eX-Zed, wash or not', () => {
    const { container } = inTheme(
      'exzed',
      <>
        <HeaderPlate side="left" seed={1} />
        <HeaderPlate side="right" seed={2} marks />
        <HeaderPlate side="left" seed={3} wash />
      </>,
    )

    expect(container.innerHTML).toBe('')
  })
})
