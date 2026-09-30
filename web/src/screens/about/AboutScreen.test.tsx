// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { useEffect } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { setActiveLanguage } from '../../locale/index.js'
import { LayerStackProvider, useLayerStack } from '../../components/quantum/layerStack/LayerStackContext.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { AboutScreen } from './AboutScreen.js'

afterEach(() => {
  cleanup()
  setActiveLanguage('en')
})

/** About on top of a Home layer, and a way to read the stack's depth. */
function renderAbout() {
  const depth = { current: 0 }

  function Harness() {
    const stack = useLayerStack()
    depth.current = stack.stack.length
    useEffect(() => {
      stack.push({ id: 'about', kind: 'about', tabLabel: () => 'About', content: '' })
    }, [])
    return <AboutScreen />
  }

  render(
    <OverlayManagerProvider>
      <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'Home', content: '/' }}>
        <Harness />
      </LayerStackProvider>
    </OverlayManagerProvider>,
  )
  return depth
}

describe('AboutScreen', () => {
  it('is headed About, and Close takes the layer off the stack', () => {
    const depth = renderAbout()
    expect(screen.getByRole('heading', { level: 1, name: 'About' })).toBeTruthy()
    const before = depth.current

    act(() => screen.getByRole('button', { name: 'Close' }).click())

    expect(depth.current).toBe(before - 1)
  })

  it('follows the app language', () => {
    setActiveLanguage('de')
    renderAbout()

    expect(screen.getByRole('heading', { level: 1, name: 'Über Listulator' })).toBeTruthy()
  })
})
