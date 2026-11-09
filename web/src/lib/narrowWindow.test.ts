// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { narrowMode, narrowWindowMin } from './narrowWindow.js'

/**
 * eX-Zed needs a window as wide as its layer’s minimum plus the two gaps the stage keeps (Phase 49.12: 1080 + 2 x 24 = 1128px), read from the theme’s own tokens so the
 * number cannot drift from what the layers do. What the warning offers depends on where the app runs and what the screen can hold (design’s answers 7 and 8,
 * the owner’s decision on the button, 2026-11-08): on the desktop with a screen that holds the minimum, the button that maximises; on a screen that does not, the
 * line alone; in a browser, the line that asks the person to widen it.
 */
const html = document.documentElement

afterEach(() => {
  html.style.removeProperty('--layer-min')
  html.style.removeProperty('--stage-gap-min')
})

describe('narrowWindowMin', () => {
  it('is the layer’s minimum plus the two gaps the stage keeps: 1128px for eX-Zed', () => {
    html.style.setProperty('--layer-min', '1080px')
    html.style.setProperty('--stage-gap-min', '24px')

    expect(narrowWindowMin()).toBe(1128)
  })

  it('follows the tokens, so a theme that changes them changes the warning with it', () => {
    html.style.setProperty('--layer-min', '1000px')
    html.style.setProperty('--stage-gap-min', '30px')

    expect(narrowWindowMin()).toBe(1060)
  })
})

describe('narrowMode', () => {
  const min = 1128

  it('on the desktop, with a screen that can hold the minimum: the button that maximises', () => {
    expect(narrowMode({ desktop: true, screenWidth: 1440, min, embiggened: false })).toBe('embiggen')
    expect(narrowMode({ desktop: true, screenWidth: 1128, min, embiggened: false })).toBe('embiggen')
  })

  it('on the desktop, with a screen narrower than the minimum: the line alone, there is nothing to maximise to', () => {
    expect(narrowMode({ desktop: true, screenWidth: 1127, min, embiggened: false })).toBe('screen')
    expect(narrowMode({ desktop: true, screenWidth: 1093, min, embiggened: false })).toBe('screen')
  })

  it('on the desktop, after the button was pressed and the window is still narrow: the line alone, it will not offer what did not work', () => {
    expect(narrowMode({ desktop: true, screenWidth: 1440, min, embiggened: true })).toBe('screen')
  })

  it('in a browser or an installed web app: the line that asks to widen the window, whatever the screen', () => {
    expect(narrowMode({ desktop: false, screenWidth: 1920, min, embiggened: false })).toBe('browser')
    expect(narrowMode({ desktop: false, screenWidth: 800, min, embiggened: false })).toBe('browser')
  })
})
