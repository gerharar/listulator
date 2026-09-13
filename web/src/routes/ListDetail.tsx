import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Modal } from '../components/Modal.js'
import { Progress } from '../components/Progress.js'
import { api, type ListItem, type MediaListDetail, type MediaType } from '../lib/api.js'
import { bookLanguageLabel } from '../lib/bookLanguage.js'
import { formatDuration } from '../formatDuration.js'
import { categoryLabel, copy } from '../locale/index.js'

export interface ItemGroupRow {
  kind: 'group'
  label: string
  items: ListItem[]
}

export interface SingleItemRow {
  kind: 'item'
  item: ListItem
}

export type ItemRow = ItemGroupRow | SingleItemRow

/**
 * Folds consecutive items sharing the same `group` label (task 6.6) into one
 * row; an ungrouped item, or one whose group differs from its predecessor's,
 * stays its own row. Presentation only — order and every item's own fields
 * pass through untouched, so a non-TV list (no item ever has a `group`)
 * comes back exactly as it went in: one `item` row per item.
 */
export function groupItems(items: ListItem[]): ItemRow[] {
  const rows: ItemRow[] = []

  for (const item of items) {
    const last = rows[rows.length - 1]

    if (item.group && last?.kind === 'group' && last.label === item.group) {
      last.items.push(item)
    } else if (item.group) {
      rows.push({ kind: 'group', label: item.group, items: [item] })
    } else {
      rows.push({ kind: 'item', item })
    }
  }

  return rows
}

/**
 * Moves the item at `itemId` one step up or down within its own group
 * (task 6.7) — null if the move would cross a season boundary (task 6.6's
 * resolved shared question) or run off either end of the list. Two items
 * are "the same group" when their `group` fields are `===`, which also
 * covers two `null`s: a non-TV list has no `group` on any item, so every
 * neighbor matches and reordering stays unrestricted, exactly as before.
 */
export function moveItem(
  items: ListItem[],
  itemId: string,
  direction: 'up' | 'down',
): ListItem[] | null {
  const index = items.findIndex((item) => item.id === itemId)
  if (index === -1) return null

  const swapIndex = direction === 'up' ? index - 1 : index + 1
  if (swapIndex < 0 || swapIndex >= items.length) return null
  if (items[swapIndex]!.group !== items[index]!.group) return null

  const next = [...items]
  ;[next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!]
  return next
}

/**
 * Moves `draggedId` to sit where `targetId` currently is (task 6.7) — null
 * for a no-op drop (same item) or one that would cross a season boundary:
 * a drop is only legal onto an item sharing the dragged one's `group`,
 * which — since a group is always a contiguous run — guarantees every
 * position the drop could land on on stays inside that same run.
 */
export function moveItemTo(
  items: ListItem[],
  draggedId: string,
  targetId: string,
): ListItem[] | null {
  if (draggedId === targetId) return null

  const dragged = items.find((item) => item.id === draggedId)
  const target = items.find((item) => item.id === targetId)
  if (!dragged || !target || dragged.group !== target.group) return null

  const withoutDragged = items.filter((item) => item.id !== draggedId)
  const targetIndex = withoutDragged.findIndex((item) => item.id === targetId)

  const next = [...withoutDragged]
  next.splice(targetIndex, 0, dragged)
  return next
}

function GroupHeader({
  label,
  items,
  collapsed,
  onToggle,
}: {
  label: string
  items: ListItem[]
  collapsed: boolean
  onToggle: () => void
}) {
  const consumed = items.filter((item) => item.consumedAt !== null).length

  return (
    <button
      type="button"
      className="group-header"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={
        collapsed ? copy.listDetail.expandGroup(label) : copy.listDetail.collapseGroup(label)
      }
    >
      <span className="group-header__caret" aria-hidden="true">
        {collapsed ? '▸' : '▾'}
      </span>
      <span className="group-header__label">{label}</span>
      <span className="group-header__count">
        {consumed}/{items.length}
      </span>
    </button>
  )
}

