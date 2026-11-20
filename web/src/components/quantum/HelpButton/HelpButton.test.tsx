// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OverlayManagerProvider, useEscLadder } from '../overlay/OverlayManagerContext.js'
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

function renderButton() {
  return render(
    <OverlayManagerProvider>
      <EscLadder />
      <input type="checkbox" aria-label="before" />
      <HelpButton label={LABEL} text={TEXT} />
    </OverlayManagerProvider>,
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
