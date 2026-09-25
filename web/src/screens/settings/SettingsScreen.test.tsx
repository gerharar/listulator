// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { PreferencesStore } from '../../lib/preferences/store.js'
import { setActiveLanguage } from '../../locale/index.js'
import { LanguageProvider } from '../../locale/LanguageProvider.js'
import { LayerStackProvider, useLayerStack } from '../../components/quantum/layerStack/LayerStackContext.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { MotionProvider } from '../../components/quantum/Motion/MotionContext.js'
import { SettingsScreen } from './SettingsScreen.js'

vi.mock('../../lib/config/localConfig.js', () => ({
  getLocalSettings: vi.fn(async () => ({})),
  updateLocalSettings: vi.fn(async () => {}),
}))

function fakeStore(): PreferencesStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
  }
}

let store = fakeStore()

beforeEach(() => {
  store = fakeStore()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
})

afterEach(() => {
  cleanup()
  setActiveLanguage('en')
  vi.unstubAllGlobals()
})

function StackReader() {
  const { stack } = useLayerStack()
  return <span data-testid="stack">{stack.map((layer) => layer.kind).join(',')}</span>
}

function renderSettings(options: { skin?: 'dark-blue' | 'light-bone'; reducedSetting?: boolean } = {}) {
  const onSkinChange = vi.fn()
  const view = render(
    <LiveRegionProvider>
      <OverlayManagerProvider>
        <MotionProvider initialMotion="drum" initialReducedSetting={options.reducedSetting} store={store}>
          <LanguageProvider>
            <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'Home', content: '/' }}>
              <StackReader />
              <SettingsScreen skin={options.skin ?? 'dark-blue'} onSkinChange={onSkinChange} store={store} />
            </LayerStackProvider>
          </LanguageProvider>
        </MotionProvider>
      </OverlayManagerProvider>
    </LiveRegionProvider>,
  )
  return { ...view, onSkinChange }
}

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('SettingsScreen', () => {
  it('shows the Quantum theme as the only one, lit', () => {
    renderSettings()

    expect(pressed('Quantum')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Modernist' })).toBeNull()
  })

  it('lists the five skins and lights the current one', () => {
    renderSettings({ skin: 'light-bone' })

    for (const label of ['Dark orange', 'Dark green', 'Dark blue', 'Dark violet', 'Light bone']) {
      expect(screen.getByRole('button', { name: label })).not.toBeNull()
    }
    expect(pressed('Light bone')).toBe('true')
    expect(pressed('Dark blue')).toBe('false')
  })

  it('picking a skin applies it and announces it in the live region', async () => {
    const { onSkinChange, container } = renderSettings()

    act(() => screen.getByRole('button', { name: 'Dark violet' }).click())

    expect(onSkinChange).toHaveBeenCalledExactlyOnceWith('dark-violet')
    await waitFor(() => {
      expect(container.querySelector('.q-live')?.textContent).toBe('Switched to the Dark violet skin.')
    })
  })

  it('offers the two motions, lit by the current one, and persists a change', async () => {
    renderSettings()
    expect(pressed('Drum carousel — 380ms')).toBe('true')
    expect(pressed('Fast push — 210ms')).toBe('false')

    act(() => screen.getByRole('button', { name: 'Fast push — 210ms' }).click())

    expect(pressed('Fast push — 210ms')).toBe('true')
    expect(pressed('Drum carousel — 380ms')).toBe('false')
    expect(store.data.get('motion')).toBe('push')
  })

  it('the reduce-motion box starts ticked when the system asks for less, and unticking persists a no', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    renderSettings()
    const box = screen.getByRole('checkbox', { name: /Reduce motion/ }) as HTMLInputElement
    expect(box.checked).toBe(true)

    act(() => box.click())

    expect(box.checked).toBe(false)
    expect(store.data.get('reducedMotion')).toBe('false')
  })

  it('ticking the reduce-motion box persists a yes', () => {
    renderSettings()
    const box = screen.getByRole('checkbox', { name: /Reduce motion/ }) as HTMLInputElement
    expect(box.checked).toBe(false)

    act(() => box.click())

    expect(box.checked).toBe(true)
    expect(store.data.get('reducedMotion')).toBe('true')
  })

  it('offers the three languages by their own names, lit on English by default', () => {
    renderSettings()

    expect(pressed('English')).toBe('true')
    expect(screen.getByRole('button', { name: 'Русский' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Deutsch' })).not.toBeNull()
  })

  it('switching to Русский changes Settings’ own copy at once, and persists the language', () => {
    renderSettings()
    expect(screen.getByRole('heading', { name: 'Settings' })).not.toBeNull()

    act(() => screen.getByRole('button', { name: 'Русский' }).click())

    expect(screen.getByRole('heading', { name: 'Настройки' })).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull()
    expect(pressed('Русский')).toBe('true')
    expect(store.data.get('language')).toBe('ru')
  })

  it('switching to Deutsch changes Settings’ own copy too', () => {
    renderSettings()

    act(() => screen.getByRole('button', { name: 'Deutsch' }).click())

    expect(screen.getByRole('heading', { name: 'Einstellungen' })).not.toBeNull()
    expect(store.data.get('language')).toBe('de')
  })

  it('has no API keys section in the browser build', () => {
    renderSettings()

    expect(screen.queryByText('API keys')).toBeNull()
  })

  it('has the API keys section in the desktop app', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    try {
      renderSettings()

      expect(await screen.findByText('API keys')).not.toBeNull()
    } finally {
      delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
    }
  })

  it('Close pops the Settings layer', () => {
    function PushSettings() {
      const { push } = useLayerStack()
      useEffect(() => {
        push({ id: 'settings', kind: 'settings', tabLabel: 'Settings', content: '' })
      }, [push])
      return null
    }
    render(
      <LiveRegionProvider>
        <MotionProvider initialMotion="drum" initialReducedSetting={undefined} store={store}>
          <LanguageProvider>
            <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'Home', content: '/' }}>
              <PushSettings />
              <StackReader />
              <SettingsScreen skin="dark-blue" onSkinChange={vi.fn()} store={store} />
            </LayerStackProvider>
          </LanguageProvider>
        </MotionProvider>
      </LiveRegionProvider>,
    )
    expect(screen.getByTestId('stack').textContent).toBe('home,settings')

    act(() => screen.getByRole('button', { name: 'Close' }).click())

    expect(screen.getByTestId('stack').textContent).toBe('home')
  })
})
