import './App.css'
import { useEffect, useState } from 'react'
import type { MediaType } from './lib/api.js'
import { copy } from './locale/index.js'
import { getPreferencesStore } from './lib/preferences/store.js'
import { resolveSkin, setSkin as persistSkin, type Skin } from './lib/preferences/skin.js'
import { resolveLanguage, type Language } from './lib/preferences/language.js'
import { resolveReducedMotionSetting } from './lib/preferences/motion.js'
import { MotionProvider } from './components/quantum/Motion/MotionContext.js'
import { useFullscreenKey } from './lib/windowFullscreen.js'
import { getAppQuit } from './lib/appQuit.js'
import { SettingsScreen } from './screens/settings/SettingsScreen.js'
import { AboutScreen } from './screens/about/AboutScreen.js'
import { ListScreen } from './screens/list/ListScreen.js'
import { CreateList } from './components/quantum/CreateList/CreateList.js'
import { PreviewLayer } from './components/quantum/PreviewLayer/PreviewLayer.js'
import { parsePreviewPath } from './lib/preview.js'
import { Atmosphere } from './components/quantum/Atmosphere/Atmosphere.js'
import { DocumentTheme } from './components/quantum/DocumentTheme/DocumentTheme.js'
import { AppHeader } from './components/quantum/AppHeader/AppHeader.js'
import { LayerCard } from './components/quantum/LayerCard/LayerCard.js'
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

function homeLayer(): LayerDescriptor<string> {
  return { id: 'home', kind: 'home', tabLabel: () => copy.quantum.home.title, content: '/' }
}

interface BootState {
  skin: Skin
  language: Language
  /** `undefined` until the user has ticked or unticked the box: the system setting decides then. */
  reducedSetting: boolean | undefined
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
      resolveLanguage(store),
      resolveReducedMotionSetting(store),
    ])
      .then(([skin, language, reducedSetting]) =>
        setBoot({ skin, language, reducedSetting }),
      )
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
  const store = getPreferencesStore()
  // F11 toggles full screen in the desktop app, wherever focus is (17.7); nothing in the browser.
  useFullscreenKey()

  function handleSkinChange(next: Skin): void {
    setSkinState(next)
    void persistSkin(store, next)
  }

  return (
    <MotionProvider
      initialReducedSetting={initial.reducedSetting}
      store={store}
    >
      <DocumentTheme skin={skin}>
        <Atmosphere />
        <LiveRegionProvider>
          <ToastProvider>
            <OverlayManagerProvider>
              <LanguageProvider initialLanguage={initial.language}>
                <LayerStackProvider home={homeLayer()}>
                  <AppShellBody skin={skin} onSkinChange={handleSkinChange} />
                </LayerStackProvider>
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
export function PathLayer({ path, mediaTypes }: { path: string; mediaTypes: MediaType[] }) {
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
      />
    )
  }

  return null
}

interface AppShellBodyProps {
  skin: Skin
  onSkinChange: (skin: Skin) => void
}

function AppShellBody({ skin, onSkinChange }: AppShellBodyProps) {
  // Subscribes the whole shell (header, Home) to the language, so a switch in
  // Settings re-renders them live rather than at the next unrelated render.
  useLanguage()
  const layerStack = useLayerStack()
  // `Home` is the only thing that fetches the registry (task 10.10) — the
  // still-hosted legacy screens (List detail, New list) need it too, so it
  // lives here and Home lifts it up once loaded. Empty until then; neither
  // hosted screen is reachable before Home has rendered at least once.
  const [mediaTypes, setMediaTypes] = useState<MediaType[]>([])
  // The Esc ladder's second rung: nothing is open, so pop one layer — the
  // design prototype's own handler ends in `this.pop()`. Esc from the Create
  // layer returns to the Category picker; from a layer over Home, to Home.
  useEscLadder(() => layerStack.pop())

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
      <AppHeader skin={skin} onSkinChange={onSkinChange} onSettings={openSettings} onAbout={openAbout} quit={appQuit} />
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
          const { top, transform } = layerGeometry(layerStack.visible.length, depth)

          return (
            <LayerCard
              key={layer.id}
              style={{ top, transform, zIndex: 10 + fullIndex }}
              entering={layer.id === layerStack.enteringId}
              covered={!isTop}
              tabLabel={resolveTabLabel(layer.tabLabel)}
              onTabClick={() => layerStack.popToIndex(fullIndex)}
              onVeilClick={() => layerStack.pop()}
            >
              {layer.kind === 'home' ? (
                <Home onMediaTypesLoaded={setMediaTypes} />
              ) : layer.kind === 'settings' ? (
                <SettingsScreen skin={skin} onSkinChange={onSkinChange} />
              ) : layer.kind === 'about' ? (
                <AboutScreen />
              ) : layer.kind === 'category-picker' ? (
                <CategoryPicker mediaTypes={mediaTypes} first={fullIndex === 0} />
              ) : (
                <PathLayer path={layer.content} mediaTypes={mediaTypes} />
              )}
            </LayerCard>
          )
        })}
      </div>
    </div>
  )
}
