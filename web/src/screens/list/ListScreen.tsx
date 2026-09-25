import './ListScreen.css'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { EllipsisVertical, Pencil } from 'lucide-react'
import { formatDuration } from '../../formatDuration.js'
import { api, type ListGroup, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { getPreferencesStore } from '../../lib/preferences/store.js'
import { categoryLabel, copy } from '../../locale/index.js'
import { Banner } from '../../components/quantum/Banner/Banner.js'
import { Button, IconButton } from '../../components/quantum/Button/Button.js'
import { ErrorBlock } from '../../components/quantum/ErrorBlock/ErrorBlock.js'
import { ErrorStrip } from '../../components/quantum/ErrorStrip/ErrorStrip.js'
import { HeaderPlate } from '../../components/quantum/HeaderPlate/HeaderPlate.js'
import { ProgressSentence } from '../../components/quantum/ProgressSentence/ProgressSentence.js'
import { useLiveRegion } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'
import { Spinner } from '../../components/quantum/Spinner/Spinner.js'
import { StatusChip } from '../../components/quantum/StatusChip/StatusChip.js'
import { useToast } from '../../components/quantum/Toast/Toast.js'
import {
  defaultCollapsed,
  loadCollapsed,
  loadFocus,
  saveCollapsed,
  saveFocus,
} from './collapse.js'
import { AddItemForm, type NewItemInput } from './AddItemForm.js'
import { GroupRow } from './GroupRow.js'
import { invertPatch, type ItemPatch } from './itemActions.js'
import { ItemEditPopover } from './ItemEditPopover.js'
import { ItemInfoCard } from './ItemInfoCard.js'
import { ItemRow } from './ItemRow.js'
import { buildSpine, listTotals } from './spine.js'
import { UpdatesCard } from './UpdatesCard.js'

export interface ListScreenProps {
  listId: string
  /** The live registry, for the category's label. */
  mediaTypes: readonly MediaType[]
  /** The Home banner sent us here because the source has news: the button says "Update list" (a cue only — nothing is checked until it is pressed). */
  updateAvailable?: boolean
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
export function ListScreen({ listId, mediaTypes, updateAvailable = false }: ListScreenProps) {
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
      updateAvailable={updateAvailable}
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
  updateAvailable: boolean
  error: string | null
  setError: (message: string | null) => void
  reload: () => void
}

/** How long a row stays washed after it was added, moved or restored (design: row pulse). */
const PULSE_MS = 1900

type OpenPopover = { kind: 'info' | 'edit'; itemId: string; anchor: HTMLElement }

type CheckResult = Awaited<ReturnType<typeof api.checkForUpdates>>
/** The Check for updates popover: open once a check has an answer. */
type UpdatesPopover = { anchor: HTMLElement; result: CheckResult; includeDismissed: boolean }

function ListView({
  listId,
  list: loaded,
  initialCollapsed,
  initialFocusId,
  mediaTypes,
  updateAvailable,
  error,
  setError,
  reload,
}: ListViewProps) {
  const text = copy.quantum.list
  const actions = text.itemActions
  const updatesText = text.updates
  const { showToast } = useToast()
  const { announce } = useLiveRegion()
  const [items, setItems] = useState<ListItem[]>(loaded.items)
  const [groups, setGroups] = useState<ListGroup[]>(loaded.groups)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(initialCollapsed)
  const [focusId, setFocusId] = useState<string | undefined>(initialFocusId)
  const [popover, setPopover] = useState<OpenPopover | null>(null)
  const [pulseId, setPulseId] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [adding, setAdding] = useState(false)
  const [updates, setUpdates] = useState<UpdatesPopover | null>(null)
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const spine = useRef<HTMLDivElement>(null)

  useEffect(() => () => clearTimeout(pulseTimer.current), [])

  const mediaType = mediaTypes.find((entry) => entry.key === loaded.mediaType)
  const defaultMinutes = mediaType?.defaultDurationMinutes ?? 30
  const totals = listTotals(items)
  const newCount = items.filter((entry) => entry.isNew).length
  const units = useMemo(() => buildSpine(items, groups), [items, groups])
  const groupNames = useMemo(() => groups.map((group) => group.name), [groups])

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

  function pulse(itemId: string) {
    clearTimeout(pulseTimer.current)
    setPulseId(itemId)
    pulseTimer.current = setTimeout(() => setPulseId(null), PULSE_MS)
  }

  /** Takes the server's own order and groups: placement and new groups are its call. */
  async function refresh(): Promise<MediaListDetail> {
    const fresh = await api.list(listId)
    setItems(fresh.items)
    setGroups(fresh.groups)

    return fresh
  }

  function openGroup(name: string) {
    if (!collapsed.has(name)) return
    const next = new Set(collapsed)
    next.delete(name)
    setCollapsed(next)
    void saveCollapsed(getPreferencesStore(), listId, next)
  }

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

  async function addItem(input: NewItemInput) {
    const known = input.minutes !== null
    const group = input.group === '' ? null : input.group
    const created = await api.addItem(listId, {
      title: input.title,
      timeToConsumeMinutes: input.minutes ?? defaultMinutes,
      timeToConsumeIsEstimated: !known,
      group,
    })

    const fresh = await refresh()
    // A collapsed group the item went into opens, or the pulse would mark nothing.
    const placed = fresh.items.find((entry) => entry.id === created.id)
    if (placed?.group) openGroup(placed.group)
    pulse(created.id)
    announce(actions.added(input.title, placed?.group ?? group))
  }

  async function removeItem(item: ListItem) {
    const previous = items
    setError(null)
    setPopover(null)
    setItems((current) => current.filter((entry) => entry.id !== item.id))

    try {
      const restore = await api.deleteItem(listId, item.id)
      showToast({
        text: actions.removed(item.title),
        actionLabel: actions.undo,
        onAction: () => void undoRemove(restore, item),
      })
    } catch {
      setItems(previous)
      setError(actions.removeFailed(item.title))
    }
  }

  async function undoRemove(restore: Parameters<typeof api.restoreItem>[1], item: ListItem) {
    try {
      await api.restoreItem(listId, restore)
      const fresh = await refresh()
      const placed = fresh.items.find((entry) => entry.id === item.id)
      if (placed?.group) openGroup(placed.group)
      pulse(item.id)
      announce(actions.restored(item.title))
    } catch {
      setError(actions.undoFailed)
    }
  }

  async function saveEdit(item: ListItem, patch: ItemPatch, via: 'save' | 'clickaway') {
    setPopover(null)
    setError(null)

    try {
      await api.updateItem(listId, item.id, patch)
      const fresh = await refresh()
      const placed = fresh.items.find((entry) => entry.id === item.id)
      if (placed?.group) openGroup(placed.group)

      // The click-away is the safety net, so it is the one that says what it did.
      if (via === 'clickaway') {
        const title = patch.title ?? item.title
        showToast({
          text: actions.saved(title),
          actionLabel: actions.undo,
          onAction: () => void undoEdit(item, patch),
        })
      }
    } catch {
      setError(actions.editFailed)
    }
  }

  async function undoEdit(item: ListItem, patch: ItemPatch) {
    try {
      await api.updateItem(listId, item.id, invertPatch(item, patch))
      await refresh()
      pulse(item.id)
    } catch {
      setError(actions.undoFailed)
    }
  }

  /** Asks the source what it has that the list does not; writes nothing. */
  async function checkForUpdates(anchor: HTMLElement, includeDismissed: boolean) {
    setChecking(true)
    setError(null)

    try {
      const result = await api.checkForUpdates(listId, includeDismissed)
      setUpdates({ anchor, result, includeDismissed })
    } catch (cause) {
      setUpdates(null)
      setError(cause instanceof Error ? cause.message : updatesText.checkFailed)
    } finally {
      setChecking(false)
    }
  }

  /** The add half of the two steps: what arrives is flagged NEW until Mark all seen. */
  async function addUpdates() {
    if (!updates?.result.newItems.length) return
    const count = updates.result.newItems.length
    setAdding(true)
    setError(null)

    try {
      await api.importItems(listId, updates.result.newItems, 'import', true)
      await refresh()
      setUpdates(null)
      announce(updatesText.added(count))
    } catch {
      setError(updatesText.addFailed)
    } finally {
      setAdding(false)
    }
  }

  async function markAllSeen() {
    setError(null)

    try {
      await api.markSeen(listId)
      setItems((current) => current.map((entry) => ({ ...entry, isNew: false })))
      announce(updatesText.markedSeen)
    } catch {
      setError(updatesText.markSeenFailed)
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

  const itemRow = (entry: ListItem, grouped: boolean) => (
    <ItemRow
      key={entry.id}
      item={entry}
      grouped={grouped}
      focusable={tabStop === entry.id}
      minutesWidth={minutesWidth}
      pulse={pulseId === entry.id}
      onToggle={(row) => void toggleItem(row)}
      onFocus={(row) => remember(row.id)}
      onInfo={(row, anchor) => setPopover({ kind: 'info', itemId: row.id, anchor })}
      onEdit={(row, anchor) => setPopover({ kind: 'edit', itemId: row.id, anchor })}
      onRemove={(row) => void removeItem(row)}
    />
  )

  const popoverItem = popover ? items.find((entry) => entry.id === popover.itemId) : undefined

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
            {/* Only a list built from a source has anything to check against. */}
            {loaded.externalRef && (
              <Button
                size="sm"
                disabled={checking}
                onClick={(event) => void checkForUpdates(event.currentTarget, updates?.includeDismissed ?? false)}
              >
                {checking
                  ? updatesText.checking
                  : updateAvailable
                    ? updatesText.updateList
                    : text.checkForUpdates}
              </Button>
            )}
            <Button size="sm" disabled title={text.comingSoon}>
              {text.order}
            </Button>
            <IconButton label={text.more} title={text.comingSoon} disabled>
              <EllipsisVertical width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      </div>

      {newCount > 0 && (
        // The banner's one action is Mark all seen, a secondary button (design-system/components/Banner).
        <Banner
          onDismiss={() => void markAllSeen()}
          dismissLabel={updatesText.markAllSeen}
          actionVariant="secondary"
        >
          {updatesText.newBand(newCount)}
        </Banner>
      )}

      {error && (
        <div className="q-list-error">
          <ErrorStrip message={error} onRetry={reload} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="q-list-body" ref={spine} onKeyDown={onKeyDown}>
        {units.length === 0 && <p className="q-list-empty">{text.empty}</p>}
        {units.map((unit) =>
          unit.kind === 'item' ? (
            itemRow(unit.item, false)
          ) : (
            <div key={unit.group.id} className="q-list-block">
              <GroupRow
                block={unit}
                collapsed={collapsed.has(unit.group.name)}
                focusable={tabStop === unit.group.id}
                onToggle={toggleGroup}
                onFocus={remember}
              />
              {!collapsed.has(unit.group.name) && unit.items.map((entry) => itemRow(entry, true))}
            </div>
          ),
        )}
        <AddItemForm groups={groupNames} defaultMinutes={defaultMinutes} onAdd={addItem} />
      </div>

      {updates && (
        <Popover open anchorEl={updates.anchor} onDismiss={() => setUpdates(null)} width={340}>
          <UpdatesCard
            result={updates.result}
            includeDismissed={updates.includeDismissed}
            adding={adding}
            onIncludeDismissedChange={(include) => void checkForUpdates(updates.anchor, include)}
            onAdd={() => void addUpdates()}
          />
        </Popover>
      )}
      {popover?.kind === 'info' && popoverItem && (
        <Popover open anchorEl={popover.anchor} onDismiss={() => setPopover(null)} width={320}>
          <ItemInfoCard item={popoverItem} />
        </Popover>
      )}
      {popover?.kind === 'edit' && popoverItem && (
        <ItemEditPopover
          key={popoverItem.id}
          item={popoverItem}
          groups={groupNames}
          anchorEl={popover.anchor}
          onCommit={(patch, via) => void saveEdit(popoverItem, patch, via)}
          onDiscard={() => setPopover(null)}
        />
      )}
    </div>
  )
}
