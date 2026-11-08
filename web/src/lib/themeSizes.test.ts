// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { tokenNumber, tokenPx } from './themeSizes.js'

const html = document.documentElement

afterEach(() => {
  html.style.removeProperty('--row-h')
  html.style.removeProperty('--odd')
  html.style.removeProperty('--scale')
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

describe('tokenNumber', () => {
  it('is the fallback when the token is not set', () => {
    expect(tokenNumber('--scale', 0.959)).toBe(0.959)
  })

  it('reads a plain number set on <html>: whole, fractional, or with no leading zero', () => {
    html.style.setProperty('--scale', '1')
    expect(tokenNumber('--scale', 0.959)).toBe(1)

    html.style.setProperty('--scale', '0.921')
    expect(tokenNumber('--scale', 1)).toBe(0.921)

    html.style.setProperty('--scale', '.5')
    expect(tokenNumber('--scale', 1)).toBe(0.5)
  })

  it.each(['32px', 'auto', 'calc(1 + 1)', '', '50%'])('is the fallback for %j, which is not a plain number', (value) => {
    html.style.setProperty('--scale', value)

    expect(tokenNumber('--scale', 7)).toBe(7)
  })
})
