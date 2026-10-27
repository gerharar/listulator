import { Tip } from '../Tooltip/Tip.js'
import './VaultBrowser.css'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Vault, X } from 'lucide-react'
import type { LibraryBrowserEntry } from '../../../../../server/src/ingestion/customLists.js'
import { api, type MediaType } from '../../../lib/api.js'
import { categoryLabel, copy, sortCategories } from '../../../locale/index.js'
import { Button, IconButton } from '../Button/Button.js'
import { HeaderPlate } from '../HeaderPlate/HeaderPlate.js'
import { useLayerStack } from '../layerStack/LayerStackContext.js'
import { StatusChip, statusChipData } from '../StatusChip/StatusChip.js'
import { previewPath } from '../../../lib/preview.js'
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

/** Where ↑/↓/Home/End take the focus among `items`, or nothing for another key. A move stops at the ends. */
function moveTarget(key: string, items: readonly HTMLElement[], current: HTMLElement): HTMLElement | undefined {
  const at = items.indexOf(current)
  if (key === 'ArrowDown') return items[Math.min(items.length - 1, at + 1)]
  if (key === 'ArrowUp') return items[Math.max(0, at - 1)]
  if (key === 'Home') return items[0]
  if (key === 'End') return items[items.length - 1]

  return undefined
}

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
  /** The row last focused: the table's one tab stop (roving tabindex); the first row when it is not among the rows, as after a category change. */
  const [lastRow, setLastRow] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const captionId = useId()

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
  // The column's one tab stop: the selected category, else the first with lists. None while nothing can be picked (loading, out of reach, or no
  // list at all): a stop that leads only to disabled items is a dead end on the way to the one control that works (design, 2026-10-27).
  const firstPickable = library.phase === 'ready' ? ordered.find((type) => (counts.get(type.key) ?? 0) > 0) : undefined
  const columnStop = (selectedType ?? firstPickable)?.key
  const rows = useMemo(
    () => (library.phase === 'ready' && selected !== null ? sortRows(library.entries.filter((entry) => entry.category === selected), sort) : []),
    [library, selected, sort],
  )
  const rowStop = rows.some((entry) => entry.externalRef === lastRow) ? lastRow : rows[0]?.externalRef

  /** Picks a category: a new table starts at its first row. */
  function choose(key: string) {
    if (key !== selected) setLastRow(null)
    setSelected(key)
  }

  /** A row opens the standard List Preview over the browser; Esc or ✕ comes back here with the category and the sort as they were. Nothing is added until Add This List. */
  function preview(entry: LibraryBrowserEntry) {
    layerStack.push({
      id: `preview-${entry.externalRef}`,
      kind: 'preview',
      tabLabel: () => copy.quantum.search.previewTab(entry.title),
      content: previewPath({
        mediaType: entry.category,
        externalRef: entry.externalRef,
        title: entry.title,
        options: {},
        ...(entry.trackedListId !== undefined ? { trackedListId: entry.trackedListId } : {}),
      }),
    })
  }

  /** What a key can reach in this layer: the categories, or the rows (not a category that cannot be picked). */
  const reachable = (selector: string): HTMLElement[] =>
    [...(body.current?.querySelectorAll<HTMLElement>(selector) ?? [])].filter((element) => element.getAttribute('aria-disabled') !== 'true')

  /** The column as a file manager has it: ↑/↓/Home/End move and select, → crosses to the first row. */
  function onColumnKey(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement
    if (!target.matches('[data-vcat]')) return

    if (event.key === 'ArrowRight') {
      const first = reachable('[data-vrow]')[0]
      if (first) {
        event.preventDefault()
        first.focus()
      }
      return
    }

    const to = moveTarget(event.key, reachable('[data-vcat]'), target)
    if (!to) return
    event.preventDefault()
    to.focus()
    if (library.phase === 'ready' && to.dataset['vcat'] !== undefined) choose(to.dataset['vcat'])
  }

  /** The rows: ↑/↓/Home/End move, ← goes back to the selected category; Enter opens the Preview (a button's own click). */
  function onRowsKey(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement
    if (!target.matches('[data-vrow]')) return

    if (event.key === 'ArrowLeft') {
      const category = body.current?.querySelector<HTMLElement>('[data-vcat][aria-current]')
      if (category) {
        event.preventDefault()
        category.focus()
      }
      return
    }

    const to = moveTarget(event.key, reachable('[data-vrow]'), target)
    if (!to) return
    event.preventDefault()
    to.focus()
  }

  // Set by Try Again: when the answer comes and the button is gone, the focus is nowhere, so it goes to the column's new stop.
  const retried = useRef(false)
  useEffect(() => {
    if (library.phase !== 'ready' || !retried.current) return
    retried.current = false
    const active = document.activeElement
    if (!active || active === document.body) body.current?.querySelector<HTMLElement>('[data-vcat][tabindex="0"]')?.focus()
  }, [library])

  async function tryAgain() {
    retried.current = true
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

      <div className="q-vb-body" ref={body}>
        <nav className="q-vb-column" aria-label={text.categoriesLabel} onKeyDown={onColumnKey}>
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
                // A category that cannot be picked says why to a screen reader too.
                describe
                data-vcat={type.key}
                aria-current={picked ? 'true' : undefined}
                aria-disabled={empty || library.phase === 'loading' ? 'true' : undefined}
                // One tab stop for the column; the arrow keys move between the others.
                tabIndex={type.key === columnStop ? 0 : -1}
                onClick={(event) => {
                  // Safari does not focus a button on a click, and the arrow keys need the focus here.
                  event.currentTarget.focus()
                  if (library.phase === 'ready' && !empty) choose(type.key)
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
            <div className="q-vb-table" role="group" aria-labelledby={captionId} onKeyDown={onRowsKey}>
              <p className="q-vb-caption" id={captionId}>{text.caption(categoryLabel(selectedType), counts.get(selectedType.key) ?? 0)}</p>
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
                <button
                  key={entry.externalRef}
                  type="button"
                  className="q-vb-row q-vb-grid"
                  data-vrow=""
                  tabIndex={entry.externalRef === rowStop ? 0 : -1}
                  onFocus={() => setLastRow(entry.externalRef)}
                  onClick={() => preview(entry)}
                >
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
              {/* A polite live region: Loading and out of reach are announced without a tab stop (design, 2026-10-27). */}
              <div className="q-vb-message" role="status">
                <h2 className="q-vb-empty-title">{library.phase === 'out' ? text.outTitle : text.chooseTitle}</h2>
                <p className="q-vb-empty-line">
                  {library.phase === 'loading'
                    ? text.loading
                    : library.phase === 'out'
                      ? copy.quantum.vaultShelf.offline
                      : text.chooseLine(total, filled)}
                </p>
              </div>
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
