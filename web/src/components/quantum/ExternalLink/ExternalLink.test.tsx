// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ExternalLink } from './ExternalLink.js'

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => {}) }))

afterEach(() => {
  cleanup()
  vi.mocked(openUrl).mockClear()
  delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
})

describe('ExternalLink', () => {
  it('in a browser, is a plain link that opens a new tab and hands the page nothing', () => {
    render(<ExternalLink href="https://musicbrainz.org/">musicbrainz.org</ExternalLink>)
    const link = screen.getByRole('link', { name: /musicbrainz\.org/ })

    expect(link.getAttribute('href')).toBe('https://musicbrainz.org/')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('in the desktop app, opens the system browser and never navigates the app window', () => {
    ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {}
    render(<ExternalLink href="https://www.themoviedb.org/">themoviedb.org</ExternalLink>)
    const link = screen.getByRole('link', { name: /themoviedb\.org/ })

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(openUrl).toHaveBeenCalledExactlyOnceWith('https://www.themoviedb.org/')
  })

  it('passes its own click handler the event, so a row around it can ignore the click', () => {
    const onClick = vi.fn()
    render(
      <ExternalLink href="https://openlibrary.org/" onClick={onClick}>
        openlibrary.org
      </ExternalLink>,
    )

    fireEvent.click(screen.getByRole('link'))

    expect(onClick).toHaveBeenCalledOnce()
  })
})
