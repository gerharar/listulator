import './ListScreen.css'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { EllipsisVertical, Pencil } from 'lucide-react'
import { formatDuration } from '../../formatDuration.js'
import { api, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { getPreferencesStore } from '../../lib/preferences/store.js'
import { categoryLabel, copy } from '../../locale/index.js'
import { Button, IconButton } from '../../components/quantum/Button/Button.js'
import { ErrorBlock } from '../../components/quantum/ErrorBlock/ErrorBlock.js'
import { ErrorStrip } from '../../components/quantum/ErrorStrip/ErrorStrip.js'
import { HeaderPlate } from '../../components/quantum/HeaderPlate/HeaderPlate.js'
import { ProgressSentence } from '../../components/quantum/ProgressSentence/ProgressSentence.js'
import { Spinner } from '../../components/quantum/Spinner/Spinner.js'
import { StatusChip } from '../../components/quantum/StatusChip/StatusChip.js'
import {
  defaultCollapsed,
  loadCollapsed,
  loadFocus,
  saveCollapsed,
  saveFocus,
} from './collapse.js'
import { GroupRow } from './GroupRow.js'
import { ItemRow } from './ItemRow.js'
import { buildSpine, listTotals } from './spine.js'

export interface ListScreenProps {
  listId: string
  /** The live registry, for the category's label. */
  mediaTypes: readonly MediaType[]
}

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; list: MediaListDetail; collapsed: ReadonlySet<string>; focusId: string | undefined }

/**
 * The list layer (design: "List detail", task 10.20): the header — category,
 * name and status, description, cell bar, progress sentence — and the spine of
 * group and item rows. Read-only apart from ticking items done; the header's
 * other actions (edit, updates, order, more) arrive with 10.21–10.25 and show
 * as disabled until then.
 *
 * Ticking is optimistic: the row and the header sentence change at once, and
 * roll back if the server refuses. Which groups are collapsed and which row was
 * last focused are remembered per list (D5); a Mega list's groups arrive
 * collapsed (C3).
 */
export function ListScreen({ listId, mediaTypes }: ListScreenProps) {
  const text = copy.quantum.list
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)

  const fetchList = useCallback(async () => {
    request.current += 1
    const mine = request.current
    setLoad({ state: 'loading' })

    try {
      const list = await api.list(listId)
      const store = getPreferencesStore()
      const collapsed = await loadCollapsed(store, listId, () =>
        defaultCollapsed(
          list.mediaType,
          list.groups.map((group) => group.name),
        ),
      )
      const focusId = await loadFocus(store, listId)
      if (request.current === mine) setLoad({ state: 'ready', list, collapsed, focusId })
    } catch (cause) {
      if (request.current === mine) {
        setLoad({
          state: 'error',
          message: cause instanceof Error ? cause.message : text.loadFailedHeadline,
        })
      }
    }
  }, [listId, text.loadFailedHeadline])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  if (load.state === 'loading') {
    return (
      <div className="q-list">
        <div className="q-list-progress">
          <Spinner label={text.loading} />
          <span>{text.loading}</span>
        </div>
      </div>
    )
  }

  if (load.state === 'error') {
    return (
      <div className="q-list">
        <div className="q-list-body">
          <ErrorBlock
            headline={text.loadFailedHeadline}
            explanation={load.message}
            action={{ label: text.retry, onClick: () => void fetchList() }}
          />
        </div>
      </div>
    )
  }

  return (
    <ListView
      listId={listId}
      list={load.list}
      initialCollapsed={load.collapsed}
      initialFocusId={load.focusId}
      mediaTypes={mediaTypes}
      error={error}
      setError={setError}
      reload={() => void fetchList()}
    />
  )
}

interface ListViewProps {
  listId: string
  list: MediaListDetail
  initialCollapsed: ReadonlySet<string>
  initialFocusId: string | undefined
  mediaTypes: readonly MediaType[]
  error: string | null
  setError: (message: string | null) => void
  reload: () => void
}

