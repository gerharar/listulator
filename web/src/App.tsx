import './App.css'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api, type MediaType } from './lib/api.js'
import { copy } from './locale/index.js'
import { getPreferencesStore } from './lib/preferences/store.js'
import { resolveSkin, setSkin as persistSkin, type Skin } from './lib/preferences/skin.js'
import { effectiveTheme, resolveTheme, setTheme as persistTheme, type Theme } from './lib/preferences/theme.js'
import { finePointer, subscribeFinePointer } from './lib/finePointer.js'
import { isDesktop } from './lib/platform.js'
import { narrowWindowMin, type NarrowMode } from './lib/narrowWindow.js'
import { useNarrowWindowNotice } from './lib/useNarrowWindowNotice.js'
import { maximizeWindow } from './lib/windowMaximize.js'
import { useInnerWidth } from './lib/useInnerWidth.js'
import { NarrowWindowBanner, NarrowWindowPopover } from './components/quantum/NarrowWindowNotice/NarrowWindowNotice.js'
import { resolveExzedSkin, setExzedSkin as persistExzedSkin } from './lib/preferences/exzedSkin.js'
import { activeSkin } from './lib/preferences/activeSkin.js'
import type { ExzedSkin } from './lib/preferences/exzedSkins.js'
import { resolveLanguage, type Language } from './lib/preferences/language.js'
import { resolveReducedMotionSetting } from './lib/preferences/motion.js'
import { resolveMarkOpenGroups } from './lib/preferences/groupLine.js'
import { resolveShowTimeLeft } from './lib/preferences/timeLeft.js'
import { GroupLineProvider } from './components/quantum/GroupTriangle/GroupTriangle.js'
import { TimeLeftProvider } from './components/quantum/Home/TimeLeftSetting.js'
import { MotionProvider } from './components/quantum/Motion/MotionContext.js'
import { useUpdatedToast } from './lib/useUpdatedToast.js'
import { useFullscreenKey } from './lib/windowFullscreen.js'
import { getAppQuit } from './lib/appQuit.js'
import { useRefetchOnRegistryChange } from './lib/registryChanges.js'
import { SettingsScreen } from './screens/settings/SettingsScreen.js'
import { AboutScreen } from './screens/about/AboutScreen.js'
import { ListScreen } from './screens/list/ListScreen.js'
import { CreateList } from './components/quantum/CreateList/CreateList.js'
import { PreviewLayer } from './components/quantum/PreviewLayer/PreviewLayer.js'
import { VaultBrowser } from './components/quantum/VaultBrowser/VaultBrowser.js'
import { parsePreviewPath } from './lib/preview.js'
import { ThemeBackdrop } from './components/quantum/ThemeBackdrop/ThemeBackdrop.js'
import { applyThemeClass, DocumentTheme } from './components/quantum/DocumentTheme/DocumentTheme.js'
import { AppHeader } from './components/quantum/AppHeader/AppHeader.js'
import { LayerCard } from './components/quantum/LayerCard/LayerCard.js'
import { RailPlacementProvider, useWindowRailPlacement } from './screens/list/RailPlacementContext.js'
import { layerBorderWidth, listCardWidth } from './screens/list/railPlacement.js'
import { useDevicePixelRatio } from './lib/useDevicePixelRatio.js'
import { Home } from './components/quantum/Home/Home.js'
import { CategoryPicker } from './components/quantum/CategoryPicker/CategoryPicker.js'
import { LiveRegionProvider } from './components/quantum/LiveRegion/LiveRegion.js'
import { ToastProvider } from './components/quantum/Toast/Toast.js'
import {
  OverlayManagerProvider,
  useEscLadder,
} from './components/quantum/overlay/OverlayManagerContext.js'
import { LanguageProvider, useLanguage } from './locale/LanguageProvider.js'
import {
  LayerStackProvider,
  useLayerStack,
} from './components/quantum/layerStack/LayerStackContext.js'
import { parseLayerPath } from './components/quantum/layerStack/layerPath.js'
import { untitledListLayer } from './components/quantum/layerStack/listLayer.js'
import { layerGeometry } from './components/quantum/layerStack/layerGeometry.js'
import { resolveTabLabel, type LayerDescriptor } from './components/quantum/layerStack/layerStack.js'
import { useLayerEscape } from './components/quantum/layerStack/useLayerEscape.js'

