import './VaultShelf.css'
import { useEffect, useRef, useState } from 'react'
import type { LibraryEntry } from '../../../../../server/src/ingestion/customLists.js'
import { api, type MediaType } from '../../../lib/api.js'
import { previewPath } from '../../../lib/preview.js'
import { pickSample, sampleSetting } from '../../../lib/onboardingConfig.js'
import { Button } from '../Button/Button.js'
import { untitledListLayer } from '../layerStack/listLayer.js'
import { categoryLabel, copy } from '../../../locale/index.js'
import { useLayerStack } from '../layerStack/LayerStackContext.js'
import { shelfPicks } from './shelfPicks.js'

export interface VaultShelfProps {
  /** The registry, for the categories' names. */
  mediaTypes: readonly MediaType[]
  /** Chooses the three; a test fixes it. */
  random?: () => number
}

type Shelf = { phase: 'loading' } | { phase: 'offline' } | { phase: 'ready'; picks: LibraryEntry[]; entries: LibraryEntry[] }

/**
 * "Or start from List Vault" (H-018): under the first-run tiles, up to three canonical lists a person can open without a key. A card opens the
 * Preview the search rows open and adds nothing: the list is only built by Add This List there. The three are picked once, when the library
 * has answered, and stay while the screen stays open. With no connection the shelf says so instead of showing cards.
 */
export function VaultShelf({ mediaTypes, random = Math.random }: VaultShelfProps) {
  const text = copy.quantum.vaultShelf
  const layerStack = useLayerStack()
  const [shelf, setShelf] = useState<Shelf>({ phase: 'loading' })
  const [adding, setAdding] = useState(false)
  const [failed, setFailed] = useState(false)
  const working = useRef(false)
  // Read once, when the library answers: a new random source later must not shuffle the shelf the reader is looking at.
  const pick = useRef(random)

  useEffect(() => {
    let current = true
    api
      .libraryUntracked()
      .then(({ entries, reachable }) => {
        if (current) setShelf(reachable ? { phase: 'ready', picks: shelfPicks(entries, pick.current), entries } : { phase: 'offline' })
      })
      .catch(() => {
        if (current) setShelf({ phase: 'offline' })
      })

    return () => {
      current = false
    }
  }, [])

  // The library is reachable and has nothing to offer: there is no shelf to draw.
  if (shelf.phase === 'ready' && shelf.picks.length === 0) return null

  /**
   * Try A Sample List: one real library list, the one `config/onboarding.json` names, marked a sample and opened with Home under it. If a sample
   * already exists that one is opened instead. If only the marking fails the list is still there and still opens, just without the band.
   */
  async function trySample() {
    if (working.current || shelf.phase !== 'ready') return
    working.current = true
    setAdding(true)
    setFailed(false)
    try {
      const existing = (await api.lists()).find((list) => list.isSample)
      let id = existing?.id
      if (id === undefined) {
        const entry = pickSample(sampleSetting, shelf.entries, pick.current)
        if (entry === null) throw new Error('the library has no list to offer')
        id = (await api.createFromSource({ mediaType: entry.category, externalRef: entry.externalRef, title: entry.title })).id
        await api.updateList(id, { isSample: true }).catch(() => undefined)
      }
      layerStack.landOnList(untitledListLayer(id))
    } catch {
      setFailed(true)
    } finally {
      working.current = false
      setAdding(false)
    }
  }

  function open(entry: LibraryEntry) {
    layerStack.push({
      id: `preview-${entry.externalRef}`,
      kind: 'preview',
      tabLabel: () => copy.quantum.search.previewTab(entry.title),
      content: previewPath({ mediaType: entry.category, externalRef: entry.externalRef, title: entry.title, options: {} }),
    })
  }

  const nameOf = (key: string): string => {
    const type = mediaTypes.find((candidate) => candidate.key === key)

    return type ? categoryLabel(type) : key
  }

  return (
    <section className="q-vault">
      <div className="q-vault-head">
        <div className="q-vault-intro">
          <span className="q-vault-label">{text.label}</span>
          <p className="q-vault-line">{shelf.phase === 'offline' ? text.offline : text.line}</p>
        </div>
        <Button className="q-vault-sample" disabled={shelf.phase !== 'ready' || adding} onClick={() => void trySample()}>
          {text.trySample}
        </Button>
      </div>
      {failed && (
        <p className="q-vault-failed" role="alert">
          {text.sampleFailed}
        </p>
      )}
      {shelf.phase === 'ready' && (
        <div className="q-vault-cards">
          {shelf.picks.map((entry) => (
            <button key={entry.externalRef} type="button" className="q-vault-card" onClick={() => open(entry)}>
              <span className="q-vault-title">{entry.title}</span>
              <span className="q-vault-meta">
                {entry.itemCount === undefined ? nameOf(entry.category) : `${nameOf(entry.category)} · ${text.items(entry.itemCount)}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
