import './VaultShelf.css'
import { useEffect, useRef, useState } from 'react'
import type { LibraryEntry } from '../../../../../server/src/ingestion/customLists.js'
import { api, type MediaType } from '../../../lib/api.js'
import { previewPath } from '../../../lib/preview.js'
import { categoryLabel, copy } from '../../../locale/index.js'
import { useLayerStack } from '../layerStack/LayerStackContext.js'
import { shelfPicks } from './shelfPicks.js'

export interface VaultShelfProps {
  /** The registry, for the categories' names. */
  mediaTypes: readonly MediaType[]
  /** Chooses the six; a test fixes it. */
  random?: () => number
}

type Shelf = { phase: 'loading' } | { phase: 'offline' } | { phase: 'ready'; picks: LibraryEntry[] }

/**
 * "Or start from List Vault" (H-018): under the first-run tiles, up to six canonical lists a person can open without a key. A card opens the
 * Preview the search rows open and adds nothing: the list is only built by Add This List there. The six are picked once, when the library
 * has answered, and stay while the screen stays open. With no connection the shelf says so instead of showing cards.
 */
export function VaultShelf({ mediaTypes, random = Math.random }: VaultShelfProps) {
  const text = copy.quantum.vaultShelf
  const layerStack = useLayerStack()
  const [shelf, setShelf] = useState<Shelf>({ phase: 'loading' })
  // Read once, when the library answers: a new random source later must not shuffle the shelf the reader is looking at.
  const pick = useRef(random)

  useEffect(() => {
    let current = true
    api
      .libraryUntracked()
      .then(({ entries, reachable }) => {
        if (current) setShelf(reachable ? { phase: 'ready', picks: shelfPicks(entries, pick.current) } : { phase: 'offline' })
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
      <span className="q-vault-label">{text.label}</span>
      <p className="q-vault-line">{shelf.phase === 'offline' ? text.offline : text.line}</p>
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
