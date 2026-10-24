// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { JumpRail } from './JumpRail.js'

/**
 * The props of a rail outside the card go together: a rail that is outside and folded needs a way to unfold, and a width cap. The
 * checks are for the compiler (`npm run typecheck`): a line marked `@ts-expect-error` that compiles fails it.
 */
const base = { entries: [], onJump: () => {}, onHide: () => {}, width: 200, onResize: () => {}, onResizeEnd: () => {} }

describe('JumpRail props', () => {
  it('takes an inside rail with no outside props, and an outside rail with all of them', () => {
    expect(<JumpRail {...base} />).toBeTruthy()
    expect(<JumpRail {...base} placement="inside" />).toBeTruthy()
    expect(<JumpRail {...base} placement="outside" folded={false} onShow={() => {}} maxWidth={300} />).toBeTruthy()
  })

  it('refuses an outside rail that cannot be unfolded or capped, and outside props on an inside one', () => {
    // @ts-expect-error an outside rail needs onShow, folded and maxWidth
    expect(<JumpRail {...base} placement="outside" />).toBeTruthy()
    // @ts-expect-error a folded outside rail needs onShow
    expect(<JumpRail {...base} placement="outside" folded maxWidth={300} />).toBeTruthy()
    // @ts-expect-error folded means nothing inside the card
    expect(<JumpRail {...base} folded />).toBeTruthy()
  })
})