function homeLayer(): LayerDescriptor<string> {
  return { id: 'home', kind: 'home', tabLabel: () => copy.quantum.home.title, content: '/' }
}

interface BootState {
  skin: Skin
  /** eX-Zed's own skin (X-003), read at boot beside Quantum's: the page carries the active theme's (`activeSkin`). */
  exzedSkin: ExzedSkin
  /** The theme (Phase 48), as stored at boot: the shell holds the live one in state (49.7). */
  theme: Theme
  language: Language
  /** `undefined` until the user has ticked or unticked the box: the system setting decides then. */
  reducedSetting: boolean | undefined
  /** H-022: the preference `markOpenGroups`, off unless clearly on. */
  markOpenGroups: boolean
  /** H-024: the preference `showTimeLeft`, off unless clearly on. */
  showTimeLeft: boolean
}

/** The header's Quit/Exit (task 16.2b): the desktop window, or none in the browser build. */
const appQuit = getAppQuit()

/**
 * Boots the app: resolves the skin/language preferences before the first
 * frame, so it never flashes the default skin or English before
 * correcting itself (task 10.9). Deliberately does **not** also confirm the
 * server's reachable or load the media-type registry any more (task 10.10)
 * — both are local reads (`getPreferencesStore`) that don't depend on the
 * server, so this boot can't itself hit the "server's down" case Q13 cares
 * about. `Home` now owns that fetch, so a stopped server renders Home's own
 * `ErrorBlock` inside the mounted shell, not a bare pre-shell paragraph.
 */
export function App() {
  const [boot, setBoot] = useState<BootState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const store = getPreferencesStore()
    Promise.all([
      resolveSkin(store),
      resolveExzedSkin(store),
      resolveTheme(store),
      resolveLanguage(store),
      resolveReducedMotionSetting(store),
      resolveMarkOpenGroups(store),
      resolveShowTimeLeft(store),
    ])
      .then(([skin, exzedSkin, theme, language, reducedSetting, markOpenGroups, showTimeLeft]) => {
        // Before the first render of the shell: its sizes are read from the page as it lays out (themeSizes.ts). On a touch-only device the stored eX-Zed is not
        // drawn (49.10) and is left as it is.
        applyThemeClass(effectiveTheme(theme, finePointer()))
        setBoot({ skin, exzedSkin, theme, language, reducedSetting, markOpenGroups, showTimeLeft })
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : copy.app.unknownError),
      )
  }, [])

  // Neither state has a skin applied yet — plain text is deliberate, not a placeholder to fix later.
  if (error) return <p>{error}</p>
  if (!boot) return <p>{copy.app.loading}</p>

  return <QuantumShell initial={boot} />
}

