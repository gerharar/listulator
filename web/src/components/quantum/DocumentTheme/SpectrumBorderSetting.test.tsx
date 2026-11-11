// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import { SpectrumBorderProvider, useSpectrumBorder } from './SpectrumBorderSetting.js'

const html = document.documentElement

afterEach(() => {
  cleanup()
  html.removeAttribute('data-border')
})

function fakeStore(): PreferencesStore {
  return { get: async () => undefined, set: vi.fn(async () => undefined) }
}

let setting: ReturnType<typeof useSpectrumBorder>
function Reader() {
  setting = useSpectrumBorder()
  return <span data-testid="on">{String(setting.on)}</span>
}

describe('SpectrumBorderProvider (X-006: the stripes beyond 2560px, and Show Spectrum border)', () => {
  it('puts nothing on <html> while the border is on: the stripes are the default', () => {
    render(
      <SpectrumBorderProvider on>
        <Reader />
      </SpectrumBorderProvider>,
    )

    expect(html.hasAttribute('data-border')).toBe(false)
  })

  it('puts data-border="off" on <html> before the first paint when the stored choice is off (a layout effect, so no frame with the stripes)', () => {
    render(
      <SpectrumBorderProvider on={false}>
        <Reader />
      </SpectrumBorderProvider>,
    )

    expect(html.getAttribute('data-border')).toBe('off')
  })

  it('follows the switch at once, both ways, and writes the preference through the store', () => {
    const store = fakeStore()
    render(
      <SpectrumBorderProvider on store={store}>
        <Reader />
      </SpectrumBorderProvider>,
    )

    act(() => setting.setOn(false))
    expect([setting.on, html.getAttribute('data-border')]).toEqual([false, 'off'])
    expect(store.set).toHaveBeenLastCalledWith('spectrumBorder', 'false')

    act(() => setting.setOn(true))
    expect([setting.on, html.hasAttribute('data-border')]).toEqual([true, false])
    expect(store.set).toHaveBeenLastCalledWith('spectrumBorder', 'true')
  })

  it('changes without a store (a test, a screen drawn outside the shell) and writes nothing', () => {
    render(
      <SpectrumBorderProvider on>
        <Reader />
      </SpectrumBorderProvider>,
    )

    act(() => setting.setOn(false))

    expect(html.getAttribute('data-border')).toBe('off')
  })

  it('takes its attribute off <html> when it goes, as the theme’s own attributes are', () => {
    const view = render(
      <SpectrumBorderProvider on={false}>
        <Reader />
      </SpectrumBorderProvider>,
    )

    view.unmount()

    expect(html.hasAttribute('data-border')).toBe(false)
  })

  it('is on, and changes nothing on the page, outside a provider', () => {
    render(<Reader />)

    expect(setting.on).toBe(true)
    act(() => setting.setOn(false))
    expect(html.hasAttribute('data-border')).toBe(false)
  })
})
