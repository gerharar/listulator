// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useFullscreenKey, useWindowFullscreen, type WindowFullscreen } from './windowFullscreen.js'

afterEach(cleanup)

/** A window that starts windowed, records what it was told, and lets a test say "it changed" (as a resize would). */
function fakeWindow(initially = false) {
  let state = initially
  let listener: ((fullscreen: boolean) => void) | undefined
  const unlisten = vi.fn()
  const control: WindowFullscreen = {
    isFullscreen: vi.fn(async () => state),
    setFullscreen: vi.fn(async (on: boolean) => {
      state = on
      listener?.(on)
    }),
    onChange: vi.fn(async (callback: (fullscreen: boolean) => void) => {
      listener = callback
      return unlisten
    }),
  }
  const changeOutside = (on: boolean) => {
    state = on
    act(() => listener?.(on))
  }
  return { control, unlisten, changeOutside }
}

function Probe({ control }: { control: WindowFullscreen | undefined }) {
  const { available, fullscreen, setFullscreen } = useWindowFullscreen(control)
  return (
    <div>
      <span data-testid="available">{String(available)}</span>
      <span data-testid="state">{String(fullscreen)}</span>
      <button onClick={() => setFullscreen(!fullscreen)}>toggle</button>
    </div>
  )
}

describe('useWindowFullscreen (17.7)', () => {
  it('is not available outside the desktop app', () => {
    render(<Probe control={undefined} />)

    expect(screen.getByTestId('available').textContent).toBe('false')
  })

  it('reads the window as it is when it mounts: a launch restored into full screen shows ticked', async () => {
    const { control } = fakeWindow(true)
    render(<Probe control={control} />)

    expect(await screen.findByText('true', { selector: '[data-testid=state]' })).not.toBeNull()
  })

  it('sets the window, and shows what the window then is', async () => {
    const { control } = fakeWindow(false)
    render(<Probe control={control} />)

    fireEvent.click(screen.getByText('toggle'))

    expect(control.setFullscreen).toHaveBeenCalledWith(true)
    expect(await screen.findByText('true', { selector: '[data-testid=state]' })).not.toBeNull()
  })

  it('follows a change made any other way (F11, the Mac’s green button)', async () => {
    const { control, changeOutside } = fakeWindow(false)
    render(<Probe control={control} />)
    await screen.findByText('false', { selector: '[data-testid=state]' })

    changeOutside(true)
    expect(screen.getByTestId('state').textContent).toBe('true')

    changeOutside(false)
    expect(screen.getByTestId('state').textContent).toBe('false')
  })

  it('stops listening when it goes away', async () => {
    const { control, unlisten } = fakeWindow(false)
    const view = render(<Probe control={control} />)
    await vi.waitFor(() => expect(control.onChange).toHaveBeenCalled())

    view.unmount()

    await vi.waitFor(() => expect(unlisten).toHaveBeenCalled())
  })
})

function KeyProbe({ control }: { control: WindowFullscreen | undefined }) {
  useFullscreenKey(control)
  return null
}

describe('useFullscreenKey (17.7)', () => {
  it('F11 enters full screen, and F11 again leaves it', async () => {
    const { control } = fakeWindow(false)
    render(<KeyProbe control={control} />)

    fireEvent.keyDown(document, { key: 'F11' })
    await vi.waitFor(() => expect(control.setFullscreen).toHaveBeenLastCalledWith(true))

    fireEvent.keyDown(document, { key: 'F11' })
    await vi.waitFor(() => expect(control.setFullscreen).toHaveBeenLastCalledWith(false))
  })

  it('keeps F11 from the webview, and ignores it with a modifier or other keys (Esc included)', async () => {
    const { control } = fakeWindow(false)
    render(<KeyProbe control={control} />)

    const plain = new KeyboardEvent('keydown', { key: 'F11', cancelable: true, bubbles: true })
    document.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(control.setFullscreen).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(document, { key: 'F11', ctrlKey: true })
    fireEvent.keyDown(document, { key: 'Escape' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(control.setFullscreen).toHaveBeenCalledTimes(1)
  })

  it('does nothing outside the desktop app', () => {
    render(<KeyProbe control={undefined} />)

    const event = new KeyboardEvent('keydown', { key: 'F11', cancelable: true, bubbles: true })
    document.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })
})
