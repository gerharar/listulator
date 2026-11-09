// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { setActiveLanguage } from '../../../locale/index.js'
import { NarrowWindowBanner, NarrowWindowPopover } from './NarrowWindowNotice.js'

afterEach(() => {
  cleanup()
  setActiveLanguage('en')
})

/**
 * The warning that eX-Zed needs a wider window (Phase 49.12): a banner when the app starts in one, a popover on the THEME chip when the person switches in one.
 * It says what to do, never blocks, and offers by where the app runs: the button that maximises ("Embiggen", the owner’s label) on the desktop where the screen can hold
 * the window; the line alone where it cannot; the line that asks to widen the window in a browser. Keep Quantum and Dismiss are always there.
 */
const SCREEN = "Your screen isn't big enough to show eX-Zed in all its glory. Stick to Quantum, it fits better."

function banner(mode: 'embiggen' | 'screen' | 'browser') {
  const handlers = { onEmbiggen: vi.fn(), onKeep: vi.fn(), onDismiss: vi.fn() }
  const view = render(<NarrowWindowBanner mode={mode} min={1128} {...handlers} />)

  return { ...view, ...handlers }
}

describe('NarrowWindowBanner', () => {
  it('on the desktop with room: the line, Embiggen, Keep Quantum and Dismiss, each doing its own thing', () => {
    const { onEmbiggen, onKeep, onDismiss } = banner('embiggen')

    expect(screen.getByText('eX-Zed needs a window at least 1128px wide.')).not.toBeNull()
    act(() => screen.getByRole('button', { name: 'Embiggen' }).click())
    act(() => screen.getByRole('button', { name: 'Keep Quantum' }).click())
    act(() => screen.getByRole('button', { name: 'Dismiss' }).click())

    expect([onEmbiggen.mock.calls.length, onKeep.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 1, 1])
  })

  it('on a screen too narrow: the owner’s sentence, Keep Quantum and Dismiss, and no Embiggen', () => {
    banner('screen')

    expect(screen.getByText(SCREEN)).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Embiggen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Keep Quantum' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Dismiss' })).not.toBeNull()
  })

  it('in a browser: the line that asks to widen the window, with no Embiggen', () => {
    banner('browser')

    expect(screen.getByText('Make the browser window at least 1128px wide, or switch back to Quantum.')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Embiggen' })).toBeNull()
  })

  it('is a status line, not a dialog: it never takes the keyboard or blocks anything', () => {
    banner('embiggen')

    expect(screen.getByRole('status')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reads in Russian and German, with Embiggen as it is and no « »', () => {
    setActiveLanguage('ru')
    banner('screen')
    expect(screen.getByRole('button', { name: 'Оставить Quantum' })).not.toBeNull()
    expect(document.body.textContent).not.toMatch(/[«»]/)
    cleanup()

    setActiveLanguage('de')
    banner('embiggen')
    expect(screen.getByRole('button', { name: 'Embiggen' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Quantum behalten' })).not.toBeNull()
  })
})

describe('NarrowWindowPopover', () => {
  function popover(mode: 'embiggen' | 'screen' | 'browser', open = true) {
    const anchor = document.createElement('button')
    document.body.append(anchor)
    const handlers = { onEmbiggen: vi.fn(), onKeep: vi.fn(), onDismiss: vi.fn() }
    render(
      <OverlayManagerProvider>
        <NarrowWindowPopover open={open} anchorEl={anchor} mode={mode} min={1128} {...handlers} />
      </OverlayManagerProvider>,
    )

    return handlers
  }

  it('says the same thing in the popover that opens on the chip, with the same buttons', () => {
    const { onEmbiggen, onKeep, onDismiss } = popover('embiggen')
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByText('eX-Zed needs a window at least 1128px wide.')).not.toBeNull()
    act(() => within(dialog).getByRole('button', { name: 'Embiggen' }).click())
    act(() => within(dialog).getByRole('button', { name: 'Keep Quantum' }).click())
    act(() => within(dialog).getByRole('button', { name: 'Dismiss' }).click())
    expect([onEmbiggen.mock.calls.length, onKeep.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 1, 1])
  })

  it('on a screen too narrow, has no Embiggen either', () => {
    popover('screen')

    expect(within(screen.getByRole('dialog')).getByText(SCREEN)).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Embiggen' })).toBeNull()
  })

  it('draws nothing while closed', () => {
    popover('browser', false)

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
