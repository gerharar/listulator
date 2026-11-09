// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { PreferencesStore } from '../../lib/preferences/store.js'
import { SKINS } from '../../lib/preferences/skin.js'
import { EXZED_SKINS, type ExzedSkin } from '../../lib/preferences/exzedSkins.js'
import type { Theme } from '../../lib/preferences/theme.js'
import { setActiveLanguage } from '../../locale/index.js'
import { hoverTooltip } from '../../components/quantum/Tooltip/hoverTooltip.js'
import { LanguageProvider } from '../../locale/LanguageProvider.js'
import { LayerStackProvider, useLayerStack } from '../../components/quantum/layerStack/LayerStackContext.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { MotionProvider } from '../../components/quantum/Motion/MotionContext.js'
import { GroupLineProvider, GroupTriangle } from '../../components/quantum/GroupTriangle/GroupTriangle.js'
import { TimeLeftProvider } from '../../components/quantum/Home/TimeLeftSetting.js'
import { de } from '../../locale/de.js'
import { en } from '../../locale/en.js'
import { ru } from '../../locale/ru.js'
import { SettingsScreen } from './SettingsScreen.js'

const tauriWindow = vi.hoisted(() => ({
  fullscreen: false,
  setFullscreen: vi.fn(async (on: boolean) => {
    tauriWindow.fullscreen = on
  }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen: async () => tauriWindow.fullscreen,
    setFullscreen: tauriWindow.setFullscreen,
    onResized: async () => () => {},
  }),
}))

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

