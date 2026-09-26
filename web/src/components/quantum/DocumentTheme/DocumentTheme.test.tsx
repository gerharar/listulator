// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import { MotionProvider } from '../Motion/MotionContext.js'
import { DocumentTheme } from './DocumentTheme.js'

const html = document.documentElement

afterEach(() => {
  cleanup()
  for (const name of ['data-theme', 'data-reduced']) html.removeAttribute(name)
})

const store: PreferencesStore = { get: async () => undefined, set: async () => {} }

function renderTheme(skin: string, reduced: boolean | undefined) {
  return render(
    <MotionProvider initialReducedSetting={reduced} store={store}>
      <DocumentTheme skin={skin}>
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
})
