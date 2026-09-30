import { fireEvent, screen } from '@testing-library/react'

/**
 * Test helper: what the app's tooltip says when a mouse hovers `element`, or `null` if it says nothing.
 * Real timers: it waits out the hover delay (half a second), then moves the pointer away again.
 */
export async function hoverTooltip(element: Element): Promise<string | null> {
  fireEvent.pointerEnter(element, { pointerType: 'mouse' })

  try {
    return (await screen.findByRole('tooltip', undefined, { timeout: 1500 })).textContent
  } catch {
    return null
  } finally {
    fireEvent.pointerLeave(element)
  }
}
