// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import { MotionProvider } from '../Motion/MotionContext.js'
import type { Theme } from '../../../lib/preferences/theme.js'
import { DocumentTheme } from './DocumentTheme.js'

const html = document.documentElement

afterEach(() => {
  cleanup()
  for (const name of ['data-theme', 'data-reduced']) html.removeAttribute(name)
  html.classList.remove('theme-exzed', 'keep-me')
})

const store: PreferencesStore = { get: async () => undefined, set: async () => {} }

function renderTheme(skin: string, reduced: boolean | undefined, theme?: Theme) {
  return render(
    <MotionProvider initialReducedSetting={reduced} store={store}>
      <DocumentTheme skin={skin} theme={theme}>
        <span>content</span>
      </DocumentTheme>
    </MotionProvider>,
  )
}

describe('DocumentTheme', () => {
  it('puts the skin and the reduced flag on <html>, where the stylesheets look — no motion mode any more', () => {
    renderTheme('dark-blue', true)

    expect(html.getAttribute('data-theme')).toBe('dark-blue')
    expect(html.hasAttribute('data-motion')).toBe(false)
    expect(html.hasAttribute('data-reduced')).toBe(true)
  })

  it('renders its children as they are, with no wrapper element of its own', () => {
    const { container } = renderTheme('dark-blue', false)

    expect(container.innerHTML).toBe('<span>content</span>')
  })

  it('omits data-reduced while motion is on', () => {
    renderTheme('dark-blue', false)

    expect(html.hasAttribute('data-reduced')).toBe(false)
  })

  it('follows a change of skin', () => {
    const { rerender } = renderTheme('dark-blue', false)

    rerender(
      <MotionProvider initialReducedSetting={false} store={store}>
        <DocumentTheme skin="light-bone">
          <span>content</span>
        </DocumentTheme>
      </MotionProvider>,
    )

    expect(html.getAttribute('data-theme')).toBe('light-bone')
  })

  it('leaves <html> clean when it unmounts', () => {
    const { unmount } = renderTheme('dark-blue', true)

    unmount()

    expect(html.hasAttribute('data-theme')).toBe(false)
    expect(html.hasAttribute('data-reduced')).toBe(false)
  })

  describe('the theme class', () => {
    it('puts theme-exzed on <html> for eX-Zed', () => {
      renderTheme('dark-blue', false, 'exzed')

      expect(html.classList.contains('theme-exzed')).toBe(true)
    })

    it.each([['quantum' as Theme], [undefined]])('puts no class on <html> for %s', (theme) => {
      renderTheme('dark-blue', false, theme)

      expect(html.className).toBe('')
    })

    it('follows a change of theme, and leaves the classes it did not put there', () => {
      html.classList.add('keep-me')
      const { rerender } = renderTheme('dark-blue', false, 'exzed')
      const again = (theme: Theme) =>
        rerender(
          <MotionProvider initialReducedSetting={false} store={store}>
            <DocumentTheme skin="dark-blue" theme={theme}>
              <span>content</span>
            </DocumentTheme>
          </MotionProvider>,
        )

      again('quantum')
      expect(html.classList.contains('theme-exzed')).toBe(false)
      expect(html.classList.contains('keep-me')).toBe(true)

      again('exzed')
      expect(html.classList.contains('theme-exzed')).toBe(true)
    })

    it('takes the class off when it unmounts, again leaving the others', () => {
      html.classList.add('keep-me')
      const { unmount } = renderTheme('dark-blue', false, 'exzed')

      unmount()

      expect(html.classList.contains('theme-exzed')).toBe(false)
      expect(html.classList.contains('keep-me')).toBe(true)
    })
  })
})