function renderSettings(
  options: { skin?: 'dark-blue' | 'light-bone'; theme?: Theme; exzedSkin?: ExzedSkin; reducedSetting?: boolean; markOpenGroups?: boolean; showTimeLeft?: boolean } = {},
) {
  const onSkinChange = vi.fn()
  const onThemeChange = vi.fn()
  const onExzedSkinChange = vi.fn()
  const view = render(
    <LiveRegionProvider>
      <OverlayManagerProvider>
        <MotionProvider initialReducedSetting={options.reducedSetting} store={store}>
          <GroupLineProvider on={options.markOpenGroups ?? false} store={store}>
            <TimeLeftProvider on={options.showTimeLeft ?? false} store={store}>
              <LanguageProvider>
                <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'Home', content: '/' }}>
                  <StackReader />
                  {/* A group head's triangle, as a list's would be: it must follow the checkbox at once. */}
                  <div data-testid="a-group-head">
                    <GroupTriangle />
                  </div>
                  <SettingsScreen
                    skin={options.skin ?? 'dark-blue'}
                    onSkinChange={onSkinChange}
                    theme={options.theme ?? 'quantum'}
                    onThemeChange={onThemeChange}
                    exzedSkin={options.exzedSkin ?? 'exzed-1d'}
                    onExzedSkinChange={onExzedSkinChange}
                    store={store}
                  />
                </LayerStackProvider>
              </LanguageProvider>
            </TimeLeftProvider>
          </GroupLineProvider>
        </MotionProvider>
      </OverlayManagerProvider>
    </LiveRegionProvider>,
  )
  return { ...view, onSkinChange, onThemeChange, onExzedSkinChange }
}

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('SettingsScreen', () => {
  it('offers the two themes, Quantum lit while it is the theme and eX-Zed not', () => {
    renderSettings()

    expect(pressed('Quantum')).toBe('true')
    expect(pressed('eX-Zed')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Modernist' })).toBeNull()
  })

  it('lights eX-Zed instead when it is the theme', () => {
    renderSettings({ theme: 'exzed' })

    expect(pressed('eX-Zed')).toBe('true')
    expect(pressed('Quantum')).toBe('false')
  })

  it('picking eX-Zed switches the theme and announces it; picking the theme that is already lit does nothing', async () => {
    const { onThemeChange, container } = renderSettings()

    act(() => screen.getByRole('button', { name: 'Quantum' }).click())
    expect(onThemeChange).not.toHaveBeenCalled()

    act(() => screen.getByRole('button', { name: 'eX-Zed' }).click())

    expect(onThemeChange).toHaveBeenCalledExactlyOnceWith('exzed')
    await waitFor(() => {
      expect(container.querySelector('.q-live')?.textContent).toBe('Switched to the eX-Zed theme')
    })
  })

  it('picking Quantum from eX-Zed switches back and announces it', async () => {
    const { onThemeChange, container } = renderSettings({ theme: 'exzed' })

    act(() => screen.getByRole('button', { name: 'Quantum' }).click())

    expect(onThemeChange).toHaveBeenCalledExactlyOnceWith('quantum')
    await waitFor(() => {
      expect(container.querySelector('.q-live')?.textContent).toBe('Switched to the Quantum theme')
    })
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
      expect(container.querySelector('.q-live')?.textContent).toBe('Switched to the Romans skin')
    })
  })

  it('under Quantum shows no eX-Zed skin: the SKIN row is the five Quantum skins only', () => {
    renderSettings()

    for (const name of ['Lode', 'Focal', 'Glemt', 'Xen', 'Kui', 'Lotus']) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('under eX-Zed lists its six skins by name, without the number, and none of Quantum’s', () => {
    renderSettings({ theme: 'exzed', exzedSkin: 'exzed-1c' })

    for (const name of ['Lode', 'Focal', 'Glemt', 'Xen', 'Kui', 'Lotus']) expect(screen.getByRole('button', { name })).not.toBeNull()
    expect(pressed('Xen')).toBe('true')
    expect(pressed('Lode')).toBe('false')
    for (const name of ['Destiny', 'Jupiter', 'Deluge', 'Romans', 'Jouhou']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(document.querySelectorAll('.q-chip.skin')).toHaveLength(6)
  })

  it('marks each eX-Zed skin with its own half-bucket swatch (the skin’s key, so the page draws that skin, not the active one), and no hexagon', () => {
    const { container } = renderSettings({ theme: 'exzed' })

    const swatches = [...container.querySelectorAll('.q-chip.skin .q-zx-swatch')]
    expect(swatches.map((swatch) => swatch.getAttribute('data-theme'))).toEqual([...EXZED_SKINS])
    expect(container.querySelector('.q-chip.skin .q-hex')).toBeNull()
  })

  it('picking an eX-Zed skin applies it to eX-Zed’s own key and announces it; Quantum’s skin handler is not called', async () => {
    const { onExzedSkinChange, onSkinChange, container } = renderSettings({ theme: 'exzed' })

    act(() => screen.getByRole('button', { name: 'Lotus' }).click())

    expect(onExzedSkinChange).toHaveBeenCalledExactlyOnceWith('exzed-1l')
    expect(onSkinChange).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(container.querySelector('.q-live')?.textContent).toBe('Switched to the Lotus skin')
    })
  })

  it('announces a theme switch in Russian and German, with the theme’s name as it is, and no « »', async () => {
    const russian = renderSettings()
    act(() => screen.getByRole('button', { name: 'Русский' }).click())
    act(() => screen.getByRole('button', { name: 'eX-Zed' }).click())
    await waitFor(() => expect(russian.container.querySelector('.q-live')?.textContent).toBe('Тему заменили: eX-Zed'))
    cleanup()

    const german = renderSettings()
    act(() => screen.getByRole('button', { name: 'Deutsch' }).click())
    act(() => screen.getByRole('button', { name: 'eX-Zed' }).click())
    await waitFor(() => expect(german.container.querySelector('.q-live')?.textContent).toBe('Thema gewechselt: eX-Zed.'))
    expect(ru.quantum.settings.themeChanged('x')).not.toMatch(/[«»]/)
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

  it('names the group Screen, with no Fullscreen box outside the desktop app (17.7)', () => {
    renderSettings()

    expect(screen.getByText('Screen')).not.toBeNull()
    expect(screen.queryByText('Motion')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Fullscreen' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Reduce animation motion' })).not.toBeNull()
  })

  it('in the desktop app, has Fullscreen above Reduce animation motion, showing and setting the window (17.7)', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    tauriWindow.fullscreen = true
    tauriWindow.setFullscreen.mockClear()
    try {
      renderSettings()

      const box = screen.getByRole('checkbox', { name: 'Fullscreen' }) as HTMLInputElement
      const boxes = screen.getAllByRole('checkbox').map((entry) => entry.closest('label')?.textContent)
      expect(boxes.indexOf('Fullscreen')).toBe(boxes.indexOf('Reduce animation motion') - 1)
      // A launch restored into full screen shows ticked.
      await waitFor(() => expect(box.checked).toBe(true))

      act(() => box.click())

      expect(tauriWindow.setFullscreen).toHaveBeenCalledWith(false)
      await waitFor(() => expect(box.checked).toBe(false))
    } finally {
      delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
      tauriWindow.fullscreen = false
    }
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
              <SettingsScreen skin="dark-blue" onSkinChange={vi.fn()} theme="quantum" onThemeChange={vi.fn()} exzedSkin="exzed-1d" onExzedSkinChange={vi.fn()} store={store} />
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

/** H-022 as a setting (canvas, owner 2026-10-28): Settings → Screen, after Fullscreen and Reduce animation motion, on every platform. */
describe('SettingsScreen: Mark open and closed groups (H-022)', () => {
  const label = en.quantum.settings.markOpenGroups
  const box = () => screen.getByRole('checkbox', { name: label }) as HTMLInputElement
  const head = () => screen.getByTestId('a-group-head')

  it('is the box after Reduce animation motion, in a browser too, and unticked by default', () => {
    renderSettings()

    const boxes = screen.getAllByRole('checkbox').map((entry) => entry.closest('label')?.textContent)
    expect(boxes).toEqual([en.quantum.settings.reduceMotion, label, en.quantum.settings.showTimeLeft])
    expect(box().checked).toBe(false)
    expect(head().querySelector('.q-chev svg.q-chev-tri')).not.toBeNull()
    expect(head().querySelector('.q-chev-rule')).toBeNull()
  })

  it('starts ticked when the setting is on, and the group heads draw the line', () => {
    renderSettings({ markOpenGroups: true })

    expect(box().checked).toBe(true)
    expect(head().querySelector('.q-chev-rule')).not.toBeNull()
  })

  it('ticking turns the lines on at once and persists a yes; unticking turns them off and persists a no', async () => {
    renderSettings()

    act(() => box().click())

    expect(box().checked).toBe(true)
    expect(head().querySelector('.q-chev-rule')).not.toBeNull()
    await waitFor(() => expect(store.data.get('markOpenGroups')).toBe('true'))

    act(() => box().click())

    expect(box().checked).toBe(false)
    expect(head().querySelector('.q-chev svg.q-chev-tri')).not.toBeNull()
    expect(head().querySelector('.q-chev-rule')).toBeNull()
    await waitFor(() => expect(store.data.get('markOpenGroups')).toBe('false'))
  })

  it.each([
    ['Русский', ru.quantum.settings.markOpenGroups],
    ['Deutsch', de.quantum.settings.markOpenGroups],
  ])('is named in %s in its own words', (language, translated) => {
    renderSettings()

    act(() => screen.getByRole('button', { name: language }).click())

    expect(translated).not.toBe(label)
    expect(screen.getByRole('checkbox', { name: translated })).toBeTruthy()
  })

  it('says what the line does when the row is hovered (the canvas wording), and the other Screen boxes keep quiet', async () => {
    renderSettings()

    expect(await hoverTooltip(box().closest('label')!)).toBe(en.quantum.settings.markOpenGroupsTip)
    expect(await hoverTooltip(screen.getByRole('checkbox', { name: en.quantum.settings.reduceMotion }).closest('label')!)).toBeNull()
  })

  it('gives a screen reader the same words as the box’s description, and the name stays the label', () => {
    renderSettings()

    expect(box().getAttribute('aria-description')).toBe(en.quantum.settings.markOpenGroupsTip)
    expect(screen.getByRole('checkbox', { name: label })).toBeTruthy()
  })

  it.each([
    ['Русский', ru.quantum.settings.markOpenGroups, ru.quantum.settings.markOpenGroupsTip],
    ['Deutsch', de.quantum.settings.markOpenGroups, de.quantum.settings.markOpenGroupsTip],
  ])('has its tooltip in %s too', async (language, translatedLabel, translatedTip) => {
    renderSettings()
    act(() => screen.getByRole('button', { name: language }).click())

    expect(translatedTip).not.toBe(en.quantum.settings.markOpenGroupsTip)
    expect(await hoverTooltip(screen.getByRole('checkbox', { name: translatedLabel }).closest('label')!)).toBe(translatedTip)
  })
})

/** H-024 (canvas, owner 2026-10-31): Settings → Screen, after "Enhance group arrows". Its effect on My Lists is task 44.4's. */
describe('SettingsScreen: Show time left in My Lists (H-024)', () => {
  const label = en.quantum.settings.showTimeLeft
  const box = () => screen.getByRole('checkbox', { name: label }) as HTMLInputElement

  it('is worded as the canvas has it', () => {
    expect(label).toBe('Show time left in My Lists')
    expect(en.quantum.settings.showTimeLeftTip).toBe(
      "Time left is often estimated or still being looked up; off, it shows when you point at a list's progress",
    )
  })

  it('is the last box of Screen, after Enhance group arrows, in a browser too, and unticked by default', () => {
    renderSettings()

    const boxes = screen.getAllByRole('checkbox').map((entry) => entry.closest('label')?.textContent)
    expect(boxes.at(-1)).toBe(label)
    expect(boxes.at(-2)).toBe(en.quantum.settings.markOpenGroups)
    expect(box().checked).toBe(false)
  })

  it('starts ticked when the setting is on', () => {
    renderSettings({ showTimeLeft: true })

    expect(box().checked).toBe(true)
  })

  it('ticking persists a yes and unticking a no, under the key showTimeLeft', async () => {
    renderSettings()

    act(() => box().click())
    expect(box().checked).toBe(true)
    await waitFor(() => expect(store.data.get('showTimeLeft')).toBe('true'))

    act(() => box().click())
    expect(box().checked).toBe(false)
    await waitFor(() => expect(store.data.get('showTimeLeft')).toBe('false'))
  })

  it('says why on hover, and as the box’s description for a screen reader, the name staying the label', async () => {
    renderSettings()

    expect(await hoverTooltip(box().closest('label')!)).toBe(en.quantum.settings.showTimeLeftTip)
    expect(box().getAttribute('aria-description')).toBe(en.quantum.settings.showTimeLeftTip)
  })

  it.each([
    ['Русский', ru.quantum.settings.showTimeLeft, ru.quantum.settings.showTimeLeftTip],
    ['Deutsch', de.quantum.settings.showTimeLeft, de.quantum.settings.showTimeLeftTip],
  ])('is named and explained in %s in its own words', async (language, translatedLabel, translatedTip) => {
    renderSettings()
    act(() => screen.getByRole('button', { name: language }).click())

    expect(translatedLabel).not.toBe(label)
    expect(translatedTip).not.toBe(en.quantum.settings.showTimeLeftTip)
    expect(await hoverTooltip(screen.getByRole('checkbox', { name: translatedLabel }).closest('label')!)).toBe(translatedTip)
  })
})
