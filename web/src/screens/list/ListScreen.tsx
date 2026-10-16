import './ListScreen.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { EllipsisVertical, RefreshCw, X } from 'lucide-react'
import { ApiError, api, type ListGroup, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { downloadText } from '../../lib/downloadText.js'
import { getPendingUpdates, usePendingMap, type PendingUpdates } from '../../lib/pendingUpdates.js'
import { applyUpdate, checkList } from '../../lib/updateCheck.js'
import { exportFileName, exportList } from '../../lib/exportList.js'
import { notifyListsChanged } from '../../lib/listsChanged.js'
import { saveLastOpened } from '../../lib/lastOpened.js'
import { usePolling } from '../../lib/usePolling.js'
import { countRuntimesPending, mergeArrivedRuntimes } from './runtimePending.js'
import { countLinksPending, mergeArrivedLinks } from './linkPending.js'
import { getPreferencesStore } from '../../lib/preferences/store.js'
import { categoryLabel, copy, joinSentences } from '../../locale/index.js'
import { Banner } from '../../components/quantum/Banner/Banner.js'
import { IconButton } from '../../components/quantum/Button/Button.js'
import { ErrorBlock } from '../../components/quantum/ErrorBlock/ErrorBlock.js'
import { ErrorStrip } from '../../components/quantum/ErrorStrip/ErrorStrip.js'
import { HeaderPlate } from '../../components/quantum/HeaderPlate/HeaderPlate.js'
import { ProgressSentence } from '../../components/quantum/ProgressSentence/ProgressSentence.js'
import { useLiveRegion } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { useEscStep } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { useStableCallback } from '../../lib/useStableCallback.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'
import { PlatformCard } from '../../components/quantum/PlatformChip/PlatformCard.js'
import { platformChipLabel } from '../../components/quantum/PlatformChip/PlatformChip.js'
import { Spinner } from '../../components/quantum/Spinner/Spinner.js'
import { StatusChip } from '../../components/quantum/StatusChip/StatusChip.js'
import { useToast } from '../../components/quantum/Toast/Toast.js'
import {
  defaultCollapsed,
  loadCollapsed,
  loadFocus,
  loadHideDone,
  loadRailHidden,
  loadRailWidth,
  loadAddTags,
  saveAddTags,
  saveCollapsed,
  saveFocus,
  saveHideDone,
  saveRailHidden,
  saveRailWidth,
} from './collapse.js'
import { deriveFacets, tagChip, type FacetKey } from '../../../../server/src/catalog/facets.js'
import { AddItemForm, type NewItemInput } from './AddItemForm.js'
import { ExternalLink } from '../../components/quantum/ExternalLink/ExternalLink.js'
import { linkBackSource } from '../../lib/dataSources.js'
import { refreshAfterDays } from '../../../../server/src/catalog/sourceCopyLimits.js'
import { EditListPopover } from './EditListPopover.js'
import { FilterBar } from './FilterBar.js'
import { NO_FILTER, isFiltering, noteOnlyMatch, shownItemIds, type ListFilter } from './filtering.js'
import { GroupRow } from './GroupRow.js'
import { ConfirmPopover } from '../../components/quantum/ConfirmPopover/ConfirmPopover.js'
import { invertPatch, type ItemPatch } from './itemActions.js'
import { invertListPatch, type ListFields, type ListPatch } from './listActions.js'
import { ItemEditPopover } from './ItemEditPopover.js'
import { minutesColumnWidth } from './lengthLabel.js'
import { tagField } from './tagFields.js'
import { ItemInfoCard } from './ItemInfoCard.js'
import { ItemRow } from './ItemRow.js'
import { ByHandMark, CuratedStar } from '../../components/quantum/Marks/Marks.js'
import { listMark } from '../../lib/buckets.js'
import { JumpRail, JumpRailStub, type RailEntry } from './JumpRail.js'
import { ListMorePopover, type MoreMode, type PreviewState } from './ListMorePopover.js'
import { buildSpine, listTotals } from './spine.js'
import { buildRowModel, centreOn, offsetOf, revealScrollTop, scrollAfterChange, scrollAfterDrop, scrollKeepingUnit, shouldVirtualize, type VirtualizationMode } from './rowModel.js'
import { DEFAULT_VIEWPORT, WindowedRows } from './WindowedRows.js'
import { useRowMoves } from './useRowMoves.js'

export interface ListScreenProps {
  listId: string
  /** The live registry, for the category's label. */
  mediaTypes: readonly MediaType[]
  /** For a test; the app's own store otherwise. */
  pendingUpdates?: PendingUpdates
  /** Called after the list is deleted: the screen has nothing left to show, so the shell takes us Home. */
  onLeave?: () => void
  /** The ✕: closes this layer, back to what is under it. */
  onClose?: () => void
  /** False while another layer is on top of this one: its Esc rung (clear the filter text) is then not this list's to take (H-008). */
  active?: boolean
}

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | {
      state: 'ready'
      list: MediaListDetail
      collapsed: ReadonlySet<string>
      focusId: string | undefined
      railHidden: boolean
      railWidth: number
      addTags: string[]
      hideDone: boolean
    }

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
export function ListScreen({ listId, mediaTypes, pendingUpdates, onLeave, onClose, active = true }: ListScreenProps) {
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
      const railHidden = await loadRailHidden(store, listId)
      const railWidth = await loadRailWidth(store, listId)
      const addTags = await loadAddTags(store, listId)
      // Before the first frame, so a long list never shows its done items for a moment (18.2).
      const hideDone = await loadHideDone(store, listId)
      void saveLastOpened(store, listId)
      if (request.current === mine) setLoad({ state: 'ready', list, collapsed, focusId, railHidden, railWidth, addTags, hideDone })
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
      initialRailHidden={load.railHidden}
      initialRailWidth={load.railWidth}
      initialAddTags={load.addTags}
      initialHideDone={load.hideDone}
      mediaTypes={mediaTypes}
      pending={pendingUpdates ?? getPendingUpdates()}
      onLeave={onLeave}
      onClose={onClose}
      active={active}
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
  initialRailHidden: boolean
  initialRailWidth: number
  /** The tags the add row starts with on this list (U5). */
  initialAddTags: readonly string[]
  /** Hide Completed as this list last had it (18.2). */
  initialHideDone: boolean
  mediaTypes: readonly MediaType[]
  pending: PendingUpdates
  onLeave: (() => void) | undefined
  onClose: (() => void) | undefined
  active: boolean
  error: string | null
  setError: (message: string | null) => void
  reload: () => void
}

/** How long a row stays washed after it was added, moved or restored (design: row pulse). */
const PULSE_MS = 1900
/** How often a list reads itself again while some of its lengths are still being looked up (15.7). */
const RUNTIME_POLL_MS = 3000

type OpenPopover = {
  kind: 'info' | 'edit' | 'platform'
  itemId: string
  anchor: HTMLElement
  /** Edit only: open with the Platform panel already open (U5: the row's [+], the platform card's Edit). */
  openPanel?: boolean
  /** Edit only: open with the cursor in Note (the ✎ on "Your note" in the ⓘ card, H-003). */
  focusNote?: boolean
}


function ListView({
  listId,
  list: loaded,
  initialCollapsed,
  initialFocusId,
  initialRailHidden,
  initialRailWidth,
  initialAddTags,
  initialHideDone,
  mediaTypes,
  pending,
  onLeave,
  onClose,
  active,
  error,
  setError,
  reload,
}: ListViewProps) {
  const text = copy.quantum.list
  const actions = text.itemActions
  const updatesText = text.updates
  const editText = text.editPopover
  const moreText = text.moreMenu
  const orderText = text.orderMenu
  const { showToast } = useToast()
  const { announce } = useLiveRegion()
  const [items, setItems] = useState<ListItem[]>(loaded.items)
  const [groups, setGroups] = useState<ListGroup[]>(loaded.groups)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(initialCollapsed)
  const [focusId, setFocusId] = useState<string | undefined>(initialFocusId)
  const [railHidden, setRailHidden] = useState(initialRailHidden)
  const [railWidth, setRailWidth] = useState(initialRailWidth)
  // A jump asks for a scroll once the group it opened has rendered.
  const [jumpTo, setJumpTo] = useState<{ id: string; n: number } | null>(null)
  const [popover, setPopover] = useState<OpenPopover | null>(null)
  const [groupDelete, setGroupDelete] = useState<{ group: ListGroup; anchor: HTMLElement } | null>(null)
  const [pulseIds, setPulseIds] = useState<ReadonlySet<string>>(new Set())
  // What an explicit check found for this list and nobody has applied or dismissed (persisted).
  const pendingCount = usePendingMap(pending)[listId]?.count ?? 0
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  // The list's own name, description and status: edited here, so held here.
  const [meta, setMeta] = useState<ListFields>({
    title: loaded.title,
    description: loaded.description,
    status: loaded.status,
  })
  const [editingList, setEditingList] = useState<HTMLElement | null>(null)
  const [more, setMore] = useState<{ anchor: HTMLElement; mode: MoreMode } | null>(null)
  const [preview, setPreview] = useState<PreviewState>({ state: 'loading' })
  const previewRequest = useRef(0)
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // A row the screen should scroll to once it is in the list (an added or restored one), until its pulse is over.
  const revealId = useRef<string | null>(null)
  const spine = useRef<HTMLDivElement>(null)

  useEffect(() => () => clearTimeout(pulseTimer.current), [])

  const mediaType = mediaTypes.find((entry) => entry.key === loaded.mediaType)
  const mark = listMark(loaded)
  const defaultMinutes = mediaType?.defaultDurationMinutes ?? 30
  // Only a list fetched from a source arrived from somewhere a reader can visit, and Reset returns to.
  const linkBack = loaded.source === 'api' ? linkBackSource(mediaType?.sourceName) : undefined
  const totals = listTotals(items)
  const newCount = items.filter((entry) => entry.isNew).length
  const units = useMemo(() => buildSpine(items, groups), [items, groups])
  // From every item, not the filtered ones: filtering must not make the hands come and go.
  const mixedSources = useMemo(
    () => items.some((entry) => entry.source === 'manual') && items.some((entry) => entry.source !== 'manual'),
    [items],
  )
  const groupNames = useMemo(() => groups.map((group) => group.name), [groups])
  // U5: the category's tag field, and every tag the list carries (the Platform panel's "In this list").
  const tagEditor = useMemo(() => tagField(mediaType?.facets), [mediaType])
  const listTags = useMemo(() => items.flatMap((entry) => entry.tags ?? []), [items])
  const pulseRows = useCallback((ids: readonly string[]) => {
    clearTimeout(pulseTimer.current)
    setPulseIds(new Set(ids))
    pulseTimer.current = setTimeout(() => {
      revealId.current = null
      setPulseIds(new Set())
    }, PULSE_MS)
  }, [])
  const pulse = (itemId: string) => pulseRows([itemId])
  // An added or restored row is also scrolled to if it is not in view (25.4); a row that was only edited or renamed is where the reader is.
  const reveal = (itemId: string) => {
    revealId.current = itemId
    pulse(itemId)
  }
  // The filter is view state: what was typed and which facet buttons are on, never saved; Hide Completed alone is
  // remembered per list (18.2).
  const [filter, setFilter] = useState<ListFilter>({ ...NO_FILTER, hideDone: initialHideDone })
  const filtering = isFiltering(filter)
  // The ✕ and Esc clear the typed text and nothing else (H-008): the facets and Hide Completed stay.
  const clearFilterText = () => {
    setFilter((current) => ({ ...current, text: '' }))
    announce(text.filter.cleared)
  }
  // The Esc ladder's rung for this list: after its popovers, before the list closes, Esc clears the text, wherever the cursor is.
  useEscStep(`list-filter:${listId}`, active && filter.text !== '', clearFilterText)
  // Hide Completed (18.1): items ticked done while it is on stay where they are until it is switched again. Worked
  // out from each change of the items, so every way of ticking (the row, Undo, a whole group) is covered.
  const [doneThisVisit, setDoneThisVisit] = useState<ReadonlySet<string>>(new Set())
  const [itemsSeen, setItemsSeen] = useState(items)
  if (itemsSeen !== items) {
    setItemsSeen(items)
    if (filter.hideDone) {
      const before = new Set(itemsSeen.filter((entry) => entry.consumedAt !== null).map((entry) => entry.id))
      const fresh = items.filter((entry) => entry.consumedAt !== null && !before.has(entry.id)).map((entry) => entry.id)
      if (fresh.length > 0) setDoneThisVisit((current) => new Set([...current, ...fresh]))
    }
  }
  const toggleHideDone = () => {
    const on = !filter.hideDone
    setFilter((current) => ({ ...current, hideDone: on }))
    setDoneThisVisit(new Set())
    void saveHideDone(getPreferencesStore(), listId, on)
  }
  const facetGroups = useMemo(() => deriveFacets(items, mediaType?.facets), [items, mediaType])
  const shownIds = useMemo(
    () => shownItemIds(items, mediaType?.facets, filter, doneThisVisit),
    [items, mediaType, filter, doneThisVisit],
  )
  // What stays on the spine: a loose item that matches, and a group with a matching item (its items narrowed).
  const shownUnits = useMemo(
    () =>
      units.flatMap((unit) => {
        if (!filtering) return [{ unit, members: unit.kind === 'group' ? unit.items : [] }]
        if (unit.kind === 'item') return shownIds.has(unit.item.id) ? [{ unit, members: [] }] : []
        const members = unit.items.filter((entry) => shownIds.has(entry.id))

        return members.length > 0 ? [{ unit, members }] : []
      }),
    [units, filtering, shownIds],
  )
  // Ids a keyboard step may land beside; absent (not empty) when nothing is filtered.
  const shownKeys = useMemo(
    () =>
      filtering
        ? new Set(shownUnits.flatMap(({ unit, members }) => (unit.kind === 'item' ? [unit.item.id] : [unit.group.id, ...members.map((entry) => entry.id)])))
        : undefined,
    [filtering, shownUnits],
  )
  const moves = useRowMoves({ listId, items, groups, setItems, setGroups, setError, pulseRows, spine, shown: shownKeys })
  // Typed text opens a collapsed group that has a match, so the match can be seen; nothing is remembered.
  const openByText = useMemo(
    () =>
      filter.text.trim() === ''
        ? new Set<string>()
        : new Set(shownUnits.flatMap(({ unit }) => (unit.kind === 'group' ? [unit.group.name] : []))),
    [filter.text, shownUnits],
  )
  // While a group is carried it folds itself (its items travel with it) and unfolds where it lands; no other group changes, and a carried
  // loose item changes nothing (H-009). Nothing is remembered.
  const carriedGroup = useMemo(
    () => (moves.draggingUnit && moves.dragKey ? groups.find((entry) => entry.id === moves.dragKey)?.name : undefined),
    [moves.draggingUnit, moves.dragKey, groups],
  )
  const shut = useMemo<ReadonlySet<string>>(() => {
    const names = new Set([...collapsed].filter((name) => !openByText.has(name)))
    if (carriedGroup !== undefined) names.add(carriedGroup)

    return names
  }, [carriedGroup, collapsed, openByText])

  // The group a carried block would land beside as a whole (H-009): an open group with rows; its rows and header are tinted. Only the key
  // matters, so the tint is worked out again when the target changes and not when the line only moves between "before" and "after".
  const overKey = moves.over?.key
  const targetGroup = useMemo(() => {
    if (overKey === undefined) return undefined
    const entry = shownUnits.find(({ unit }) => unit.kind === 'group' && unit.group.id === overKey)

    return entry && entry.unit.kind === 'group' && entry.members.length > 0 && !shut.has(entry.unit.group.name) ? entry.unit.group.name : undefined
  }, [overKey, shownUnits, shut])

  // The rows as pixels, and which of them to draw (Phase 25): a long list draws a window, short ones everything. Off and the
  // preference arrive with 25.7; until then it is automatic.
  const virtualization: VirtualizationMode = 'auto'
  const rowModel = useMemo(() => buildRowModel(shownUnits, (name) => shut.has(name)), [shownUnits, shut])
  const windowed = shouldVirtualize(rowModel.rowTops.size, virtualization)
  // Where each drawn row is, for a screen reader (Phase 25.6, option A): only on a list drawn as a window, which shows a fraction of its rows.
  // Counted among the rows there are (items, and groups; not the items of a folded group), in the order they are walked.
  const places = useMemo(() => {
    if (!windowed) return undefined
    const itemAt = new Map<string, number>()
    const groupAt = new Map<string, number>()
    for (const { unit, members } of shownUnits) {
      if (unit.kind === 'item') itemAt.set(unit.item.id, itemAt.size + 1)
      else {
        groupAt.set(unit.group.id, groupAt.size + 1)
        if (!shut.has(unit.group.name)) for (const member of members) itemAt.set(member.id, itemAt.size + 1)
      }
    }

    return { itemAt, groupAt }
  }, [windowed, shownUnits, shut])
  // The rows that are on screen, in order: what the arrow keys walk.
  const visible = useMemo(() => {
    const ids: string[] = []
    for (const { unit, members } of shownUnits) {
      if (unit.kind === 'item') ids.push(unit.item.id)
      else {
        ids.push(unit.group.id)
        if (!shut.has(unit.group.name)) ids.push(...members.map((entry) => entry.id))
      }
    }

    return ids
  }, [shownUnits, shut])
  const tabStop = focusId && visible.includes(focusId) ? focusId : visible[0]
  // Rows that stay drawn wherever the list is scrolled: the roving tab stop (so Tab always finds a row to land on, also before anything was
  // focused), a row being dragged, a row with a window open on it.
  const pinnedRows = useMemo(() => {
    const ids = new Set<string>()
    if (tabStop) ids.add(tabStop)
    if (moves.dragKey) ids.add(moves.dragKey)
    if (popover?.itemId) ids.add(popover.itemId)
    for (const id of pulseIds) ids.add(id)

    return ids
  }, [tabStop, moves.dragKey, popover?.itemId, pulseIds])

  // The tag column shows once any item has a tag (U5, owner): until then, no column at all.
  const anyTags = useMemo(() => items.some((entry) => (entry.tags ?? []).length > 0), [items])
  // A category whose convention names platforms gets chips; the column is as wide as the widest label.
  const platformColumn = useMemo(
    () =>
      anyTags && mediaType?.facets?.some((facet) => facet.key === 'platform')
        ? { widthCh: Math.max(5, ...items.map((entry) => platformChipLabel(entry.tags ?? [])?.length ?? 0)) }
        : undefined,
    [anyTags, mediaType, items],
  )

  // A length still being looked up shows as "-" (15.7), so it counts for its own width, not the estimate's.
  const pendingMark = copy.quantum.list.itemActions.runtimePending
  const minutesWidth = minutesColumnWidth(items, pendingMark)

  // While some lengths, or some links (H-002: a page slug looked up in the background), are still on their way,
  // read the list again every few seconds and take only what arrived: a re-read never replaces what the screen
  // holds (a drag, an edit, an order).
  const runtimesPending = useMemo(() => countRuntimesPending(items), [items])
  const linksPending = useMemo(() => countLinksPending(items), [items])
  usePolling(
    runtimesPending > 0 || linksPending > 0,
    async () => {
      const fresh = await api.list(listId)
      setItems((current) => mergeArrivedLinks(mergeArrivedRuntimes(current, fresh.items), fresh.items))
    },
    RUNTIME_POLL_MS,
  )

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

  /** Collapse all / Expand all: judged on what the reader has open, not on what a filter shows. */
  const anyOpen = groupNames.some((name) => !collapsed.has(name))

  // The rail is the map of the whole list: every group with items, however the filter narrows the spine.
  const railEntries = useMemo<RailEntry[]>(
    () =>
      units.flatMap((unit) =>
        unit.kind === 'group' && unit.items.length > 0
          ? [{ id: unit.group.id, name: unit.group.name, done: unit.done, total: unit.total }]
          : [],
      ),
    [units],
  )

  function setRail(hidden: boolean) {
    setRailHidden(hidden)
    void saveRailHidden(getPreferencesStore(), listId, hidden)
  }

  function jump(entry: RailEntry) {
    openGroup(entry.name)
    setJumpTo((current) => ({ id: entry.id, n: (current?.n ?? 0) + 1 }))
  }

  // Moving the scroller from code (Phase 25.4). The position is set and the window is told in the same layout effect, so the rows that
  // belong to the new place are drawn before anything is painted (a scroll event would come a frame later, and show the old rows or a
  // spacer). Lists of any length: a short one is moved the same way and simply has no window to tell.
  const windowSync = useRef<(() => void) | null>(null)
  // Where the scroller is: the last scroll event, or where this screen put it. When the rows change the browser may already have moved it
  // (it clamps a position that is past the new end), so the position to keep is this one and not what the element says by then.
  const scrolledTo = useRef(0)
  function scrollBodyTo(top: number) {
    const body = spine.current
    if (!body) return
    const at = Math.max(0, Math.round(top))
    if (Math.abs(body.scrollTop - at) >= 1) body.scrollTop = at
    // Where the browser settled, not what was asked: a position past the end is clamped, and no scroll event follows if that equals the old one.
    scrolledTo.current = body.scrollTop
    windowSync.current?.()
  }

  // The reader keeps their place when the rows change under them: a group folded or opened, Collapse / Expand all, a filter, Hide Completed.
  // A group that is picked up folds itself, and unfolds when it is put down: it stays where it is on the screen when it is picked up (it is
  // under the pointer) and lands at the drop line when it is put down; nothing moves while it is carried. Declared before the effects that
  // scroll on purpose, so theirs win.
  const modelSeen = useRef(rowModel)
  const carryingSeen = useRef(false)
  const carriedKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    const before = modelSeen.current
    const wasCarrying = carryingSeen.current
    const carrying = Boolean(moves.draggingUnit)
    if (carrying && moves.dragKey) carriedKey.current = moves.dragKey
    modelSeen.current = rowModel
    carryingSeen.current = carrying
    const body = spine.current
    // Put down: at the drop line (a block, or an item moved inside its group). Picked up, or let go of without a drop (Esc): where it was on the
    // screen. A drop is used once: on the first change of the rows after it (or when a carry ends), and a new drag forgets it.
    const carryEnded = wasCarrying && !carrying
    const drop = moves.dropped.current
    if (drop && (carryEnded || before !== rowModel)) moves.dropped.current = null
    if (before === rowModel || !body || (carrying && wasCarrying)) return
    const landed = drop ? scrollAfterDrop(before, rowModel, drop.key, drop.targetKey, drop.pos, scrolledTo.current) : undefined
    const kept =
      landed ??
      (carrying !== wasCarrying && carriedKey.current !== null ? scrollKeepingUnit(before, rowModel, carriedKey.current, scrolledTo.current) : undefined)
    const next = kept ?? scrollAfterChange(before, rowModel, scrolledTo.current, body.clientHeight || DEFAULT_VIEWPORT.height)
    if (next !== scrolledTo.current) scrollBodyTo(next)
  }, [rowModel, moves.draggingUnit])

  useLayoutEffect(() => {
    if (!jumpTo) return
    const top = offsetOf(rowModel, jumpTo.id)
    if (top !== undefined) scrollBodyTo(top)
    setJumpTo(null)
  }, [jumpTo])

  // Every commit: a row to reveal waits until it is in the list (a filter may hide it), or until its pulse is over.
  useLayoutEffect(() => {
    const id = revealId.current
    const body = spine.current
    if (id === null || !body) return
    const top = revealScrollTop(rowModel, id, scrolledTo.current, body.clientHeight || DEFAULT_VIEWPORT.height)
    if (top === undefined) return
    revealId.current = null
    scrollBodyTo(top)
  })

  function foldAll() {
    const next = anyOpen ? new Set(groupNames) : new Set<string>()
    setCollapsed(next)
    void saveCollapsed(getPreferencesStore(), listId, next)
  }

  function selectFacet(facet: FacetKey, selected: ReadonlySet<string>) {
    setFilter((current) => ({ ...current, facets: { ...current.facets, [facet]: selected } }))
  }

  /**
   * The one thing a list remembers about where the reader was: the last row (item or group header) that took focus, saved per list. It is
   * the roving tab stop, and a long list reopens scrolled to it. The scroll position is NOT remembered (DECISIONS 2026-10-16, BL-099).
   */
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
      setError(copy.quantum.list.saveFailed)
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
      ...(input.year ? { year: input.year.year, yearUnk: input.year.yearUnk } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
    })
    // The next item on this list starts with what this one used (docs/chips §4).
    if (input.tags) void saveAddTags(getPreferencesStore(), listId, input.tags)

    const fresh = await refresh()
    // A collapsed group the item went into opens, or the pulse would mark nothing.
    const placed = fresh.items.find((entry) => entry.id === created.id)
    if (placed?.group) openGroup(placed.group)
    reveal(created.id)
    announce(actions.added(input.title, placed?.group ?? group))
  }

  /** An empty group from the add band: at the end of the list, and named in the live region. */
  async function createGroup(name: string) {
    const created = await api.createGroup(listId, name)
    await refresh()
    reveal(created.id)
    announce(actions.groupCreated(created.name))
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
      reveal(item.id)
      announce(actions.restored(item.title))
    } catch {
      setError(actions.undoFailed)
    }
  }

  /** An empty group only (the server refuses otherwise): gone at once, Undo puts it back where it was. */
  async function removeGroup(group: ListGroup) {
    const previous = groups
    setError(null)
    setGroups((current) => current.filter((entry) => entry.id !== group.id))

    try {
      const restore = await api.deleteGroup(listId, group.id)
      showToast({
        text: actions.groupRemoved(group.name),
        actionLabel: actions.undo,
        onAction: () => void undoRemoveGroup(restore, group),
      })
    } catch {
      setGroups(previous)
      setError(actions.groupRemoveFailed(group.name))
    }
  }

  /** Carries a folded group's fold across its rename (the folds are remembered by name). */
  function renameFold(from: string, to: string) {
    if (!collapsed.has(from)) return
    const next = new Set(collapsed)
    next.delete(from)
    next.add(to)
    setCollapsed(next)
    void saveCollapsed(getPreferencesStore(), listId, next)
  }

  /** The group's new name, from its editor: the items relabel with it; Undo names it back. Rejects when refused. */
  async function renameGroup(group: ListGroup, name: string) {
    setError(null)

    try {
      const renamed = await api.renameGroup(listId, group.id, name)
      renameFold(group.name, renamed.name)
      await refresh()
      pulse(group.id)
      showToast({
        text: actions.groupRenamed(group.name, renamed.name),
        actionLabel: actions.undo,
        onAction: () => void undoRenameGroup(group, renamed.name),
      })
    } catch (cause) {
      // A name another group has is said under the group's own header by its editor (H-006), not by the strip.
      if (!(cause instanceof ApiError && cause.code === 'group.nameTaken')) {
        setError(cause instanceof Error ? cause.message : actions.groupRenameFailed(group.name))
      }
      throw cause
    }
  }

  async function undoRenameGroup(group: ListGroup, current: string) {
    try {
      await api.renameGroup(listId, group.id, group.name)
      renameFold(current, group.name)
      await refresh()
      pulse(group.id)
      announce(actions.groupRenamed(current, group.name))
    } catch {
      setError(actions.undoFailed)
    }
  }

  /** A group with items, after its confirmation: the group and its items go at once; Undo brings all back. */
  async function removeGroupWithItems(group: ListGroup) {
    const previous = { items, groups }
    const inside = items.filter((entry) => entry.group === group.name).length
    setGroupDelete(null)
    setError(null)
    setItems((current) => current.filter((entry) => entry.group !== group.name))
    setGroups((current) => current.filter((entry) => entry.id !== group.id))

    try {
      const restore = await api.deleteGroup(listId, group.id, { withItems: true })
      showToast({
        text: actions.groupRemovedWithItems(group.name, inside),
        actionLabel: actions.undo,
        onAction: () => void undoRemoveGroup(restore, group),
      })
    } catch {
      setItems(previous.items)
      setGroups(previous.groups)
      setError(actions.groupRemoveFailed(group.name))
    }
  }

  async function undoRemoveGroup(restore: Parameters<typeof api.restoreGroup>[1], group: ListGroup) {
    try {
      await api.restoreGroup(listId, restore)
      await refresh()
      reveal(group.id)
      announce(actions.groupRestored(group.name))
    } catch {
      setError(actions.undoFailed)
    }
  }

  /** Saves the list's own fields; the header changes at once and is put back if the server refuses. */
  async function saveListEdit(patch: ListPatch, via: 'save' | 'clickaway') {
    const before = meta
    setEditingList(null)
    setError(null)
    setMeta((current) => ({ ...current, ...patch }))

    try {
      await api.updateList(listId, patch)
    } catch {
      setMeta(before)
      setError(editText.saveFailed)
      return
    }

    // One change is named; several are just "updated" — never only the first of them.
    const changed = [patch.title, patch.description, patch.status].filter((value) => value !== undefined).length
    const message =
      changed > 1
        ? editText.listSaved
        : patch.title !== undefined
          ? editText.renamed(patch.title)
          : patch.description !== undefined
            ? editText.descriptionUpdated
            : patch.status
              ? editText.statusMarked(patch.status)
              : editText.statusCleared
    // The click-away is the safety net, so it is the one that offers Undo.
    if (via === 'clickaway') {
      showToast({
        text: message,
        actionLabel: actions.undo,
        onAction: () => void undoListEdit(before, patch),
      })
    } else {
      showToast({ text: message })
    }
  }

  /** Takes the fresh list's own name, description and status: a Reset changes them. */
  function adoptMeta(fresh: MediaListDetail) {
    setMeta({ title: fresh.title, description: fresh.description, status: fresh.status })
  }

  /** Sort chronologically: one in-place re-sort, undone by putting the old positions back. */
  async function sortNow(message: string) {
    setMore(null)
    setError(null)

    try {
      const { restore } = await api.sortList(listId)
      await refresh()
      showToast({ text: message, actionLabel: actions.undo, onAction: () => void undoSort(restore) })
    } catch {
      setError(orderText.sortFailed)
    }
  }

  /** Reset the order: the source's own order back, in place; the same Undo as the sort. */
  async function resetOrder() {
    setMore(null)
    setError(null)

    try {
      const { restore } = await api.resetOrder(listId)
      await refresh()
      showToast({ text: orderText.orderRestored, actionLabel: actions.undo, onAction: () => void undoSort(restore) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : orderText.resetFailed)
    }
  }

  async function undoSort(restore: Parameters<typeof api.restoreOrder>[1]) {
    try {
      await api.restoreOrder(listId, restore)
      await refresh()
      announce(orderText.orderUndone)
    } catch {
      setError(orderText.undoFailed)
    }
  }

  /** Opens the Reset question and works out its cost while it is on screen. */
  function openReset() {
    if (!more) return
    setMore({ ...more, mode: 'reset' })
    setPreview({ state: 'loading' })
    previewRequest.current += 1
    const mine = previewRequest.current

    api
      .resetPreview(listId)
      .then((data) => {
        if (previewRequest.current === mine) setPreview({ state: 'ready', data })
      })
      .catch((cause: unknown) => {
        if (previewRequest.current === mine) {
          setPreview({ state: 'failed', message: cause instanceof Error ? cause.message : orderText.resetFailed })
        }
      })
  }

  async function resetEverything() {
    if (!more) return
    setMore(null)
    setError(null)

    try {
      const result = await api.resetList(listId)
      adoptMeta(await refresh())
      showToast({
        text: orderText.resetDone,
        actionLabel: actions.undo,
        onAction: () => void undoReset(result.restore),
      })
      // An API list is checked against its source straight away; the community
      // library's and a file's were just read live.
      if (result.followUpCheck) void checkForUpdates({ quiet: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : orderText.resetFailed)
    }
  }

  async function undoReset(restore: Parameters<typeof api.restoreItems>[1]) {
    try {
      await api.restoreItems(listId, restore)
      adoptMeta(await refresh())
      announce(orderText.undone)
    } catch {
      setError(orderText.undoFailed)
    }
  }

  /** The list as the file format sees it: its current name, status and items. */
  function asExport(): MediaListDetail {
    return { ...loaded, ...meta, items, groups }
  }

  function downloadExport() {
    const fileName = exportFileName(meta.title)

    try {
      downloadText(fileName, exportList(asExport()))
      setMore(null)
      showToast({ text: moreText.saved(fileName, items.length) })
    } catch {
      setError(moreText.exportFailed)
    }
  }

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportList(asExport()))
      setMore(null)
      showToast({ text: moreText.copied })
    } catch {
      showToast({ text: moreText.copyFailed })
    }
  }

  /** Two steps in the popover, then it acts at once: the payload it hands back is what Undo restores. */
  async function deleteThisList() {
    const title = meta.title
    setMore(null)
    setError(null)

    try {
      const restore = await api.deleteList(listId)
      onLeave?.()
      // The toast outlives this screen: Undo works from Home.
      showToast({
        text: moreText.deleted(title),
        actionLabel: actions.undo,
        onAction: () => void undoDelete(restore, title),
      })
    } catch {
      setError(moreText.deleteFailed)
    }
  }

  async function undoDelete(restore: Parameters<typeof api.restoreList>[0], title: string) {
    try {
      await api.restoreList(restore)
      notifyListsChanged()
      announce(moreText.restored(title))
    } catch {
      showToast({ text: moreText.restoreFailed })
    }
  }

  async function undoListEdit(before: ListFields, patch: ListPatch) {
    const back = invertListPatch(before, patch)

    try {
      await api.updateList(listId, back)
      setMeta((current) => ({ ...current, ...back }))
      announce(editText.reverted(before.title))
    } catch {
      setError(editText.undoFailed)
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

      // Every save says what it did (owner, 2026-09-28: U6, matching the list edit window); only
      // the click-away is the safety net, so it is the one that also offers Undo.
      const title = patch.title ?? item.title
      if (via === 'clickaway') {
        showToast({
          text: actions.saved(title),
          actionLabel: actions.undo,
          onAction: () => void undoEdit(item, patch),
        })
      } else {
        showToast({ text: actions.saved(title) })
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
      announce(actions.editUndone(item.title))
    } catch {
      setError(actions.undoFailed)
    }
  }

  /**
   * Asks the source what it has that the list does not and records it; writes
   * nothing to the list. What it finds appears as a band with Update List and
   * Dismiss, so nothing is added until the reader says so.
   */
  /**
   * `quiet`: the check that follows a Reset says nothing when it finds nothing. It used to take seconds, so the
   * Reset message stayed readable; now it takes a moment and its "No updates found" would replace the message
   * about what was just done, with its Undo, at once (Checkpoint C). A found band and a failure still show.
   */
  async function checkForUpdates({ quiet = false }: { quiet?: boolean } = {}) {
    setChecking(true)
    setError(null)

    try {
      const count = await checkList(listId, { api, pending })
      if (count === 0 && !quiet) showToast({ text: updatesText.nothingNew })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : updatesText.checkFailed)
    } finally {
      setChecking(false)
    }
  }

  /** Update List: what is new arrives flagged NEW, under the usual Mark all seen band. */
  async function applyFound() {
    setApplying(true)
    setError(null)

    try {
      const added = await applyUpdate(listId, { api, pending })
      await refresh()
      showToast({ text: added === 0 ? updatesText.nothingNew : updatesText.appliedToast(added) })
    } catch {
      setError(updatesText.addFailed)
    } finally {
      setApplying(false)
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

    // Shift+↑↓ moves the row itself, groups and items alike; plain ↑↓ walk the rows.
    if (event.shiftKey) {
      event.preventDefault()
      moves.moveByKey(current.dataset['rowId']!, event.key === 'ArrowDown' ? 1 : -1)
      return
    }

    const index = visible.indexOf(current.dataset['rowId']!)
    const target = visible[index + (event.key === 'ArrowDown' ? 1 : -1)]
    if (target === undefined) return

    event.preventDefault()
    const drawn = spine.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(target)}"]`)
    if (drawn) {
      drawn.focus()
      return
    }

    // The next row is not drawn (the reader scrolled away from the row that has focus): make it the tab stop, which pins it, and
    // focus it once it is there; the browser scrolls a focused row into view, and the window follows.
    focusWhenDrawn.current = target
    setFocusId(target)
  }

  // Focus the row an arrow key asked for as soon as it has been drawn. It is dropped after the first commit either way, so a row that
  // never comes (the list changed) cannot take focus later.
  const focusWhenDrawn = useRef<string | null>(null)
  useLayoutEffect(() => {
    const id = focusWhenDrawn.current
    if (id === null) return
    focusWhenDrawn.current = null
    spine.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)?.focus()
  })

  // A list that is opened again scrolls to the row it remembers, which is otherwise only its tab stop: centred, as far as the list allows.
  // Long and short alike (owner, 2026-10-16). Before the first paint, and the window starts there (`openAt`), so nothing shows at the top first.
  const [openAt] = useState(() => (initialFocusId === undefined ? 0 : (centreOn(rowModel, initialFocusId, DEFAULT_VIEWPORT.height) ?? 0)))
  useLayoutEffect(() => {
    const body = spine.current
    const top = initialFocusId === undefined ? undefined : centreOn(rowModel, initialFocusId, body?.clientHeight || DEFAULT_VIEWPORT.height)
    if (top !== undefined) scrollBodyTo(top)
    // Once, when the list opens.
  }, [])

  // The row handlers keep their identity and call the latest of this screen (Phase 25.0b): a row is drawn again only when
  // what it shows changed, so one tick does not redraw every row of a long list.
  const onRowToggle = useStableCallback((row: ListItem) => void toggleItem(row))
  const onRowFocus = useStableCallback((row: ListItem) => remember(row.id))
  const onRowInfo = useStableCallback((row: ListItem, anchor: HTMLElement) => setPopover({ kind: 'info', itemId: row.id, anchor }))
  const onRowEdit = useStableCallback((row: ListItem, anchor: HTMLElement) => setPopover({ kind: 'edit', itemId: row.id, anchor }))
  const onRowRemove = useStableCallback((row: ListItem) => void removeItem(row))
  const onRowHandle = useStableCallback((event: ReactPointerEvent, row: ListItem) => moves.startDrag(event, row.id))
  const onRowPlatform = useStableCallback((row: ListItem, anchor: HTMLElement) => setPopover({ kind: 'platform', itemId: row.id, anchor }))
  const platformKind = tagEditor?.kind
  // The Edit window, not a dialog of its own (owner); Games open on the Platform panel.
  const onRowAddTag = useStableCallback((row: ListItem, anchor: HTMLElement) =>
    setPopover({ kind: 'edit', itemId: row.id, anchor, openPanel: platformKind === 'platform' }),
  )
  const platformWidthCh = platformColumn?.widthCh
  const rowPlatform = useMemo(
    () => (platformWidthCh === undefined ? undefined : { widthCh: platformWidthCh, onOpen: onRowPlatform }),
    [platformWidthCh, onRowPlatform],
  )
  const addTagLabel = tagEditor ? (tagEditor.kind === 'choice' ? tagEditor.label : '') : undefined
  const rowAddTag = useMemo(
    () => (anyTags && addTagLabel !== undefined ? { label: addTagLabel, onAdd: onRowAddTag } : undefined),
    [anyTags, addTagLabel, onRowAddTag],
  )

  const itemRow = (entry: ListItem, grouped: boolean) => (
    <ItemRow
      key={entry.id}
      item={entry}
      grouped={grouped}
      focusable={tabStop === entry.id}
      showManual={mixedSources}
      noteMatch={noteOnlyMatch(entry, filter.text)}
      minutesWidth={minutesWidth}
      pulse={pulseIds.has(entry.id)}
      onHandlePointerDown={onRowHandle}
      dragging={moves.dragKey === entry.id}
      place={places && places.itemAt.has(entry.id) ? text.place.item(places.itemAt.get(entry.id)!, places.itemAt.size) : undefined}
      hover={grouped && targetGroup !== undefined && entry.group === targetGroup}
      dropLine={moves.over?.key === entry.id ? moves.over.pos : null}
      onToggle={onRowToggle}
      onFocus={onRowFocus}
      onInfo={onRowInfo}
      onEdit={onRowEdit}
      onRemove={onRowRemove}
      tagChip={tagChip(entry.tags, mediaType?.facets)}
      platform={rowPlatform}
      addTag={rowAddTag}
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
              {mark === 'curated' && <CuratedStar large />}
              {mark === 'byHand' && <ByHandMark large />}
              {meta.title}
              <StatusChip status={meta.status} />
            </h1>
            {meta.description && <p className="q-list-description">{meta.description}</p>}
            <ProgressSentence
              done={totals.done}
              total={totals.total}
              minutesLeft={totals.minutesLeft}
              status={meta.status}
              size="header"
              runtimesPending={runtimesPending}
            />
          </div>
          <div className="q-list-actions">
            {/* Only a list built from a source has anything to check against. */}
            {loaded.externalRef && (
              <IconButton
                size="list"
                className="q-check-btn"
                label={checking ? updatesText.checking : text.checkForUpdates}
                disabled={checking}
                onClick={() => void checkForUpdates()}
              >
                <span className={checking ? 'q-spin' : undefined} style={{ display: 'flex' }}>
                  <RefreshCw width={16} height={16} strokeWidth={1.9} aria-hidden="true" />
                </span>
              </IconButton>
            )}
            <IconButton size="list" label={text.more} onClick={(event) => setMore({ anchor: event.currentTarget, mode: 'menu' })}>
              <EllipsisVertical width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
            </IconButton>
            <IconButton size="list" label={text.close} onClick={() => onClose?.()}>
              <X width={16} height={16} strokeWidth={1.9} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      </div>
      <FilterBar
        text={filter.text}
        onText={(value) => setFilter((current) => ({ ...current, text: value }))}
        onClear={clearFilterText}
        facets={facetGroups}
        selection={filter.facets}
        onSelect={selectFacet}
        fold={groupNames.length > 1 ? { collapse: anyOpen, onToggle: foldAll } : null}
        hideDone={{ on: filter.hideDone === true, onToggle: toggleHideDone }}
        note={filtering ? text.filter.shown(shownIds.size, items.length) : text.filter.total(items.length)}
      />

      {pendingCount > 0 && (
        <Banner
          onDismiss={() => void pending.remove(listId)}
          dismissLabel={updatesText.dismissFound}
          action={{ label: updatesText.updateList, onClick: () => void applyFound(), busy: applying }}
        >
          {updatesText.foundBand(pendingCount)}
        </Banner>
      )}

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

      <div className="q-list-cols">
        {railEntries.length > 1 && !railHidden && (
          <JumpRail
            entries={railEntries}
            onJump={jump}
            onHide={() => setRail(true)}
            width={railWidth}
            onResize={setRailWidth}
            onResizeEnd={(width) => void saveRailWidth(getPreferencesStore(), listId, width)}
          />
        )}
        {railEntries.length > 1 && railHidden && <JumpRailStub onShow={() => setRail(false)} />}
        <div
          className="q-list-body"
          ref={spine}
          onKeyDown={onKeyDown}
          onBlur={moves.onBlur}
          onScroll={(event) => {
            scrolledTo.current = event.currentTarget.scrollTop
          }}
        >
          {units.length === 0 && <p className="q-list-empty">{text.empty}</p>}
          {units.length > 0 && filtering && shownUnits.length === 0 && (
            <p className="q-list-empty">
              {/* Hide Completed alone left nothing: the list is done, not a filter that found nothing. */}
              {isFiltering({ ...filter, hideDone: false }) ? text.filter.nothing(filter.text) : text.filter.allDone}
            </p>
          )}
          {places && <p className="q-place">{text.place.note(places.itemAt.size)}</p>}
          <WindowedRows
            shown={shownUnits}
            model={rowModel}
            enabled={windowed}
            pinned={pinnedRows}
            scroller={spine}
            initialScrollTop={openAt}
            syncRef={windowSync}
            renderItem={itemRow}
            renderGroup={({ unit, members }, rows) =>
              unit.kind === 'group' ? (
                <div key={unit.group.id} className="q-list-block" data-block-key={unit.group.id}>
                  <GroupRow
                    block={unit}
                    collapsed={shut.has(unit.group.name)}
                    focusable={tabStop === unit.group.id}
                    onToggle={toggleGroup}
                    onFocus={remember}
                    onHandlePointerDown={(event) => moves.startDrag(event, unit.group.id)}
                    onDelete={() => void removeGroup(unit.group)}
                    onRename={(name) => renameGroup(unit.group, name)}
                    onDeleteWithItems={(anchor) => setGroupDelete({ group: unit.group, anchor })}
                    dragging={moves.dragKey === unit.group.id}
                    target={targetGroup === unit.group.name}
                    place={places && places.groupAt.has(unit.group.id) ? text.place.group(places.groupAt.get(unit.group.id)!, places.groupAt.size) : undefined}
                    dropLine={
                      moves.over?.key === unit.group.id && !(moves.over.pos === 'after' && !shut.has(unit.group.name) && members.length > 0)
                        ? moves.over.pos
                        : null
                    }
                    pulse={pulseIds.has(unit.group.id)}
                    shownOf={filtering ? { shown: members.length, total: unit.items.length } : undefined}
                  />
                  {rows}
                  {/* An open group's "after" line is at its bottom edge, under its last row (H-009); a shut or empty group's is under its header. */}
                  {moves.over?.key === unit.group.id && moves.over.pos === 'after' && !shut.has(unit.group.name) && members.length > 0 && (
                    <span className="q-dropline after" />
                  )}
                </div>
              ) : null
            }
          />
          <AddItemForm
            groups={groupNames}
            defaultMinutes={defaultMinutes}
            onAdd={addItem}
            onCreateGroup={createGroup}
            tagField={tagEditor}
            listTags={listTags}
            defaultTags={initialAddTags}
          />
          {linkBack && (
            <p className="q-list-linkback">
              {text.linkBack.before}
              <ExternalLink href={linkBack.url}>
                {linkBack.name}
                <span aria-hidden="true"> ↗</span>
              </ExternalLink>
              {mediaType?.sourceCopyMaxDays
                ? joinSentences(
                    text.linkBack.after,
                    text.sourceCopyNotice({
                      days: Math.round(refreshAfterDays(mediaType.sourceCopyMaxDays)),
                      source: linkBack.name,
                    }),
                  )
                : text.linkBack.after}
            </p>
          )}
        </div>
      </div>

      {more && (
        <ListMorePopover
          mode={more.mode}
          anchorEl={more.anchor}
          source={loaded.source}
          title={meta.title}
          itemCount={items.length}
          doneCount={totals.done}
          preview={preview}
          onMode={(mode) => {
            if (mode === 'edit') {
              setEditingList(more.anchor)
              setMore(null)
            } else if (mode === 'reset') openReset()
            else setMore({ ...more, mode })
          }}
          onDownload={downloadExport}
          onCopy={() => void copyExport()}
          onSortNow={() => void sortNow(orderText.sorted)}
          onResetOrder={() => void resetOrder()}
          onResetEverything={() => void resetEverything()}
          canReset={loaded.canReset !== false}
          onDelete={() => void deleteThisList()}
          onDismiss={() => setMore(null)}
        />
      )}
      {editingList && (
        <EditListPopover
          list={meta}
          itemCount={items.length}
          anchorEl={editingList}
          onCommit={(patch, via) => void saveListEdit(patch, via)}
          onDiscard={() => setEditingList(null)}
        />
      )}
      {popover?.kind === 'info' && popoverItem && (
        <Popover open anchorEl={popover.anchor} onDismiss={() => setPopover(null)} width={320}>
          <ItemInfoCard
            item={popoverItem}
            onEditNote={() => setPopover({ kind: 'edit', itemId: popoverItem.id, anchor: popover.anchor, focusNote: true })}
          />
        </Popover>
      )}
      {groupDelete &&
        (() => {
          const inside = items.filter((entry) => entry.group === groupDelete.group.name)
          return (
            <ConfirmPopover
              open
              anchorEl={groupDelete.anchor}
              onDismiss={() => setGroupDelete(null)}
              width={320}
              kicker={actions.groupDeleteKicker}
              cost={moreText.itemCount(inside.length)}
              question={actions.groupDeleteQuestion(groupDelete.group.name)}
              note={actions.groupDeleteNote(inside.length, inside.filter((entry) => entry.consumedAt !== null).length)}
              onKeep={() => setGroupDelete(null)}
              onConfirm={() => void removeGroupWithItems(groupDelete.group)}
              confirmLabel={actions.groupDeleteConfirm}
              danger
            />
          )
        })()}
      {popover?.kind === 'platform' && popoverItem && (
        <Popover open anchorEl={popover.anchor} onDismiss={() => setPopover(null)} width="fit">
          <PlatformCard
            tags={popoverItem.tags ?? []}
            itemTitle={popoverItem.title}
            onEdit={
              tagEditor?.kind === 'platform'
                ? () => setPopover({ kind: 'edit', itemId: popoverItem.id, anchor: popover.anchor, openPanel: true })
                : undefined
            }
          />
        </Popover>
      )}
      {popover?.kind === 'edit' && popoverItem && (
        <ItemEditPopover
          key={popoverItem.id}
          item={popoverItem}
          groups={groupNames}
          defaultMinutes={defaultMinutes}
          anchorEl={popover.anchor}
          onCommit={(patch, via) => void saveEdit(popoverItem, patch, via)}
          onDiscard={() => setPopover(null)}
          tagField={tagEditor}
          listTags={listTags}
          openPanel={popover.openPanel}
          focusNote={popover.focusNote}
          loadSource={() => api.itemSource(listId, popoverItem.id)}
        />
      )}
    </div>
  )
}