function Item({
  item,
  onToggle,
  onRemove,
  onEdit,
  canMoveUp,
  canMoveDown,
  onMove,
  isDropTarget,
  isDragging,
  onPointerDown,
}: {
  item: ListItem
  onToggle: (item: ListItem) => void
  onRemove: (item: ListItem) => void
  onEdit: (item: ListItem) => void
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (item: ListItem, direction: 'up' | 'down') => void
  isDropTarget: boolean
  isDragging: boolean
  onPointerDown: (event: React.PointerEvent, item: ListItem) => void
}) {
  const consumed = item.consumedAt !== null

  const rowClasses = ['item-row']
  if (isDropTarget) rowClasses.push('item-row--drop-target')
  if (isDragging) rowClasses.push('item-row--dragging')

  return (
    <li
      className={rowClasses.join(' ')}
      data-item-id={item.id}
      onPointerDown={(event) => onPointerDown(event, item)}
    >
      <span className="item__drag-handle" aria-hidden="true" title={copy.listDetail.dragHandle}>
        ⠿
      </span>
      <span className="item__move">
        <button
          type="button"
          className="item__move-button"
          onClick={() => onMove(item, 'up')}
          disabled={!canMoveUp}
          aria-label={copy.listDetail.moveUp(item.title)}
          title={copy.listDetail.moveUp(item.title)}
        >
          ▲
        </button>
        <button
          type="button"
          className="item__move-button"
          onClick={() => onMove(item, 'down')}
          disabled={!canMoveDown}
          aria-label={copy.listDetail.moveDown(item.title)}
          title={copy.listDetail.moveDown(item.title)}
        >
          ▼
        </button>
      </span>
      <button
        type="button"
        className={consumed ? 'item item--consumed' : 'item'}
        onClick={() => onToggle(item)}
        aria-pressed={consumed}
      >
        <span
          className={consumed ? 'item__box item__box--checked' : 'item__box'}
          aria-hidden="true"
        >
          {consumed ? '✕' : ''}
        </span>
        {item.source === 'manual' && (
          <span className="item__manual-badge" title={copy.listDetail.manualItemHint}>
            {copy.listDetail.manualItemBadge}
          </span>
        )}
        <span className="item__title">
          {item.title}
          {item.year ? ` (${item.year})` : ''}
        </span>
        {item.language && (
          <span
            className="item__language-badge"
            title={copy.listDetail.languageBadgeHint(bookLanguageLabel(item.language))}
          >
            {bookLanguageLabel(item.language)}
          </span>
        )}
        <span className="item__duration">
          {/* A leading ~ marks a guessed duration, so a number nobody verified
              never masquerades as fact. */}
          {item.timeToConsumeIsEstimated ? '~' : ''}
          {formatDuration(item.timeToConsumeMinutes)}
        </span>
      </button>
      <button
        type="button"
        className="item__edit"
        onClick={() => onEdit(item)}
        aria-label={copy.listDetail.editItem(item.title)}
        title={copy.listDetail.editItem(item.title)}
      >
        ✎
      </button>
      {/*
        No confirmation: pruning an import is the job this exists for, and
        twenty dialogs would make it miserable. Losing one item is cheap and
        re-addable, unlike deleting a whole list.
      */}
      <button
        type="button"
        className="item__remove"
        onClick={() => onRemove(item)}
        aria-label={copy.listDetail.removeItem(item.title)}
        title={copy.listDetail.removeItem(item.title)}
      >
        ✕
      </button>
    </li>
  )
}

