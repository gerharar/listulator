import { Tip } from '../Tooltip/Tip.js'
import './VaultBrowser.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Vault, X } from 'lucide-react'
import type { LibraryBrowserEntry } from '../../../../../server/src/ingestion/customLists.js'
import { api, type MediaType } from '../../../lib/api.js'
import { categoryLabel, copy, sortCategories } from '../../../locale/index.js'
import { Button, IconButton } from '../Button/Button.js'
import { HeaderPlate } from '../HeaderPlate/HeaderPlate.js'
import { useLayerStack } from '../layerStack/LayerStackContext.js'
import { StatusChip, statusChipData } from '../StatusChip/StatusChip.js'
import { browserTime, DEFAULT_SORT, nextSort, sortRows, type BrowserSort, type SortKey } from './browserRows.js'

export interface VaultBrowserProps {
  /** The registry: the column lists every category in it, never a fixed set. */
  mediaTypes: readonly MediaType[]
}

const COLUMNS: readonly { key: SortKey; number: boolean }[] = [
  { key: 'name', number: false },
  { key: 'status', number: false },
  { key: 'items', number: true },
  { key: 'time', number: true },
]

type Library = { phase: 'loading' } | { phase: 'out' } | { phase: 'ready'; entries: readonly LibraryBrowserEntry[] }

/**
 * The List Vault browser (H-020): a category column beside the lists of the category picked. The column and its counts come from the
 * library index and the registry; a list the person already tracks is counted like the rest (only the shelf hides them). Nothing is
 * selected on open and the selection is not kept between openings.
 */
export function VaultBrowser({ mediaTypes }: VaultBrowserProps) {
  const text = copy.quantum.vaultBrowser
  const layerStack = useLayerStack()
  const [library, setLibrary] = useState<Library>({ phase: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [sort, setSort] = useState<BrowserSort>(DEFAULT_SORT)

  const load = useCallback((): Promise<void> => {
    return api
      .library()
      .then(({ entries, reachable }) => setLibrary(reachable ? { phase: 'ready', entries } : { phase: 'out' }))
      .catch(() => setLibrary({ phase: 'out' }))
  }, [])

  useEffect(() => {
    let current = true
    api
      .library()
      .then(({ entries, reachable }) => {
        if (current) setLibrary(reachable ? { phase: 'ready', entries } : { phase: 'out' })
      })
      .catch(() => {
        if (current) setLibrary({ phase: 'out' })
      })

    return () => {
      current = false
    }
  }, [])

  const counts = useMemo(() => {
    const byCategory = new Map<string, number>()
    if (library.phase === 'ready') for (const entry of library.entries) byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + 1)

    return byCategory
  }, [library])

  const ordered = sortCategories(mediaTypes)
  const total = library.phase === 'ready' ? library.entries.length : 0
  const filled = [...counts.values()].filter((count) => count > 0).length
  const selectedType = ordered.find((type) => type.key === selected)
  const rows = useMemo(
    () => (library.phase === 'ready' && selected !== null ? sortRows(library.entries.filter((entry) => entry.category === selected), sort) : []),
    [library, selected, sort],
  )

  async function tryAgain() {
    setRetrying(true)
    await load()
    setRetrying(false)
  }

  return (
    <div className="q-vb">
      <div className="q-vb-head">
        <HeaderPlate side="left" seed={7} />
        <div className="q-vb-titles">
          <h1 className="q-vb-title">{text.title}</h1>
          <p className="q-vb-sub">{text.subline}</p>
        </div>
        <IconButton label={text.closeLabel} onClick={() => layerStack.pop()}>
          <X width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
        </IconButton>
      </div>

      <div className="q-vb-body">
        <nav className="q-vb-column" aria-label={text.categoriesLabel}>
          {ordered.map((type) => {
            const count = counts.get(type.key) ?? 0
            // Loading: not disabled, but nothing to pick yet. Out of reach, or no lists: disabled, and the column keeps its places.
            const empty = library.phase === 'out' || (library.phase === 'ready' && count === 0)
            const picked = library.phase === 'ready' && selected === type.key

            return (
              <Tip
                key={type.key}
                as="button"
                type="button"
                className={picked ? 'q-vb-cat on' : empty ? 'q-vb-cat empty' : 'q-vb-cat'}
                text={library.phase === 'ready' && empty ? text.noListsTip : undefined}
                aria-current={picked ? 'true' : undefined}
                aria-disabled={empty ? 'true' : undefined}
                onClick={() => {
                  if (library.phase === 'ready' && !empty) setSelected(type.key)
                }}
              >
                <span className="q-vb-name">{categoryLabel(type)}</span>
                <span className="q-vb-count">{library.phase === 'ready' ? count : library.phase === 'out' ? '—' : ''}</span>
              </Tip>
            )
          })}
        </nav>

        <div className="q-vb-pane">
          {selectedType ? (
            <div className="q-vb-table">
              <p className="q-vb-caption">{text.caption(categoryLabel(selectedType), counts.get(selectedType.key) ?? 0)}</p>
              <div role="row" className="q-vb-grid q-vb-headrow">
                {COLUMNS.map(({ key, number }) => {
                  const on = sort.key === key

                  return (
                    <span
                      key={key}
                      role="columnheader"
                      aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                      className={number ? 'q-vb-colhead number' : 'q-vb-colhead'}
                    >
                      <button type="button" className={on ? 'q-vb-sort on' : 'q-vb-sort'} onClick={() => setSort(nextSort(sort, key))}>
                        <span className="q-vb-collabel">{text.columns[key]}</span>
                        <span className="q-vb-arrow" aria-hidden="true">
                          {on ? (sort.dir === 1 ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    </span>
                  )
                })}
              </div>
              {rows.map((entry) => (
                <button key={entry.externalRef} type="button" className="q-vb-row q-vb-grid">
                  <span className="q-vb-nm">
                    <Tip as="span" className="q-vb-rowname" text={entry.title} whenClipped>
                      {entry.title}
                    </Tip>
                    {entry.tracked && (
                      <Tip className="q-vb-mine" text={text.inMyListsTip}>
                        {text.inMyLists}
                      </Tip>
                    )}
                  </span>
                  <span className="q-vb-status">
                    {statusChipData(entry.status ?? null) ? (
                      <Tip text={statusChipData(entry.status ?? null)?.tip}>
                        <StatusChip status={entry.status ?? null} short />
                      </Tip>
                    ) : (
                      <Tip className="q-vb-unknown" text={text.statusUnknown}>
                        —
                      </Tip>
                    )}
                  </span>
                  <span className="q-vb-items">{entry.itemCount ?? '—'}</span>
                  {entry.totalMinutes === undefined ? (
                    <span className="q-vb-time">—</span>
                  ) : (
                    <Tip className="q-vb-time" text={entry.minutesEstimated ? text.timeEstimatedTip : undefined}>
                      {`${entry.minutesEstimated ? '≈' : ''}${browserTime(entry.totalMinutes)}`}
                    </Tip>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="q-vb-empty">
              <span className="q-vb-art" aria-hidden="true">
                <Vault width={150} height={150} />
              </span>
              <h2 className="q-vb-empty-title">{library.phase === 'out' ? text.outTitle : text.chooseTitle}</h2>
              <p className="q-vb-empty-line">
                {library.phase === 'loading'
                  ? text.loading
                  : library.phase === 'out'
                    ? copy.quantum.vaultShelf.offline
                    : text.chooseLine(total, filled)}
              </p>
              {library.phase === 'out' && (
                <Button disabled={retrying} onClick={() => void tryAgain()}>
                  {text.tryAgain}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
