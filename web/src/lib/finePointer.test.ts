// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FINE_POINTER_QUERY, finePointer, subscribeFinePointer } from './finePointer.js'

/**
 * Whether the device has a pointer that can hover and aim finely (Phase 49.10, design answer 8): eX-Zed is a desktop theme, so a touch-only device stays
 * Quantum. Read once, and followed live (a mouse plugged into a tablet), with a fake `matchMedia` standing in for the browser’s.
 */
type Listener = (event: { matches: boolean }) => void

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>()
  const asked: string[] = []
  const query = { matches: initial, addEventListener: vi.fn((_: string, listener: Listener) => listeners.add(listener)), removeEventListener: vi.fn((_: string, listener: Listener) => listeners.delete(listener)) }
  vi.stubGlobal('matchMedia', (text: string) => (asked.push(text), query))

  return {
    asked,
    query,
    listeners,
    set(next: boolean) {
      query.matches = next
      for (const listener of [...listeners]) listener({ matches: next })
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('finePointer', () => {
  it('asks for a pointer that can hover and is fine', () => {
    const media = stubMatchMedia(true)

    finePointer()

    expect(media.asked).toEqual([FINE_POINTER_QUERY])
    expect(FINE_POINTER_QUERY).toBe('(hover: hover) and (pointer: fine)')
  })

  it('is what the browser answers: true with a mouse, false on a touch-only device', () => {
    stubMatchMedia(true)
    expect(finePointer()).toBe(true)
    stubMatchMedia(false)
    expect(finePointer()).toBe(false)
  })

  it('is true where the browser cannot say (no matchMedia): the desktop is the default, so nothing is hidden by accident', () => {
    vi.stubGlobal('matchMedia', undefined)

    expect(finePointer()).toBe(true)
  })
})

describe('subscribeFinePointer', () => {
  it('tells the listener the new answer when the device’s pointer changes, both ways', () => {
    const media = stubMatchMedia(true)
    const seen: boolean[] = []
    subscribeFinePointer((fine) => seen.push(fine))

    media.set(false)
    media.set(true)

    expect(seen).toEqual([false, true])
  })

  it('stops listening when unsubscribed', () => {
    const media = stubMatchMedia(true)
    const seen: boolean[] = []
    const stop = subscribeFinePointer((fine) => seen.push(fine))

    stop()
    media.set(false)

    expect(seen).toEqual([])
    expect(media.listeners.size).toBe(0)
  })

  it('does nothing, and returns a function that does nothing, where there is no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)

    expect(() => subscribeFinePointer(() => {})()).not.toThrow()
  })
})