/** Inline edit: title + duration + group, replacing the row it edits until saved or cancelled. */
function EditItemRow({
  item,
  onSave,
  onCancel,
  saving,
}: {
  item: ListItem
  onSave: (patch: { title: string; timeToConsumeMinutes: number; group: string | null }) => void
  onCancel: () => void
  saving: boolean
}) {
  const [title, setTitle] = useState(item.title)
  const [duration, setDuration] = useState(String(item.timeToConsumeMinutes))
  const [group, setGroup] = useState(item.group ?? '')

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const minutes = Number(duration)
    if (!title.trim() || !Number.isFinite(minutes) || minutes < 0) return
    onSave({ title: title.trim(), timeToConsumeMinutes: minutes, group: group.trim() || null })
  }

  return (
    <li className="item-row item-row--editing">
      <form className="item-edit" onSubmit={submit}>
        <input
          className="input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          autoFocus
        />
        <input
          className="input item-edit__duration"
          type="number"
          min={0}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
        />
        <input
          className="input item-edit__group"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
          placeholder={copy.listDetail.groupLabel}
          aria-label={copy.listDetail.groupLabel}
        />
        <button type="submit" className="button button--primary" disabled={saving}>
          {saving ? copy.listDetail.savingItem : copy.listDetail.saveItem}
        </button>
        <button type="button" className="button" onClick={onCancel} disabled={saving}>
          {copy.listDetail.cancelEdit}
        </button>
      </form>
    </li>
  )
}

