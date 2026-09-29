// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { PreferencesStore } from '../../lib/preferences/store.js'
import { SKINS } from '../../lib/preferences/skin.js'
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
        <MotionProvider initialReducedSetting={options.reducedSetting} store={store}>
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

    for (const label of ['Destiny', 'Jupiter', 'Deluge', 'Romans', 'Jouhou']) {
      expect(screen.getByRole('button', { name: label })).not.toBeNull()
    }
    expect(pressed('Jouhou')).toBe('true')
    expect(pressed('Deluge')).toBe('false')
  })

  it('marks each skin with its own hexagon, the same mark as the header skin menu', () => {
    const { container } = renderSettings()

    const hexes = [...container.querySelectorAll('.q-chip.skin .q-hex')]
    expect(hexes.map((hex) => hex.getAttribute('data-theme'))).toEqual([...SKINS])
    expect(hexes.every((hex) => hex.classList.contains('sm'))).toBe(true)
    expect(container.querySelector('.q-swatch-sq')).toBeNull()
  })

  it('picking a skin applies it and announces it in the live region', async () => {
    const { onSkinChange, container } = renderSettings()

    act(() => screen.getByRole('button', { name: 'Romans' }).click())

    expect(onSkinChange).toHaveBeenCalledExactlyOnceWith('dark-violet')
    await waitFor(() => {
      expect(container.querySelector('.q-live')?.textContent).toBe('Switched to the Romans skin.')
    })
  })

  it('offers no choice of motion style, only Reduce motion (Fast push removed, F14)', () => {
    renderSettings()

    expect(screen.queryByRole('button', { name: /Drum carousel|Fast push/ })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /Reduce animation motion/ })).toBeTruthy()
  })

  it('the reduce-motion box starts ticked when the system asks for less, and unticking persists a no', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    renderSettings()
    const box = screen.getByRole('checkbox', { name: /Reduce animation motion/ }) as HTMLInputElement
    expect(box.checked).toBe(true)

    act(() => box.click())

    expect(box.checked).toBe(false)
    expect(store.data.get('reducedMotion')).toBe('false')
  })

  it('ticking the reduce-motion box persists a yes', () => {
    renderSettings()
    const box = screen.getByRole('checkbox', { name: /Reduce animation motion/ }) as HTMLInputElement
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
        <MotionProvider initialReducedSetting={undefined} store={store}>
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
