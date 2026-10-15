// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useStableCallback } from './useStableCallback.js'

afterEach(cleanup)

describe('useStableCallback', () => {
  it('keeps its identity across renders and calls the latest function', () => {
    const seen: Array<(n: number) => number> = []
    function Probe({ factor }: { factor: number }) {
      seen.push(useStableCallback((n: number) => n * factor))
      return null
    }
    const view = render(<Probe factor={2} />)
    view.rerender(<Probe factor={10} />)

    expect(seen[0]).toBe(seen[1])
    expect(seen[0]!(3)).toBe(30)
  })
})
