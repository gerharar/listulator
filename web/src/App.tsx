import './App.css'
import { useEffect, useState } from 'react'
import { Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { MediaType } from './lib/api.js'
import { copy } from './locale/index.js'
import { resolveInitialTheme } from './lib/theme.js'
import { getPreferencesStore } from './lib/preferences/store.js'
import { resolveSkin, setSkin as persistSkin, type Skin } from './lib/preferences/skin.js'
import { resolveLanguage, type Language } from './lib/preferences/language.js'
import {
  resolveMotion,
  resolveReducedMotionSetting,
  type Motion,
} from './lib/preferences/motion.js'
import { MotionProvider } from './components/quantum/Motion/MotionContext.js'
import { SettingsScreen } from './screens/settings/SettingsScreen.js'
import { ListScreen } from './screens/list/ListScreen.js'
import { CreateList } from './components/quantum/CreateList/CreateList.js'
import { PreviewLayer } from './components/quantum/PreviewLayer/PreviewLayer.js'
import { parsePreviewPath } from './lib/preview.js'
import { Atmosphere } from './components/quantum/Atmosphere/Atmosphere.js'
import { QRoot } from './components/quantum/QRootContext.js'
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
import { LegacyRouteHost } from './components/quantum/layerStack/LegacyRouteHost.js'
import { parseLegacyPath } from './components/quantum/layerStack/legacyRoute.js'
import { layerGeometry } from './components/quantum/layerStack/layerGeometry.js'
import type { LayerDescriptor } from './components/quantum/layerStack/layerStack.js'

function homeLayer(): LayerDescriptor<string> {
  return { id: 'home', kind: 'home', tabLabel: copy.quantum.home.title, content: '/' }
}

interface BootState {
  skin: Skin
  language: Language
  motion: Motion
  /** `undefined` until the user has ticked or unticked the box: the system setting decides then. */
  reducedSetting: boolean | undefined
}

/**
 * Boots the app: resolves the skin/language preferences before the first
 * `.q-root` frame, so it never flashes the default skin or English before
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
    // The old six-theme system has no UI any more, but it still styles
    // every hosted old screen (ListDetail/NewList) — keep applying it
    // silently until checkpoint 10E removes the last of those screens.
    document.documentElement.dataset['theme'] = resolveInitialTheme(
      typeof localStorage === 'undefined' ? undefined : localStorage,
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    )

    const store = getPreferencesStore()
    Promise.all([
      resolveSkin(store),
      resolveLanguage(store),
      resolveMotion(store),
      resolveReducedMotionSetting(store),
    ])
      .then(([skin, language, motion, reducedSetting]) =>
        setBoot({ skin, language, motion, reducedSetting }),
      )
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : copy.app.unknownError),
      )
  }, [])

  // Neither state has a `.q-root` yet to theme — plain text is deliberate, not a placeholder to fix later.
  if (error) return <p>{error}</p>
  if (!boot) return <p>{copy.app.loading}</p>

  return <QuantumShell initial={boot} />
}

function QuantumShell({ initial }: { initial: BootState }) {
  const [skin, setSkinState] = useState<Skin>(initial.skin)
  const store = getPreferencesStore()

  function handleSkinChange(next: Skin): void {
    setSkinState(next)
    void persistSkin(store, next)
  }

  return (
    <MotionProvider
      initialMotion={initial.motion}
      initialReducedSetting={initial.reducedSetting}
      store={store}
    >
      <QRoot skin={skin}>
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
      </QRoot>
    </MotionProvider>
  )
}

/** Reads the category the picker chose off the layer's own path (`/lists/new?mediaType=…`). */
function CreateListRoute({ mediaTypes }: { mediaTypes: MediaType[] }) {
  const [searchParams] = useSearchParams()

  return <CreateList mediaTypes={mediaTypes} mediaTypeKey={searchParams.get('mediaType') ?? ''} />
}

/** The list layer (task 10.20): the list's id rides on the layer's own path. */
function ListRoute({ mediaTypes }: { mediaTypes: MediaType[] }) {
  const { listId } = useParams<{ listId: string }>()
  const navigate = useNavigate()
  const layerStack = useLayerStack()

  return listId ? (
    <ListScreen
      key={listId}
      listId={listId}
      mediaTypes={mediaTypes}
      // A deleted list has nothing left to show: "/" always means Home, however deep the stack.
      onLeave={() => void navigate('/')}
      onClose={() => layerStack.pop()}
    />
  ) : null
}

/**
 * The Preview layer's route (task 10.15): the source and its options ride on
 * the layer's own path. Add list navigates like a create layer does, so it
 * collapses to `[home, list]` through `handleLegacyNavigate`.
 */
function PreviewRoute({ mediaTypes }: { mediaTypes: MediaType[] }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const source = parsePreviewPath(searchParams)
  const mediaType = source && mediaTypes.find((entry) => entry.key === source.mediaType)
  if (!source || !mediaType) return null

  return (
    <PreviewLayer
      source={source}
      mediaType={mediaType}
      onBuilt={(listId) => void navigate(`/lists/${listId}`, { replace: true })}
    />
  )
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
      tabLabel: copy.quantum.settings.title,
      content: '',
    })
  }

  function handleLegacyNavigate(to: string, opts: { replace: boolean }): void {
    const target = parseLegacyPath(to)

    if (target.kind === 'home') {
      // "All lists" always means Home itself, however deep the stack is.
      layerStack.popToIndex(0)
      return
    }

    const descriptor: LayerDescriptor<string> =
      target.kind === 'list'
        ? // No list title is available from a path alone without fetching it —
          // a real, title-aware tab is task 10.20's List detail layer.
          {
            id: `list-${target.listId}`,
            kind: 'list',
            tabLabel: copy.quantum.layerStack.untitledListTab,
            content: to,
          }
        : { id: 'new-list', kind: 'new-list', tabLabel: copy.newList.title, content: to }

    if (opts.replace) {
      // A replace only ever comes from a create layer that just made its list.
      // Whatever sits under it — the Category picker, and on first run the
      // picker as the *base* layer with no Home beneath it at all — is
      // finished with, so land on `[home, list]` either way: a plain
      // replaceTop would leave the picker under the new list, or (first run)
      // swap it in place at index 0 so Home would never get created and be
      // permanently unreachable (docs/DECISIONS.md).
      const baseIsHome = layerStack.stack[0]?.kind === 'home'
      layerStack.popToIndex(0)
      if (!baseIsHome) layerStack.replaceTop(homeLayer())
      layerStack.push(descriptor)
    } else {
      layerStack.push(descriptor)
    }
  }

  return (
    <div className="q-shell">
      <AppHeader skin={skin} onSkinChange={onSkinChange} onSettings={openSettings} />
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
              tabLabel={layer.tabLabel}
              onTabClick={() => layerStack.popToIndex(fullIndex)}
              onVeilClick={() => layerStack.pop()}
            >
              {layer.kind === 'home' ? (
                <Home onMediaTypesLoaded={setMediaTypes} />
              ) : layer.kind === 'settings' ? (
                <SettingsScreen skin={skin} onSkinChange={onSkinChange} />
              ) : layer.kind === 'category-picker' ? (
                <CategoryPicker mediaTypes={mediaTypes} first={fullIndex === 0} />
              ) : (
                <LegacyRouteHost path={layer.content} onNavigate={handleLegacyNavigate}>
                  <Routes>
                    <Route path="/lists/new" element={<CreateListRoute mediaTypes={mediaTypes} />} />
                    <Route path="/lists/preview" element={<PreviewRoute mediaTypes={mediaTypes} />} />
                    <Route path="/lists/:listId" element={<ListRoute mediaTypes={mediaTypes} />} />
                  </Routes>
                </LegacyRouteHost>
              )}
            </LayerCard>
          )
        })}
      </div>
    </div>
  )
}
