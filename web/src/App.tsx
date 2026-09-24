import './App.css'
import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { api, type MediaType } from './lib/api.js'
import { copy } from './locale/index.js'
import { resolveInitialTheme } from './lib/theme.js'
import { getPreferencesStore } from './lib/preferences/store.js'
import { resolveSkin, setSkin as persistSkin, type Skin } from './lib/preferences/skin.js'
import { resolveLanguage, type Language } from './lib/preferences/language.js'
import { Overview } from './routes/Overview.js'
import { ListDetail } from './routes/ListDetail.js'
import { NewList } from './routes/NewList.js'
import { Atmosphere } from './components/quantum/Atmosphere/Atmosphere.js'
import { QRoot } from './components/quantum/QRootContext.js'
import { AppHeader } from './components/quantum/AppHeader/AppHeader.js'
import { LayerCard } from './components/quantum/LayerCard/LayerCard.js'
import { LiveRegionProvider } from './components/quantum/LiveRegion/LiveRegion.js'
import { ToastProvider } from './components/quantum/Toast/Toast.js'
import {
  OverlayManagerProvider,
  useEscLadder,
} from './components/quantum/overlay/OverlayManagerContext.js'
import { LanguageProvider } from './locale/LanguageProvider.js'
import {
  LayerStackProvider,
  useLayerStack,
} from './components/quantum/layerStack/LayerStackContext.js'
import { LegacyRouteHost } from './components/quantum/layerStack/LegacyRouteHost.js'
import { parseLegacyPath } from './components/quantum/layerStack/legacyRoute.js'
import type { LayerDescriptor } from './components/quantum/layerStack/layerStack.js'

function homeLayer(): LayerDescriptor<string> {
  return { id: 'home', kind: 'home', tabLabel: copy.overview.title, content: '/' }
}

interface BootState {
  mediaTypes: MediaType[]
  skin: Skin
  language: Language
}

/**
 * Boots the app: confirms the server is reachable, loads the media-type
 * registry, and resolves the skin/language preferences — all before the
 * first `.q-root` frame, so it never flashes the default skin or English
 * before correcting itself (task 10.9).
 */
export function App() {
  const [boot, setBoot] = useState<BootState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // The old six-theme system has no UI any more, but it still styles
    // every hosted old screen (Overview/ListDetail/NewList) — keep applying
    // it silently until checkpoint 10E removes the last of those screens.
    document.documentElement.dataset['theme'] = resolveInitialTheme(
      typeof localStorage === 'undefined' ? undefined : localStorage,
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    )

    const store = getPreferencesStore()
    Promise.all([api.me(), api.mediaTypes(), resolveSkin(store), resolveLanguage(store)])
      .then(([, mediaTypes, skin, language]) => setBoot({ mediaTypes, skin, language }))
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
    <QRoot skin={skin}>
      <Atmosphere />
      <LiveRegionProvider>
        <ToastProvider>
          <OverlayManagerProvider>
            <LanguageProvider initialLanguage={initial.language}>
              <LayerStackProvider home={homeLayer()}>
                <AppShellBody
                  skin={skin}
                  onSkinChange={handleSkinChange}
                  mediaTypes={initial.mediaTypes}
                />
              </LayerStackProvider>
            </LanguageProvider>
          </OverlayManagerProvider>
        </ToastProvider>
      </LiveRegionProvider>
    </QRoot>
  )
}

interface AppShellBodyProps {
  skin: Skin
  onSkinChange: (skin: Skin) => void
  mediaTypes: MediaType[]
}

function AppShellBody({ skin, onSkinChange, mediaTypes }: AppShellBodyProps) {
  const layerStack = useLayerStack()
  // The Esc ladder's second rung: nothing is open, so go all the way home —
  // there's no intermediate "pop one" screen to land on yet (that's what a
  // real Quantum List-detail-inside-Category-inside-Home chain gets at 10.11+).
  useEscLadder(() => layerStack.popToIndex(0))

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

    if (opts.replace) layerStack.replaceTop(descriptor)
    else layerStack.push(descriptor)
  }

  return (
    <div className="q-shell">
      <AppHeader skin={skin} onSkinChange={onSkinChange} />
      <div className="q-stage">
        {layerStack.visible.map((layer, index) => {
          const isTop = index === layerStack.visible.length - 1
          const fullIndex = layerStack.stack.indexOf(layer)

          return (
            <LayerCard
              key={layer.id}
              // The most-covered visible layer (index 0) sits highest, so
              // its LayerTab (34px + 1px border) peeks above whatever's in
              // front of it; the active layer (the highest index) sits
              // lowest and most prominent. The exact cascade and its motion
              // are task 10.9's "motion" half — this is just enough to make
              // the tab and veil the acceptance criteria name reachable.
              style={{ top: 15 + index * 37, zIndex: 10 + fullIndex }}
              covered={!isTop}
              tabLabel={layer.tabLabel}
              onTabClick={() => layerStack.popToIndex(fullIndex)}
              onVeilClick={() => layerStack.pop()}
            >
              <LegacyRouteHost path={layer.content} onNavigate={handleLegacyNavigate}>
                <Routes>
                  <Route path="/" element={<Overview mediaTypes={mediaTypes} />} />
                  <Route path="/lists/new" element={<NewList mediaTypes={mediaTypes} />} />
                  <Route path="/lists/:listId" element={<ListDetail mediaTypes={mediaTypes} />} />
                </Routes>
              </LegacyRouteHost>
            </LayerCard>
          )
        })}
      </div>
    </div>
  )
}