function QuantumShell({ initial }: { initial: BootState }) {
  const [skin, setSkinState] = useState<Skin>(initial.skin)
  // The stored theme, live (49.7): switching it redraws every open layer and keeps what they hold. What is drawn is `shown`: eX-Zed only where the device has a
  // fine pointer that can hover (49.10, design's answer 8); on a touch-only device the stored choice is left as it is, for a desktop that shares it.
  const [theme, setThemeState] = useState<Theme>(initial.theme)
  const [fine, setFine] = useState(finePointer)
  const shown = effectiveTheme(theme, fine)
  const storedTheme = useRef(theme)
  storedTheme.current = theme
  // A mouse plugged into a tablet, or taken off it, while the app runs: the class first, as in a switch (the layers read the page's sizes as they render), then
  // the state. Nothing is written: the preference did not change.
  useEffect(
    () =>
      subscribeFinePointer((next) => {
        applyThemeClass(effectiveTheme(storedTheme.current, next))
        setFine(next)
      }),
    [],
  )
  // eX-Zed's own skin (X-003): a second preference beside Quantum's, so each theme comes back with its last skin.
  const [exzedSkin, setExzedSkinState] = useState<ExzedSkin>(initial.exzedSkin)
  const store = getPreferencesStore()

  // eX-Zed needs a window of a minimum width (49.12). Narrower, with eX-Zed drawn: a banner (the app started so) or, when the person has just switched to it, a
  // popover on the chip. Never blocking, nothing stored. The minimum is read from the theme's own tokens once it is the theme drawn; the width is the layers'.
  const width = useInnerWidth()
  const needed = useMemo(() => (shown === 'exzed' ? narrowWindowMin() : 0), [shown])
  const notice = useNarrowWindowNotice({ exzed: shown === 'exzed', width, min: needed, desktop: isDesktop(), screenWidth: screen.availWidth, maximize: maximizeWindow })
  // F11 toggles full screen in the desktop app, wherever focus is (17.7); nothing in the browser.
  useFullscreenKey()

  function handleSkinChange(next: Skin): void {
    setSkinState(next)
    void persistSkin(store, next)
  }

  function handleExzedSkinChange(next: ExzedSkin): void {
    setExzedSkinState(next)
    void persistExzedSkin(store, next)
  }

  function handleThemeChange(next: Theme, anchor?: HTMLElement): void {
    if (next === theme) return
    // A fresh switch to eX-Zed is a fresh question: the popover opens on the chip again, whatever was dismissed before.
    notice.opened(next === 'exzed' && anchor ? anchor : null)
    // The class goes on <html> first, as at boot: what is laid out from the page's sizes (the row model, the rail's placement, the layers' cascade) reads
    // them while it renders, and DocumentTheme's own effect runs only after its children have rendered. Written at once, so a quit right after keeps it.
    applyThemeClass(effectiveTheme(next, fine))
    setThemeState(next)
    void persistTheme(store, next)
      .then(() => store.flush?.())
      .catch(() => undefined)
  }

  return (
    <MotionProvider
      initialReducedSetting={initial.reducedSetting}
      store={store}
    >
      <DocumentTheme skin={activeSkin(shown, { quantum: skin, exzed: exzedSkin })} theme={shown}>
        <ThemeBackdrop />
        <LiveRegionProvider>
          <ToastProvider>
            <OverlayManagerProvider>
              <LanguageProvider initialLanguage={initial.language}>
                <GroupLineProvider on={initial.markOpenGroups} store={store}>
                  <TimeLeftProvider on={initial.showTimeLeft} store={store}>
                    <LayerStackProvider home={homeLayer()}>
                      <AppShellBody
                        skin={skin}
                        onSkinChange={handleSkinChange}
                        exzedSkin={exzedSkin}
                        onExzedSkinChange={handleExzedSkinChange}
                        theme={shown}
                        canChooseTheme={fine}
                        onThemeChange={handleThemeChange}
                        narrow={{
                          mode: notice.mode,
                          min: needed,
                          banner: notice.banner,
                          popover: notice.popover,
                          anchor: notice.anchor,
                          onEmbiggen: notice.embiggen,
                          onKeep: () => handleThemeChange('quantum'),
                          onDismiss: notice.dismiss,
                        }}
                      />
                    </LayerStackProvider>
                  </TimeLeftProvider>
                </GroupLineProvider>
              </LanguageProvider>
            </OverlayManagerProvider>
          </ToastProvider>
        </LiveRegionProvider>
      </DocumentTheme>
    </MotionProvider>
  )
}

/**
 * The layers whose content names what they show (see `layerPath.ts`): a list,
 * the Create layer for a category, or a Preview of a source. Anything the path
 * does not name draws nothing.
 */