export function ListDetail({ mediaTypes }: { mediaTypes: MediaType[] }) {
  const { listId } = useParams<{ listId: string }>()
  const navigate = useNavigate()
  // Carried from Overview's task-7.6 banner/badge link (router `state`, not
  // a URL param — a static cue only, no auto-triggered network call, so
  // there's no effect-ordering/StrictMode double-invoke risk to reason
  // about). Answers the confusion arriving with nothing on the page saying
  // why this list was highlighted ("did I open the wrong list?").
  const location = useLocation()
  const updateAvailable = Boolean(
    (location.state as { updateAvailable?: boolean } | null)?.updateAvailable,
  )
  const [list, setList] = useState<MediaListDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updates, setUpdates] = useState<Awaited<ReturnType<typeof api.checkForUpdates>> | null>(
    null,
  )
  const [checking, setChecking] = useState(false)
  // Off by default: a rescan should respect what you pruned. Ticking it is
  // the undo for deleting something by accident.
  const [includeDismissed, setIncludeDismissed] = useState(false)

  const [newItemTitle, setNewItemTitle] = useState('')
  const [newItemDuration, setNewItemDuration] = useState('')
  const [newItemGroup, setNewItemGroup] = useState('')
  const [addingItem, setAddingItem] = useState(false)

  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [savingItem, setSavingItem] = useState(false)

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletingList, setDeletingList] = useState(false)

  // All expanded by default, not persisted — resets whenever the viewed list
  // changes so a leftover collapse from a previous list can never carry over.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  useEffect(() => setCollapsedGroups(new Set()), [listId])

  function toggleGroup(label: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  async function applyReorder(nextItems: ListItem[]) {
    if (!listId || !list) return

    // Optimistic, like the checkbox and remove: a drag or a run of arrow
    // clicks should feel instant, not wait on a round trip each time.
    const previous = list
    setList({ ...list, items: nextItems })

    try {
      await api.reorderItems(
        listId,
        nextItems.map((item) => item.id),
      )
    } catch (cause) {
      setList(previous)
      setError(cause instanceof Error ? cause.message : copy.listDetail.reorderFailed)
    }
  }

  function moveItemByButton(item: ListItem, direction: 'up' | 'down') {
    if (!list) return
    const next = moveItem(list.items, item.id, direction)
    if (next) void applyReorder(next)
  }

  /**
   * Pointer-events reorder, not native HTML5 drag-and-drop (task 6.7):
   * the standalone app's Tauri WKWebView does not honor
   * `dataTransfer.dropEffect`/`effectAllowed` and never fires `drop` at all
   * — confirmed live (works in a plain browser tab, not in the desktop
   * app), the same class of gap as `window.confirm()` needing a real
   * `Modal` instead. Pointer events are a DOM-level API the webview
   * implements properly, so the same code now runs identically in both.
   *
   * Window-level listeners, not per-row handlers: the pointer needs
   * tracking across every row it passes over, not just the one it started
   * on. `startItems` is the list as of pointerdown and is used for the
   * whole gesture — nothing else mutates it mid-drag in this app's flow.
   * A small movement threshold before the first `setDraggedItemId` is what
   * keeps an ordinary click on the row (the toggle/edit/remove/move
   * buttons all live inside it) from ever registering as a drag: no
   * `preventDefault()` happens until real movement is seen, so a plain
   * click's own `click` event still fires on whichever button it landed on.
   */
  function handleItemPointerDown(event: React.PointerEvent, item: ListItem) {
    if (event.button !== 0 || !list) return

    const startX = event.clientX
    const startY = event.clientY
    const startItems = list.items
    let dragging = false

    function targetIdAt(x: number, y: number): string | undefined {
      const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-item-id]')
      return row?.dataset.itemId
    }

    function onMove(moveEvent: PointerEvent) {
      if (!dragging) {
        const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY)
        if (distance < 6) return
        dragging = true
        setDraggedItemId(item.id)
      }

      moveEvent.preventDefault()

      const targetId = targetIdAt(moveEvent.clientX, moveEvent.clientY)
      const target = targetId && startItems.find((entry) => entry.id === targetId)
      // Only within the dragged item's own group — the season boundary
      // this task's design question resolved.
      setDropTargetId(
        target && target.id !== item.id && target.group === item.group ? target.id : null,
      )
    }

    function onUp(upEvent: PointerEvent) {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)

      if (dragging) {
        const targetId = targetIdAt(upEvent.clientX, upEvent.clientY)
        const next = targetId ? moveItemTo(startItems, item.id, targetId) : null
        if (next) void applyReorder(next)
      }

      setDraggedItemId(null)
      setDropTargetId(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const load = useCallback(async () => {
    if (!listId) return

    try {
      setList(await api.list(listId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.listDetail.loadFailed)
    }
  }, [listId])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(item: ListItem) {
    if (!listId) return

    // Optimistic: the checkbox responds immediately, then the authoritative
    // stats arrive from the refetch. Reverting on failure keeps the UI honest.
    const previous = list
    setList((current) =>
      current
        ? {
            ...current,
            items: current.items.map((candidate) =>
              candidate.id === item.id
                ? {
                    ...candidate,
                    consumedAt: candidate.consumedAt ? null : new Date().toISOString(),
                  }
                : candidate,
            ),
          }
        : current,
    )

    try {
      await api.setConsumed(listId, item.id, item.consumedAt === null)
      await load()
    } catch {
      setList(previous)
      setError(copy.listDetail.saveFailed)
    }
  }

  async function removeItem(item: ListItem) {
    if (!listId || !list) return

    // Optimistic, like the checkbox: pruning a freshly imported list means
    // many deletes in a row, and a round trip between each would drag.
    const previous = list
    setList({ ...list, items: list.items.filter((candidate) => candidate.id !== item.id) })

    try {
      await api.deleteItem(listId, item.id)
      await load()
    } catch {
      setList(previous)
      setError(copy.listDetail.removeFailed(item.title))
    }
  }

  /**
   * Two steps on purpose: check reports what the source has gained, and
   * nothing is written until the button is pressed again. Adding
   * automatically would put back every item that was deliberately pruned
   * after an import.
   */
  async function checkForUpdates() {
    if (!listId) return

    setChecking(true)
    setError(null)
    setUpdates(null)

    try {
      setUpdates(await api.checkForUpdates(listId, includeDismissed))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.listDetail.checkFailed)
    } finally {
      setChecking(false)
    }
  }

  async function addUpdates() {
    if (!listId || !updates?.newItems.length) return

    setChecking(true)

    try {
      await api.importItems(listId, updates.newItems, 'import')
      setUpdates(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.listDetail.addFailed)
    } finally {
      setChecking(false)
    }
  }

  /**
   * An in-app confirmation rather than `window.confirm()`: Tauri's WKWebView
   * does not implement the native JS dialog delegate, so `confirm()` just
   * returns `false` with nothing shown — deleting a list looked like a
   * dead button. This works identically in the browser and the standalone
   * app.
   */
  async function confirmRemove() {
    if (!listId) return

    setDeletingList(true)
    setError(null)

    try {
      await api.deleteList(listId)
      void navigate('/')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.listDetail.deleteListFailed)
      setDeletingList(false)
      setConfirmingDelete(false)
    }
  }

  async function addItem(event: React.FormEvent) {
    event.preventDefault()
    if (!listId || !newItemTitle.trim()) return

    setAddingItem(true)
    setError(null)

    // Blank duration means "I don't know" — fall back to the category's own
    // default and flag it estimated, the same convention search-import and
    // manual list-creation already use (docs/DECISIONS.md).
    const typed = newItemDuration.trim() ? Number(newItemDuration) : undefined
    const known = typed !== undefined && Number.isFinite(typed) && typed >= 0

    try {
      await api.addItem(listId, {
        title: newItemTitle.trim(),
        timeToConsumeMinutes: known ? typed : (category?.defaultDurationMinutes ?? 30),
        timeToConsumeIsEstimated: !known,
        group: newItemGroup.trim() || null,
      })
      setNewItemTitle('')
      setNewItemDuration('')
      setNewItemGroup('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.listDetail.addItemFailed)
    } finally {
      setAddingItem(false)
    }
  }

  async function saveItem(
    item: ListItem,
    patch: { title: string; timeToConsumeMinutes: number; group: string | null },
  ) {
    if (!listId) return

    setSavingItem(true)
    setError(null)

    try {
      // A number someone just typed in by hand is no longer a guess.
      await api.updateItem(listId, item.id, { ...patch, timeToConsumeIsEstimated: false })
      setEditingItemId(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.listDetail.updateItemFailed)
    } finally {
      setSavingItem(false)
    }
  }

  function renderItemRow(item: ListItem) {
    if (!list) return null

    return item.id === editingItemId ? (
      <EditItemRow
        key={item.id}
        item={item}
        saving={savingItem}
        onSave={(patch) => void saveItem(item, patch)}
        onCancel={() => setEditingItemId(null)}
      />
    ) : (
      <Item
        key={item.id}
        item={item}
        onToggle={(target) => void toggle(target)}
        onRemove={(target) => void removeItem(target)}
        onEdit={(target) => setEditingItemId(target.id)}
        canMoveUp={moveItem(list.items, item.id, 'up') !== null}
        canMoveDown={moveItem(list.items, item.id, 'down') !== null}
        onMove={moveItemByButton}
        isDropTarget={dropTargetId === item.id}
        isDragging={draggedItemId === item.id}
        onPointerDown={handleItemPointerDown}
      />
    )
  }

  if (error && !list) return <p className="notice notice--error">{error}</p>
  if (!list) return <p className="muted">{copy.app.loading}</p>

  const category = mediaTypes.find((mediaType) => mediaType.key === list.mediaType)
  const { stats } = list

  return (
    <>
      <Link className="back" to="/">
        {copy.listDetail.back}
      </Link>

      <div className="page__header">
        <div>
          <h1 className="page__title">{list.title}</h1>
          <p className="small faint">{category ? categoryLabel(category) : list.mediaType}</p>
        </div>
        <div className="page__actions">
          {/* Only lists built from a source have anything to check against. */}
          {list.externalRef && (
            <>
              <label className="checkbox small faint" title={copy.listDetail.reAddDeletedHint}>
                <input
                  type="checkbox"
                  checked={includeDismissed}
                  onChange={(event) => setIncludeDismissed(event.target.checked)}
                />
                {copy.listDetail.reAddDeleted}
              </label>
              <button
                type="button"
                className="button"
                onClick={() => void checkForUpdates()}
                disabled={checking}
              >
                {checking
                  ? copy.listDetail.checking
                  : updateAvailable
                    ? copy.listDetail.updateList
                    : copy.listDetail.checkForUpdates}
              </button>
            </>
          )}
          <button type="button" className="button" onClick={() => setConfirmingDelete(true)}>
            {copy.listDetail.deleteList}
          </button>
        </div>
      </div>

      {updateAvailable && (
        <p className="notice notice--info">{copy.listDetail.updateAvailableNotice}</p>
      )}

      {error && <p className="notice notice--error">{error}</p>}

      {updates && (
        <div className="notice">
          {updates.newItems.length === 0 ? (
            <p className="muted">
              {copy.listDetail.upToDate(updates.upstreamCount)}
              {!includeDismissed &&
                updates.dismissedCount > 0 &&
                copy.listDetail.heldBack(updates.dismissedCount)}
            </p>
          ) : (
            <>
              <p>
                <strong>{copy.listDetail.foundCount(updates.newItems.length)}</strong>{' '}
                {includeDismissed ? copy.listDetail.foundToPutBack : copy.listDetail.foundNew}
              </p>
              <p className="small muted">
                {updates.newItems
                  .slice(0, 12)
                  .map((item) => item.title)
                  .join(' · ')}
                {updates.newItems.length > 12
                  ? copy.listDetail.andMore(updates.newItems.length - 12)
                  : ''}
              </p>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void addUpdates()}
                disabled={checking}
              >
                {copy.listDetail.addToList(updates.newItems.length)}
              </button>
            </>
          )}
        </div>
      )}

      <section className="panel">
        <div className="summary">
          <Progress
            percent={stats.completionPercent}
            large
            label={copy.listDetail.percentComplete(stats.completionPercent)}
          />
          <span className="summary__figure">
            {stats.consumedItems}/{stats.totalItems}
          </span>
          <span className="muted">{stats.completionPercent}%</span>
          <span className="muted">
            {stats.timeRemainingMinutes > 0
              ? copy.listDetail.timeLeft(formatDuration(stats.timeRemainingMinutes))
              : stats.totalItems > 0
                ? copy.listDetail.finished
                : copy.listDetail.nothingToDo}
          </span>
        </div>

        {list.items.length === 0 ? (
          <p className="panel__empty">{copy.listDetail.empty}</p>
        ) : (
          <ul className="rows items">
            {groupItems(list.items).map((row) =>
              row.kind === 'item' ? (
                renderItemRow(row.item)
              ) : (
                <li key={row.items[0]!.id} className="item-group">
                  <GroupHeader
                    label={row.label}
                    items={row.items}
                    collapsed={collapsedGroups.has(row.label)}
                    onToggle={() => toggleGroup(row.label)}
                  />
                  {!collapsedGroups.has(row.label) && (
                    <ul className="rows items item-group__items">
                      {row.items.map((item) => renderItemRow(item))}
                    </ul>
                  )}
                </li>
              ),
            )}
          </ul>
        )}

        <form className="item-add" onSubmit={(event) => void addItem(event)}>
          <input
            className="input"
            value={newItemTitle}
            onChange={(event) => setNewItemTitle(event.target.value)}
            placeholder={copy.listDetail.addItemTitleLabel}
            aria-label={copy.listDetail.addItemTitleLabel}
          />
          <input
            className="input item-add__duration"
            type="number"
            min={0}
            value={newItemDuration}
            onChange={(event) => setNewItemDuration(event.target.value)}
            placeholder={copy.listDetail.addItemDurationLabel}
            aria-label={copy.listDetail.addItemDurationLabel}
          />
          <input
            className="input item-add__group"
            value={newItemGroup}
            onChange={(event) => setNewItemGroup(event.target.value)}
            placeholder={copy.listDetail.groupLabel}
            aria-label={copy.listDetail.groupLabel}
          />
          <button
            type="submit"
            className="button button--primary"
            disabled={addingItem || !newItemTitle.trim()}
          >
            {addingItem ? copy.listDetail.addingItem : copy.listDetail.addItem}
          </button>
        </form>
      </section>

      {confirmingDelete && (
        <Modal onClose={() => !deletingList && setConfirmingDelete(false)}>
          <p>{copy.listDetail.deleteListConfirm(list.title)}</p>
          <div className="modal__actions">
            <button
              type="button"
              className="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={deletingList}
            >
              {copy.listDetail.cancelEdit}
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void confirmRemove()}
              disabled={deletingList}
            >
              {deletingList ? copy.listDetail.deletingList : copy.listDetail.confirmDeleteList}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
