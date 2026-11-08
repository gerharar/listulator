// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { tokenPx } from './themeSizes.js'

const html = document.documentElement

afterEach(() => {
  html.style.removeProperty('--row-h')
  html.style.removeProperty('--odd')
})

describe('tokenPx', () => {
  it('is the fallback when the token is not set: a page with no theme sheet, as in a unit test', () => {
    expect(tokenPx('--row-h', 46)).toBe(46)
  })

  it('reads a length token set on <html> as pixels, whole or fractional', () => {
    html.style.setProperty('--row-h', '32px')
    expect(tokenPx('--row-h', 46)).toBe(32)

    html.style.setProperty('--row-h', '31.5px')
    expect(tokenPx('--row-h', 46)).toBe(31.5)
  })

  it.each(['auto', 'calc(2 * 16px)', '2rem', '', '50%'])('is the fallback for %j, which is not a plain pixel length', (value) => {
    html.style.setProperty('--odd', value)

    expect(tokenPx('--odd', 7)).toBe(7)
  })
})