export function PathLayer({ path, mediaTypes, active = true }: { path: string; mediaTypes: MediaType[]; active?: boolean }) {
  const layerStack = useLayerStack()
  const target = parseLayerPath(path)

  if (target.kind === 'list') {
    return (
      <ListScreen
        key={target.listId}
        listId={target.listId}
        mediaTypes={mediaTypes}
        // A deleted list has nothing left to show: leaving always means Home, however deep the stack.
        onLeave={() => layerStack.popToIndex(0)}
        onClose={() => layerStack.pop()}
        active={active}
      />
    )
  }

  if (target.kind === 'new-list') {
    // Keyed by the path: a Create layer replaced by another (Open in Mega) must start afresh, not keep the
    // old category's tab, query and results.
    return (
      <CreateList
        key={path}
        mediaTypes={mediaTypes}
        mediaTypeKey={target.mediaType ?? ''}
        {...(target.query ? { initialQuery: target.query } : {})}
        {...(target.openRef ? { initialOpen: target.openRef } : {})}
      />
    )
  }

  if (target.kind === 'vault') {
    return <VaultBrowser mediaTypes={mediaTypes} />
  }

  if (target.kind === 'preview') {
    // Add list lands on the new list like a Create layer does.
    const source = parsePreviewPath(target.params)
    const mediaType = source && mediaTypes.find((entry) => entry.key === source.mediaType)
    if (!source || !mediaType) return null

    return (
      <PreviewLayer
        source={source}
        mediaType={mediaType}
        onBuilt={(listId) => layerStack.landOnList(untitledListLayer(listId))}
        active={active}
      />
    )
  }

  return null
}

/** What the narrow-window warning needs from the shell (49.12). */
interface NarrowNotice {
  mode: NarrowMode
  min: number
  banner: boolean
  popover: boolean
  anchor: HTMLElement | null
  onEmbiggen: () => void
  onKeep: () => void
  onDismiss: () => void
}

interface AppShellBodyProps {
  narrow: NarrowNotice
  skin: Skin
  onSkinChange: (skin: Skin) => void
  exzedSkin: ExzedSkin
  onExzedSkinChange: (skin: ExzedSkin) => void
  theme: Theme
  /** False on a touch-only device: Settings does not offer the THEME choice there (49.10). */
  canChooseTheme: boolean
  onThemeChange: (theme: Theme) => void
}