function ListView({
  listId,
  list: loaded,
  initialCollapsed,
  initialFocusId,
  mediaTypes,
  error,
  setError,
  reload,
}: ListViewProps) {
  const text = copy.quantum.list
  const [items, setItems] = useState<ListItem[]>(loaded.items)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(initialCollapsed)
  const [focusId, setFocusId] = useState<string | undefined>(initialFocusId)
  const spine = useRef<HTMLDivElement>(null)

  const mediaType = mediaTypes.find((entry) => entry.key === loaded.mediaType)
  const totals = listTotals(items)
  const units = useMemo(() => buildSpine(items, loaded.groups), [items, loaded.groups])

  // The rows that are on screen, in order: what the arrow keys walk.
  const visible = useMemo(() => {
    const ids: string[] = []
    for (const unit of units) {
      if (unit.kind === 'item') ids.push(unit.item.id)
      else {
        ids.push(unit.group.id)
        if (!collapsed.has(unit.group.name)) ids.push(...unit.items.map((entry) => entry.id))
      }
    }

    return ids
  }, [units, collapsed])
  const tabStop = focusId && visible.includes(focusId) ? focusId : visible[0]

  const minutesWidth = Math.max(4, ...items.map((entry) => formatDuration(entry.timeToConsumeMinutes).length)) + 1

  function toggleGroup(name: string) {
    const next = new Set(collapsed)
    if (!next.delete(name)) next.add(name)
    setCollapsed(next)
    void saveCollapsed(getPreferencesStore(), listId, next)
  }

  function remember(rowId: string) {
    setFocusId(rowId)
    void saveFocus(getPreferencesStore(), listId, rowId)
  }

  async function toggleItem(item: ListItem) {
    const previous = items
    const nowDone = item.consumedAt === null
    setError(null)
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, consumedAt: nowDone ? new Date().toISOString() : null }
          : entry,
      ),
    )

    try {
      await api.setConsumed(listId, item.id, nowDone)
    } catch {
      setItems(previous)
      setError(copy.listDetail.saveFailed)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const current = (event.target as HTMLElement).closest<HTMLElement>('[data-row-id]')
    if (!current) return

    const index = visible.indexOf(current.dataset['rowId']!)
    const target = visible[index + (event.key === 'ArrowDown' ? 1 : -1)]
    if (target === undefined) return

    event.preventDefault()
    spine.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(target)}"]`)?.focus()
  }

  return (
    <div className="q-list">
      <div className="q-list-head">
        <HeaderPlate side="right" seed={1} marks />
        <div className="q-list-top">
          <div className="q-list-titles">
            <p className="q-kicker">{mediaType ? categoryLabel(mediaType) : loaded.mediaType}</p>
            <h1 className="q-list-title">
              {loaded.title}
              <StatusChip status={loaded.status} />
              <IconButton label={text.editList} title={text.comingSoon} disabled>
                <Pencil width={15} height={15} strokeWidth={1.9} aria-hidden="true" />
              </IconButton>
            </h1>
            {loaded.description && <p className="q-list-description">{loaded.description}</p>}
            <ProgressSentence
              done={totals.done}
              total={totals.total}
              minutesLeft={totals.minutesLeft}
              status={loaded.status}
              size="header"
            />
          </div>
          <div className="q-list-actions">
            <Button size="sm" disabled title={text.comingSoon}>
              {text.checkForUpdates}
            </Button>
            <Button size="sm" disabled title={text.comingSoon}>
              {text.order}
            </Button>
            <IconButton label={text.more} title={text.comingSoon} disabled>
              <EllipsisVertical width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      </div>

      {error && (
        <div className="q-list-error">
          <ErrorStrip message={error} onRetry={reload} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="q-list-body" ref={spine} onKeyDown={onKeyDown}>
        {units.length === 0 && <p className="q-list-empty">{text.empty}</p>}
        {units.map((unit) =>
          unit.kind === 'item' ? (
            <ItemRow
              key={unit.item.id}
              item={unit.item}
              grouped={false}
              focusable={tabStop === unit.item.id}
              minutesWidth={minutesWidth}
              onToggle={(entry) => void toggleItem(entry)}
              onFocus={(entry) => remember(entry.id)}
            />
          ) : (
            <div key={unit.group.id} className="q-list-block">
              <GroupRow
                block={unit}
                collapsed={collapsed.has(unit.group.name)}
                focusable={tabStop === unit.group.id}
                onToggle={toggleGroup}
                onFocus={remember}
              />
              {!collapsed.has(unit.group.name) &&
                unit.items.map((entry) => (
                  <ItemRow
                    key={entry.id}
                    item={entry}
                    grouped
                    focusable={tabStop === entry.id}
                    minutesWidth={minutesWidth}
                    onToggle={(row) => void toggleItem(row)}
                    onFocus={(row) => remember(row.id)}
                  />
                ))}
            </div>
          ),
        )}
      </div>
    </div>
  )
}
