// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { notifyListsChanged, subscribeListsChanged } from './listsChanged.js'

describe('listsChanged', () => {
  it('tells every subscriber when the set of lists changed', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeListsChanged(a)
    const offB = subscribeListsChanged(b)

    notifyListsChanged()

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    offA()
    offB()
  })

  it('stops telling a subscriber that has unsubscribed', () => {
    const a = vi.fn()
    const off = subscribeListsChanged(a)
    off()

    notifyListsChanged()

    expect(a).not.toHaveBeenCalled()
  })
})