function AppShellBody({ skin, onSkinChange, exzedSkin, onExzedSkinChange, theme, canChooseTheme, onThemeChange, narrow }: AppShellBodyProps) {
  // Subscribes the whole shell (header, Home) to the language, so a switch in
  // Settings re-renders them live rather than at the next unrelated render.
  useLanguage()
  // The first screen of a newer version says so (canvas H-017).
  useUpdatedToast()
  const layerStack = useLayerStack()
  // Where the list's jump rail sits (H-019): one answer for the window, read by every list layer.
  const railWindow = useWindowRailPlacement()
  const pixelRatio = useDevicePixelRatio()
  // `Home` is the only thing that fetches the registry (task 10.10) — the
  // still-hosted legacy screens (List detail, New list) need it too, so it
  // lives here and Home lifts it up once loaded. Empty until then; neither
  // hosted screen is reachable before Home has rendered at least once.
  const [mediaTypes, setMediaTypes] = useState<MediaType[]>([])
  // A key saved in Settings changes what can be searched and previewed: ask again, whichever layer is showing (16.5).
  useRefetchOnRegistryChange(() => api.mediaTypes(), setMediaTypes)
  // The Esc ladder's second rung: nothing is open, so pop one layer — the
  // design prototype's own handler ends in `this.pop()`. Esc from the Create
  // layer returns to the Category picker; from a layer over Home, to Home.
  // While a whole-list run holds the stack it pops nothing, and says why once per run (H-015).
  useEscLadder(useLayerEscape())

  // Settings is one layer: pressing the gear while it is already on top does nothing.
  function openSettings(): void {
    if (layerStack.stack[layerStack.stack.length - 1]?.kind === 'settings') return
    layerStack.push({
      id: 'settings',
      kind: 'settings',
      tabLabel: () => copy.quantum.settings.title,
      content: '',
    })
  }

  // About, the same way: one layer, and the ⓘ does nothing while it is on top (task 11.21).
  function openAbout(): void {
    if (layerStack.stack[layerStack.stack.length - 1]?.kind === 'about') return
    layerStack.push({
      id: 'about',
      kind: 'about',
      tabLabel: () => copy.quantum.about.title,
      content: '',
    })
  }

  return (
    <div className="q-shell">
      <AppHeader skin={skin} onSkinChange={onSkinChange} exzedSkin={exzedSkin} onExzedSkinChange={onExzedSkinChange} onSettings={openSettings} onAbout={openAbout} quit={appQuit} run={layerStack.navigationRun ?? undefined} />
      {narrow.banner && <NarrowWindowBanner mode={narrow.mode} min={narrow.min} onEmbiggen={narrow.onEmbiggen} onKeep={narrow.onKeep} onDismiss={narrow.onDismiss} />}
      <NarrowWindowPopover open={narrow.popover} anchorEl={narrow.anchor} mode={narrow.mode} min={narrow.min} onEmbiggen={narrow.onEmbiggen} onKeep={narrow.onKeep} onDismiss={narrow.onDismiss} />
      <div className="q-stage">
        {layerStack.visible.map((layer, index) => {
          const isTop = index === layerStack.visible.length - 1
          const fullIndex = layerStack.stack.indexOf(layer)
          // The most-covered visible layer (index 0) sits highest, so its
          // LayerTab (34px + 1px border) peeks above whatever's in front of
          // it; the active layer (depth 0) sits lowest and most prominent —
          // the drum carousel's real peek cascade (task 10.9c), not 10.9's
          // fixed-37px-step placeholder.
          const depth = layerStack.visible.length - 1 - index
          const { top, transform, inset } = layerGeometry(layerStack.visible.length, depth)
          // The list's rail may lie outside the card (H-019): the card then lets it show, and gives up the odd pixel so the margins are whole.
          // Only then: inside, the card keeps clipping, so a layer taller than a short window still scrolls.
          const reach = (layer.kind === 'list' || layer.kind === 'preview') && railWindow.placement === 'outside'
          const width = reach ? listCardWidth(railWindow.windowWidth) : null
          // The card's border and the rail's offsets share one width, whole device pixels at any screen scale (`--q-bw`, see `layerBorderWidth`).
          const border = reach ? { '--q-bw': `${layerBorderWidth(pixelRatio)}px` } : null
          // A list and a Preview have their own cap (the same 1080px in Quantum, wider in a theme with a wider font): the rail's rule reads it too.
          const cap = layer.kind === 'list' || layer.kind === 'preview' ? { '--layer-cap': 'var(--layer-max-list)' } : null

          return (
            <LayerCard
              key={layer.id}
              reach={reach}
              style={{ top, transform, zIndex: 10 + fullIndex, ...(width !== null && { width }), ...cap, ...(inset !== undefined && { '--peek-inset': `${inset}px` }), ...border } as CSSProperties}
              entering={layer.id === layerStack.enteringId}
              covered={!isTop}
              tabLabel={resolveTabLabel(layer.tabLabel)}
              onTabClick={() => layerStack.popToIndex(fullIndex)}
              onVeilClick={() => layerStack.pop()}
            >
              {layer.kind === 'home' ? (
                <Home onMediaTypesLoaded={setMediaTypes} />
              ) : layer.kind === 'settings' ? (
                <SettingsScreen skin={skin} onSkinChange={onSkinChange} exzedSkin={exzedSkin} onExzedSkinChange={onExzedSkinChange} theme={theme} canChooseTheme={canChooseTheme} onThemeChange={onThemeChange} />
              ) : layer.kind === 'about' ? (
                <AboutScreen />
              ) : layer.kind === 'category-picker' ? (
                <CategoryPicker mediaTypes={mediaTypes} first={fullIndex === 0} />
              ) : (
                <RailPlacementProvider value={railWindow}>
                  <PathLayer path={layer.content} mediaTypes={mediaTypes} active={isTop} />
                </RailPlacementProvider>
              )}
            </LayerCard>
          )
        })}
      </div>
    </div>
  )
}
