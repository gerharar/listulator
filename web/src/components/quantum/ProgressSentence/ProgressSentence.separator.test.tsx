// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { ProgressSentence, type ProgressSentenceSize } from './ProgressSentence.js'

afterEach(cleanup)

function sentence(size: ProgressSentenceSize): HTMLElement {
  const { container } = render(
    <OverlayManagerProvider>
      <ProgressSentence done={4} total={105} minutesLeft={1257} status={null} size={size} />
    </OverlayManagerProvider>,
  )
  return container
}

describe('the dot between the count and the time left (1.0.1, owner: prototype)', () => {
  it('is not drawn on a My Lists row: the prototype row is the count and the time, nothing between', () => {
    const row = sentence('row')

    expect(row.querySelector('.q-sep')).toBeNull()
    expect(row.textContent).not.toContain('·')
    expect(row.textContent).toContain('4/105 (4%)')
    expect(row.textContent).toContain('20h 57m left')
  })

  it.each<ProgressSentenceSize>(['header', 'group'])('is still drawn on the %s, where the prototype has it', (size) => {
    expect(sentence(size).querySelector('.q-sep')?.textContent).toBe('·')
  })
})

describe('the count colour on a My Lists row (1.0.1, owner: prototype)', () => {
  it('reads in the main text colour, like the list header’s, not the muted one', () => {
    // jsdom does not apply stylesheets, so read the rule itself.
    const css = readFileSync(join(import.meta.dirname, '../HomeRow/HomeRow.css'), 'utf8')
    const rule = /\.q-home-row \.q-count\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

    expect(rule).toMatch(/color:\s*var\(--ink\)\s*;/)
  })
})
