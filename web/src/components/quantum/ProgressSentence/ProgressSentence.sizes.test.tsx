// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ThemeContext } from '../DocumentTheme/ThemeContext.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { ProgressSentence, type ProgressSentenceSize } from './ProgressSentence.js'

afterEach(cleanup)

function sentence(theme: 'quantum' | 'exzed', size: ProgressSentenceSize, done = 4): HTMLElement {
  const { container } = render(
    <ThemeContext.Provider value={theme}>
      <OverlayManagerProvider>
        <ProgressSentence done={done} total={done === 4 ? 105 : done} minutesLeft={1257} status={null} size={size} />
      </OverlayManagerProvider>
    </ThemeContext.Provider>,
  )
  return container
}

/** The font sizes the sentence's parts are given inline: the count, the time left (or "all done") and the percentage. */
const sizes = (view: HTMLElement) => ({
  count: (view.querySelector('.q-count') as HTMLElement).style.fontSize,
  left: (view.querySelector('.q-left') as HTMLElement).style.fontSize,
  percent: (view.querySelector('.q-pct') as HTMLElement).style.fontSize,
})

describe('the sentence’s type sizes (51.7: the Spectrum font has one body size, 16px)', () => {
  it.each<ProgressSentenceSize>(['header', 'group'])('are Quantum’s own on the %s, as they were', (size) => {
    const seen = sizes(sentence('quantum', size))
    expect(seen.left).not.toBe('16px')
    expect(seen.count).not.toBe('16px')
  })

  it.each<ProgressSentenceSize>(['header', 'group'])('are 16px on the %s under eX-Zed: the count, the time left and the percentage', (size) => {
    expect(sizes(sentence('exzed', size))).toEqual({ count: '16px', left: '16px', percent: '16px' })
  })

  it('is 16px for “all done” too under eX-Zed (Quantum sets it two points smaller)', () => {
    const view = sentence('exzed', 'group', 105)
    expect(view.querySelector('.q-left.all-done')).not.toBeNull()
    expect((view.querySelector('.q-left') as HTMLElement).style.fontSize).toBe('16px')
  })
})
