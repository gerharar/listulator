import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { api, type ListGroup, type ListItem, type OrderRestore } from '../../lib/api.js'
import { copy } from '../../locale/index.js'
import { useLiveRegion } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { useToast } from '../../components/quantum/Toast/Toast.js'
import { useRowDrag, type DropTarget } from '../../lib/useRowDrag.js'
import {
  applyPositions,
  dropItemInGroup,
  dropUnit,
  stepAmongShown,
  stepItemInGroup,
  stepUnit,
  type MoveOutcome,
} from './moves.js'

interface Deps {
  listId: string
  items: readonly ListItem[]
  groups: readonly ListGroup[]
  setItems: Dispatch<SetStateAction<ListItem[]>>
  setGroups: Dispatch<SetStateAction<ListGroup[]>>
  setError: (message: string | null) => void
  /** Wash these rows so the eye finds where they went. */
  pulseRows: (ids: readonly string[]) => void
  /** The list body, to put focus back on a row after it has moved. */
  spine: RefObject<HTMLElement | null>
  /**
   * While a filter hides rows: the ids (items and groups) that are shown. A
   * keyboard step then goes just past the next shown row. Absent when nothing
   * is filtered.
   */
  shown?: ReadonlySet<string> | undefined
}

/** A keyboard run ends at a pause this long, when focus leaves the list, or when the screen goes. */
const RUN_IDLE_MS = 1200

type Moved = Extract<MoveOutcome, { kind: 'moved' }>

/**
 * Moving rows on the list screen (10.23; design rules, "Moving things"):
 * dragging by the handle and Shift+↑↓, both through the same pure functions
 * (`moves.ts`), so they save the same order. A move shows at once and is saved
 * as the positions that changed (`restoreOrder`, the same call that undoes it);
 * if the save fails the rows go back. A dropped drag gets an 8s Undo; a run of
 * keyboard steps gets one toast when it ends, which outlives the screen, and
 * whose Undo restores the positions from before the first step.
 */
