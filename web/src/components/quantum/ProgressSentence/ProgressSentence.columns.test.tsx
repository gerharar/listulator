// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { ProgressSentence, type ProgressSentenceSize } from './ProgressSentence.js'

afterEach(cleanup)

function sentence(size: ProgressSentenceSize, done: number, total: number, minutesLeft: number): HTMLElement {
  const { container } = render(
    <OverlayManagerProvider>
      <ProgressSentence done={done} total={total} minutesLeft={minutesLeft} status={null} size={size} />
    </OverlayManagerProvider>,
  )
  return container
}

describe('the columns a group head shares with the others (BL-160)', () => {
  it('puts the count and the time left each in a slot the list screen can size, on a group head', () => {
    const view = sentence('group', 4, 105, 1257)

    expect(view.querySelector('.q-slot.count')?.textContent).toBe('4/105')
    expect(view.querySelector('.q-slot.time')?.textContent).toBe('20h 57m left')
  })

  it('keeps the time slot on a group with no items, so its bar still starts where the others do', () => {
    const view = sentence('group', 0, 0, 0)

    expect(view.querySelector('.q-slot.time')?.textContent).toBe('')
    // The dot before it is kept to hold the gap, hidden so a screen reader does not read a stray dot.
    expect((view.querySelectorAll('.q-sep')[1] as HTMLElement).style.visibility).toBe('hidden')
  })

  it('leaves the list header as it was: no slots', () => {
    expect(sentence('header', 4, 105, 1257).querySelector('.q-slot')).toBeNull()
  })
})
