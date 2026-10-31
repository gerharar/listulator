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

describe('the dots between the percentage, the count and the time left (1.0.1, owner: prototype; H-024)', () => {
  it('are not drawn on a My Lists row: the row is the bar, the percentage, the count and the time, nothing between', () => {
    const row = sentence('row')

    expect(row.querySelector('.q-sep')).toBeNull()
    expect(row.textContent).not.toContain('·')
    expect(row.textContent).toContain('3%')
    expect(row.textContent).toContain('4/105')
    expect(row.textContent).not.toContain('(')
    expect(row.textContent).toContain('20h 57m left')
  })

  it.each<ProgressSentenceSize>(['header', 'group'])('are drawn on the %s: bar, %, dot, count, dot, time (H-024)', (size) => {
    const view = sentence(size)

    expect([...view.querySelectorAll('.q-sep')].map((dot) => dot.textContent)).toEqual(['·', '·'])
    expect(view.textContent).toMatch(/^3%\s*·\s*4\/105\s*·\s*20h 57m left$/)
  })
})

describe('the percentage beside the bar (H-024)', () => {
  it.each<ProgressSentenceSize>(['header', 'row', 'group'])('is the floor of done over total, after the bar, at %s size', (size) => {
    const view = sentence(size)
    const pct = view.querySelector('.q-pct')!

    expect(pct.textContent).toBe('3%')
    expect(pct.previousElementSibling?.classList.contains('q-meter')).toBe(true)
    expect(pct.classList.contains('full')).toBe(false)
  })

  it('sets its size per place: 15px in the header, 13px on a row, 12px on a group head', () => {
    expect((sentence('header').querySelector('.q-pct') as HTMLElement).style.fontSize).toBe('15px')
    cleanup()
    expect((sentence('row').querySelector('.q-pct') as HTMLElement).style.fontSize).toBe('13px')
    cleanup()
    expect((sentence('group').querySelector('.q-pct') as HTMLElement).style.fontSize).toBe('12px')
  })

  it('turns gold, with a full gold bar, only when every item is done', () => {
    const { container } = render(
      <OverlayManagerProvider>
        <ProgressSentence done={7} total={7} minutesLeft={0} status={null} size="header" />
      </OverlayManagerProvider>,
    )

    expect(container.querySelector('.q-pct')?.textContent).toBe('100%')
    expect(container.querySelector('.q-pct')?.classList.contains('full')).toBe(true)
    expect(container.querySelector('.q-meter')?.classList.contains('full')).toBe(true)
  })

  it('draws the same 20 cells for a 7-item and a 598-item list', () => {
    const cells = (done: number, total: number) => {
      const { container } = render(
        <OverlayManagerProvider>
          <ProgressSentence done={done} total={total} minutesLeft={60} status={null} size="header" />
        </OverlayManagerProvider>,
      )
      const style = (container.querySelector('.q-meter') as HTMLElement).style
      cleanup()

      return [style.getPropertyValue('--n'), style.getPropertyValue('--f')]
    }

    expect(cells(3, 7)).toEqual(['20', '8'])
    expect(cells(299, 598)).toEqual(['20', '10'])
    expect(cells(1, 598)).toEqual(['20', '1'])
    expect(cells(597, 598)).toEqual(['20', '19'])
    expect(cells(598, 598)).toEqual(['20', '20'])
  })

  it('reads “<1%” for 1 of 598 and “99%” for 597 of 598', () => {
    const text = (done: number) => {
      const { container } = render(
        <OverlayManagerProvider>
          <ProgressSentence done={done} total={598} minutesLeft={60} status={null} size="header" />
        </OverlayManagerProvider>,
      )
      const pct = container.querySelector('.q-pct')!.textContent
      cleanup()

      return pct
    }

    expect(text(1)).toBe('<1%')
    expect(text(597)).toBe('99%')
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
