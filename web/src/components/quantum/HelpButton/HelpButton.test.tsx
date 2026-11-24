// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OverlayManagerProvider, useEscLadder } from '../overlay/OverlayManagerContext.js'
import { ThemeContext } from '../DocumentTheme/ThemeContext.js'
import { hoverTooltip } from '../Tooltip/hoverTooltip.js'
import { HelpButton } from './HelpButton.js'

afterEach(cleanup)

const LABEL = 'Enhance group arrows'
const TEXT = 'Adds a visual aid beside each group’s arrow'

/** The app installs the Esc ladder once, at its root. */
function EscLadder() {
  useEscLadder(() => undefined)
  return null
}

function renderButton(theme: 'quantum' | 'exzed' = 'quantum') {
  return render(
    <ThemeContext.Provider value={theme}>
      <OverlayManagerProvider>
        <EscLadder />
        <input type="checkbox" aria-label="before" />
        <HelpButton label={LABEL} text={TEXT} />
      </OverlayManagerProvider>
    </ThemeContext.Provider>,
  )
}

const help = () => screen.getByRole('button', { name: `About ${LABEL}` })

/** H-031: a (?) explains the app, opens on click and never on hover; its name is "About <label>". */
describe('HelpButton', () => {
  it('is a button named About <label> that has a popup and is shut', () => {
    renderButton()

    expect(help().getAttribute('aria-haspopup')).toBe('dialog')
    expect(help().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(TEXT)).toBeNull()
  })

  it('draws circle-help, 14px, and no native title', () => {
    renderButton()

    const icon = help().querySelector('svg')!
    expect(icon.getAttribute('class')).toMatch(/lucide-circle-(help|question-mark)/)
    expect(icon.getAttribute('width')).toBe('14')
    expect(help().hasAttribute('title')).toBe(false)
  })

  it('under eX-Zed draws design’s pixel help icon (57.10, rule 6) and no line icon, with the same name, popup and no native title', () => {
    renderButton('exzed')

    expect(help().querySelector('svg.lucide')).toBeNull()
    expect(help().querySelectorAll('svg')).toHaveLength(1)
    expect(help().querySelector('svg')!.getAttribute('data-pixel-icon')).toBe('help')
    expect(help().getAttribute('aria-haspopup')).toBe('dialog')
    expect(help().hasAttribute('title')).toBe(false)
  })

  it('opens a 480px popover under eX-Zed (D63: the Popover card) and a 300px one under Quantum, which keeps its own', () => {
    renderButton('exzed')
    act(() => help().click())
    expect(screen.getByRole('dialog').className).toContain('w480')
    cleanup()

    renderButton('quantum')
    act(() => help().click())
    expect(screen.getByRole('dialog').className).toContain('w300')
  })

  it('under eX-Zed it opens, closes and takes focus back exactly as it does under Quantum', () => {
    renderButton('exzed')
    act(() => help().click())
    expect(screen.getByRole('dialog').textContent).toContain(TEXT)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(help())
  })

  it('a click opens the popover with the label, then the explanation', () => {
    renderButton()

    act(() => help().click())

    const dialog = screen.getByRole('dialog')
    expect(help().getAttribute('aria-expanded')).toBe('true')
    expect(dialog.querySelector('strong')?.textContent).toBe(LABEL)
    expect(dialog.textContent).toContain(TEXT)
    expect(dialog.className).toContain('w300')
  })

  it('Esc closes it and focus goes back to the (?)', () => {
    renderButton()
    act(() => help().click())

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(help().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(help())
  })

  it('a click outside closes it and focus goes back to the (?)', () => {
    renderButton()
    act(() => help().click())

    act(() => (document.querySelector('.q-catcher') as HTMLElement).click())

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(help())
  })

  it('the (?) again closes it, and focus stays on the (?)', () => {
    renderButton()
    act(() => help().click())

    act(() => help().click())

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(help())
  })

  it('hover shows only its name and opens nothing', async () => {
    renderButton()

    expect(await hoverTooltip(help())).toBe(`About ${LABEL}`)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(help().getAttribute('aria-expanded')).toBe('false')
  })
})