export function useRowMoves({ listId, items, groups, setItems, setGroups, setError, pulseRows, spine, shown }: Deps) {
  const text = copy.quantum.list.moves
  const { showToast } = useToast()
  const { announce } = useLiveRegion()

  // The latest of everything a gesture or a toast may need long after the render that made it.
  const latest = useRef({ items, groups, shown })
  latest.current = { items, groups, shown }
  const mounted = useRef(true)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const pendingFocus = useRef<string | null>(null)

  const groupIds = useMemo(() => new Set(groups.map((entry) => entry.id)), [groups])
  const itemById = useMemo(() => new Map(items.map((entry) => [entry.id, entry])), [items])

  const applyLocally = useCallback(
    (positions: OrderRestore) => {
      setItems((current) => applyPositions(current, [], positions).items)
      setGroups((current) => applyPositions([], current, positions).groups)
    },
    [setItems, setGroups],
  )

  /** Saves positions, one write after another, so quick steps cannot land out of order. */
  const persist = useCallback(
    (positions: OrderRestore) => {
      const write = chain.current.then(() => api.restoreOrder(listId, positions))
      chain.current = write.catch(() => {})

      return write
    },
    [listId],
  )

  const commit = useCallback(
    async (outcome: Moved): Promise<boolean> => {
      applyLocally(outcome.next)
      pulseRows(outcome.pulseIds)
      setError(null)

      try {
        await persist(outcome.next)
        return true
      } catch {
        applyLocally(outcome.previous)
        setError(text.saveFailed)
        return false
      }
    },
    [applyLocally, persist, pulseRows, setError, text.saveFailed],
  )

  const undoTo = useCallback(
    async (previous: OrderRestore, pulse: readonly string[]) => {
      try {
        await persist(previous)
        // The row pulse marks where a thing went, so only if this list is still open behind us.
        if (mounted.current) {
          applyLocally(previous)
          pulseRows(pulse)
          announce(text.undone)
        }
      } catch {
        if (mounted.current) setError(text.undoFailed)
        else showToast({ text: text.undoFailed })
      }
    },
    [persist, applyLocally, pulseRows, announce, setError, showToast, text.undone, text.undoFailed],
  )

  const said = (outcome: Moved) => text.movedTo(outcome.title, outcome.position, outcome.total, outcome.groupName)

  // ---- dragging -----------------------------------------------------------------------------

  const kindOf = useCallback(
    (key: string): 'unit' | 'grouped' => (groupIds.has(key) || !itemById.get(key)?.group ? 'unit' : 'grouped'),
    [groupIds, itemById],
  )

  const accepts = useCallback(
    (dragKey: string, targetKey: string): boolean => {
      const dragged = itemById.get(dragKey)
      if (kindOf(dragKey) === 'grouped') {
        const target = itemById.get(targetKey)
        return target !== undefined && target.group === dragged!.group
      }

      // A block goes among blocks: a group's header or a loose item, never a row inside a group.
      return groupIds.has(targetKey) || (itemById.has(targetKey) && !itemById.get(targetKey)!.group)
    },
    [groupIds, itemById, kindOf],
  )

  const onDrop = useCallback(
    (dragKey: string, target: DropTarget) => {
      const { items: currentItems, groups: currentGroups } = latest.current
      const grouped = kindOf(dragKey) === 'grouped'
      const outcome = grouped
        ? dropItemInGroup(currentItems, currentGroups, dragKey, target.key, target.pos)
        : dropUnit(currentItems, currentGroups, dragKey, target.key, target.pos)

      // `accepts` already keeps a drop off another group's rows, so this is only reachable if the list
      // changed mid-drag; kept so that race is spoken rather than silent (docs/DECISIONS.md).
      if (outcome.kind === 'refused') announce(text.onlyInsideGroup)
      if (outcome.kind !== 'moved') return

      announce(said(outcome))
      void commit(outcome).then((saved) => {
        if (!saved) return
        showToast({
          text: outcome.groupName ? text.movedInside(outcome.groupName) : text.movedOnList,
          actionLabel: copy.quantum.list.itemActions.undo,
          onAction: () => void undoTo(outcome.previous, outcome.pulseIds),
        })
      })
    },
    // `said` only reads copy.
    [kindOf, commit, showToast, undoTo, announce, text],
  )

  const drag = useRowDrag({ accepts, onDrop })
  const draggingUnit = drag.dragKey !== null && kindOf(drag.dragKey) === 'unit'

  // ---- the keyboard ---------------------------------------------------------------------------

  const run = useRef<{
    items: Map<string, number>
    groups: Map<string, number>
    /** The group the last step moved inside, for the toast the drag would have raised. */
    groupName: string | undefined
    timer: ReturnType<typeof setTimeout> | undefined
  } | null>(null)

  const endRun = useCallback(() => {
    const current = run.current
    if (!current) return
    clearTimeout(current.timer)
    run.current = null

    const previous: OrderRestore = {
      items: [...current.items].map(([id, orderIndex]) => ({ id, orderIndex })),
      groups: [...current.groups].map(([id, orderIndex]) => ({ id, orderIndex })),
    }
    showToast({
      text: current.groupName ? text.movedInside(current.groupName) : text.movedOnList,
      actionLabel: copy.quantum.list.itemActions.undo,
      onAction: () => void undoTo(previous, [...current.items.keys()]),
    })
  }, [showToast, text, undoTo])

  const moveByKey = useCallback(
    (rowId: string, dir: -1 | 1) => {
      const { items: currentItems, groups: currentGroups, shown: visibleIds } = latest.current
      const outcome = visibleIds
        ? stepAmongShown(currentItems, currentGroups, rowId, dir, (id) => visibleIds.has(id))
        : groupIds.has(rowId)
          ? stepUnit(currentItems, currentGroups, rowId, dir)
          : stepItemInGroup(currentItems, currentGroups, rowId, dir)

      if (outcome.kind === 'edge') {
        announce(text.atEdge(outcome.side, outcome.groupName))
        return
      }
      if (outcome.kind !== 'moved') return

      // Remember where every row first stood, so one Undo covers the whole run.
      const current = (run.current ??= { items: new Map(), groups: new Map(), groupName: undefined, timer: undefined })
      for (const entry of outcome.previous.items) if (!current.items.has(entry.id)) current.items.set(entry.id, entry.orderIndex)
      for (const entry of outcome.previous.groups) if (!current.groups.has(entry.id)) current.groups.set(entry.id, entry.orderIndex)
      current.groupName = outcome.groupName
      clearTimeout(current.timer)
      current.timer = setTimeout(endRun, RUN_IDLE_MS)

      pendingFocus.current = rowId
      announce(said(outcome))
      void commit(outcome)
    },
    // `said` only reads copy.
    [groupIds, announce, commit, endRun, text],
  )

  // A move re-orders the rows, which takes focus off the one that moved: put it back.
  useLayoutEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    pendingFocus.current = null
    const moved = spine.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)
    // A row that already holds focus is not scrolled to by focus() (React may move its neighbour's
    // node instead of it), so a long list would leave it behind: ask for the scroll ourselves.
    moved?.focus({ preventScroll: true })
    moved?.scrollIntoView?.({ block: 'nearest' })
  }, [items, groups, spine])

  /** Focus left a row: a run ends once it has settled outside the list (a move's own re-render blurs for a moment). */
  const onBlur = useCallback(() => {
    setTimeout(() => {
      if (pendingFocus.current) return
      if (spine.current?.contains(document.activeElement)) return
      endRun()
    }, 0)
  }, [endRun, spine])

  // Leaving the screen ends the run too: its toast follows you out.
  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
      endRun()
    }
  }, [endRun])

  return {
    dragKey: drag.dragKey,
    over: drag.over,
    startDrag: drag.startDrag,
    /** True while a block (a group or a loose item) is carried: every group shuts so only boundaries are targets. */
    draggingUnit,
    moveByKey,
    onBlur,
  }
}
