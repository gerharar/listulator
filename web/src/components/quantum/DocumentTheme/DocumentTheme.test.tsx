// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import { MotionProvider } from '../Motion/MotionContext.js'
import { DocumentTheme } from './DocumentTheme.js'

const html = document.documentElement

afterEach(() => {
  cleanup()
  for (const name of ['data-theme', 'data-motion', 'data-reduced']) html.removeAttribute(name)
})

const store: PreferencesStore = { get: async () => undefined, set: async () => {} }

function renderTheme(skin: string, motion: 'drum' | 'push', reduced: boolean | undefined) {
  return render(
    <MotionProvider initialMotion={motion} initialReducedSetting={reduced} store={store}>
      <DocumentTheme skin={skin}>
        <span>content</span>
      </DocumentTheme>
    </MotionProvider>,
  )
}

describe('DocumentTheme', () => {
  it('puts the skin, the motion mode and the reduced flag on <html>, where the stylesheets look', () => {
    renderTheme('dark-blue', 'push', true)

    expect(html.getAttribute('data-theme')).toBe('dark-blue')
    expect(html.getAttribute('data-motion')).toBe('push')
    expect(html.hasAttribute('data-reduced')).toBe(true)
  })

  it('renders its children as they are, with no wrapper element of its own', () => {
    const { container } = renderTheme('dark-blue', 'drum', false)

    expect(container.innerHTML).toBe('<span>content</span>')
  })

  it('omits data-reduced while motion is on', () => {
    renderTheme('dark-blue', 'drum', false)

    expect(html.hasAttribute('data-reduced')).toBe(false)
  })

  it('follows a change of skin', () => {
    const { rerender } = renderTheme('dark-blue', 'drum', false)

    rerender(
      <MotionProvider initialMotion="drum" initialReducedSetting={false} store={store}>
        <DocumentTheme skin="light-bone">
          <span>content</span>
        </DocumentTheme>
      </MotionProvider>,
    )

    expect(html.getAttribute('data-theme')).toBe('light-bone')
  })

  it('leaves <html> clean when it unmounts', () => {
    const { unmount } = renderTheme('dark-blue', 'push', true)

    unmount()

    expect(html.hasAttribute('data-theme')).toBe(false)
    expect(html.hasAttribute('data-reduced')).toBe(false)
  })
})
