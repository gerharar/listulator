// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { keepIsolationFrameAwake } from './isolationFrame.js'

afterEach(() => {
  document.body.replaceChildren()
})

/** What Tauri's own script adds at DOMContentLoaded: a sandboxed frame, hidden by `display: none !important`. */
function tauriFrame(): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.id = '__tauri_isolation__'
  frame.setAttribute('sandbox', 'allow-scripts')

  return frame
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('keepIsolationFrameAwake (1.0.1: the isolation frame is not left `display: none`)', () => {
  it('gives the frame the sizes and flags that keep its timers running, without a keyboard stop', async () => {
    keepIsolationFrameAwake()
    const frame = tauriFrame()
    document.body.append(frame)
    await settle()

    // Inline `!important` is what beats Tauri's `display: none !important` rule.
    expect(frame.style.getPropertyValue('display')).toBe('block')
    expect(frame.style.getPropertyPriority('display')).toBe('important')
    expect(frame.style.getPropertyValue('position')).toBe('absolute')
    expect(frame.style.getPropertyValue('width')).toBe('0px')
    expect(frame.style.getPropertyValue('height')).toBe('0px')
    expect(frame.style.getPropertyValue('border-width')).toBe('0px')
    expect(frame.getAttribute('aria-hidden')).toBe('true')
    expect(frame.getAttribute('tabindex')).toBe('-1')
    expect(frame.hasAttribute('inert')).toBe(true)
  })

  it('finds a frame that is already there', () => {
    const frame = tauriFrame()
    document.body.append(frame)

    keepIsolationFrameAwake()

    expect(frame.style.getPropertyValue('display')).toBe('block')
  })

  it('leaves the sandbox as Tauri set it', async () => {
    keepIsolationFrameAwake()
    const frame = tauriFrame()
    document.body.append(frame)
    await settle()

    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('touches no other frame', async () => {
    keepIsolationFrameAwake()
    const other = document.createElement('iframe')
    other.id = 'something-else'
    document.body.append(other, tauriFrame())
    await settle()

    expect(other.getAttribute('style')).toBeNull()
    expect(other.hasAttribute('inert')).toBe(false)
  })

  it('does nothing, and keeps nothing watching, once it has found the frame', async () => {
    keepIsolationFrameAwake()
    const frame = tauriFrame()
    document.body.append(frame)
    await settle()
    frame.style.setProperty('display', 'none')
    document.body.append(document.createElement('div'))
    await settle()

    expect(frame.style.getPropertyValue('display')).toBe('none')
  })
})
