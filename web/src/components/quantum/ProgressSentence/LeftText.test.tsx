// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ThemeContext } from '../DocumentTheme/ThemeContext.js'
import { LeftText } from './LeftText.js'

afterEach(cleanup)

const draw = (theme: 'quantum' | 'exzed', text: string) =>
  render(
    <ThemeContext.Provider value={theme}>
      <span>
        <LeftText text={text} />
      </span>
    </ThemeContext.Provider>,
  ).container.firstElementChild!

describe('the time-left text (design’s answer D19: under eX-Zed the tick of "all done" is the done icon)', () => {
  it('is the text as it is under Quantum, tick and all', () => {
    const view = draw('quantum', '✓ All Done')
    expect(view.textContent).toBe('✓ All Done')
    expect(view.querySelector('.q-done-icon')).toBeNull()
  })

  it('puts the done icon in the tick’s place under eX-Zed and leaves the words without it, in every language’s spelling', () => {
    for (const [text, words] of [['✓ All Done', 'All Done'], ['✓ Alles erledigt', 'Alles erledigt'], ['✓ Завершён', 'Завершён']] as const) {
      const view = draw('exzed', text)
      expect(view.querySelector('.q-done-icon'), text).not.toBeNull()
      expect(view.querySelector('.q-done-icon')!.getAttribute('aria-hidden')).toBe('true')
      expect(view.textContent, text).toBe(words)
    }
  })

  it('leaves a time left, and "done for now", alone under eX-Zed', () => {
    for (const text of ['14h 43m left', 'Done for now']) {
      const view = draw('exzed', text)
      expect(view.textContent).toBe(text)
      expect(view.querySelector('.q-done-icon')).toBeNull()
    }
  })
})
