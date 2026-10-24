import './PreviewLayer.css'
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { formatDuration } from '../../../formatDuration.js'
import { api, type MediaType, type SourcePreview } from '../../../lib/api.js'
import {
  createFromSourceInput,
  groupPreviewRows,
  summarizePreview,
  type PreviewSource,
} from '../../../lib/preview.js'
import { loadVirtualization } from '../../../lib/listVirtualization.js'
import { getPreferencesStore } from '../../../lib/preferences/store.js'
import { copy, sourceLabel } from '../../../locale/index.js'
import { buildRowModel, offsetOf, scrollAfterChange, shouldVirtualize, type VirtualizationMode } from '../../../screens/list/rowModel.js'
import { loadPreviewRail, RAIL_WIDTH_DEFAULT, savePreviewRailHidden, savePreviewRailWidth } from '../../../screens/list/collapse.js'
import { JumpRail, JumpRailStub, type RailEntry } from '../../../screens/list/JumpRail.js'
import { cardMargin, RAIL_AIR, shownRailWidth } from '../../../screens/list/railPlacement.js'
import { useRailPlacement } from '../../../screens/list/RailPlacementContext.js'
import { DEFAULT_VIEWPORT, WindowedRows } from '../../../screens/list/WindowedRows.js'
import { Button, IconButton } from '../Button/Button.js'
import { ErrorBlock } from '../ErrorBlock/ErrorBlock.js'
import { HeaderPlate } from '../HeaderPlate/HeaderPlate.js'
import { platformChipLabel } from '../PlatformChip/PlatformChip.js'
import { PreviewRow } from '../PreviewRow/PreviewRow.js'
import { Spinner } from '../Spinner/Spinner.js'
import { StatusChip } from '../StatusChip/StatusChip.js'
import { useLayerStack } from '../layerStack/LayerStackContext.js'
import { useLiveRegion } from '../LiveRegion/LiveRegion.js'
import { endForKey, endScrollTop } from '../../../screens/list/listEnds.js'
import { PREVIEW_HEIGHTS, previewUnits } from './previewRows.js'

const CANONICAL_PREFIX = 'canonical:'

export interface PreviewLayerProps {
  source: PreviewSource
  /** For the category's default runtime, and the source's name. */
  mediaType: MediaType
  /** Called with the new list's id once Add list succeeds. */
  onBuilt: (listId: string) => void
  /** False while another layer covers this one: its rail, outside the card, would show through the veil. */
  active?: boolean
}

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'done'; preview: SourcePreview; virtualization: VirtualizationMode }

/** The switch, read while the request is in flight (the spinner is showing), so the first frame of rows is already in the right mode. Never throws: unreadable counts as `auto`. */
async function readVirtualization(): Promise<VirtualizationMode> {
  try {
    return await loadVirtualization(getPreferencesStore(), () => api.serverSettings())
  } catch {
    return 'auto'
  }
}

/**
 * The Preview layer (design: "Preview", task 10.15): the whole candidate list
 * in arrival order, before it exists. The header carries the count and total
 * runtime and puts Add list where the result row has it; Esc or the backdrop
 * returns to the results untouched.
 *
 * Add list sends the very request a result row sends (`createFromSourceInput`),
 * so the two make the same list.
 */
export function PreviewLayer({ source, mediaType, onBuilt, active = true }: PreviewLayerProps) {
  const text = copy.quantum.preview
  const layerStack = useLayerStack()
  const { announce } = useLiveRegion()

  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  // The jump rail's fold and width are remembered once for every Preview (it has no list of its own).
  const [rail, setRail] = useState({ hidden: false, width: RAIL_WIDTH_DEFAULT })
  const [jumpTo, setJumpTo] = useState<{ id: string; n: number } | null>(null)

  useEffect(() => {
    let current = true
    void loadPreviewRail(getPreferencesStore()).then((remembered) => current && setRail(remembered))

    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    let current = true
    setLoad({ state: 'loading' })

    Promise.all([api.preview(source.mediaType, source.externalRef, source.options), readVirtualization()])
      .then(([preview, virtualization]) => current && setLoad({ state: 'done', preview, virtualization }))
      .catch(
        (cause: unknown) =>
          current &&
          setLoad({
            state: 'error',
            message: cause instanceof Error ? cause.message : text.loadFailedHeadline,
          }),
      )

    return () => {
      current = false
    }
    // The source is fixed for a layer's lifetime; only Retry re-runs this.
  }, [attempt])

  const items = load.state === 'done' ? load.preview.items : []
  const rows = useMemo(() => groupPreviewRows(items), [items])
  const units = useMemo(() => previewUnits(rows), [rows])
  const model = useMemo(() => buildRowModel(units, (label) => collapsed.has(label), PREVIEW_HEIGHTS), [units, collapsed])
  // A long Preview draws only the rows near the view (Phase 26.2); under 200 rows, or with the switch off, every row, as it always did.
  const windowed = load.state === 'done' && shouldVirtualize(model.rowTops.size, load.virtualization)
  const body = useRef<HTMLDivElement>(null)
  const windowSync = useRef<(() => void) | null>(null)
  // A group head that has the focus stays drawn wherever the body is scrolled, so the focus is never lost to the window.
  const [focused, setFocused] = useState<string | null>(null)
  const pinned = useMemo(() => new Set(focused ? [focused] : []), [focused])
  // Where each row is, for a screen reader: only while windowed, which shows a fraction of the rows. Counted among the rows there are (the rows
  // of a folded group are not), the heads among the heads; the same numbers the list screen says.
  const places = useMemo(() => {
    if (!windowed) return undefined
    const itemAt = new Map<string, number>()
    const groupAt = new Map<string, number>()
    for (const { unit, members } of units) {
      if (unit.kind === 'item') itemAt.set(unit.item.id, itemAt.size + 1)
      else {
        groupAt.set(unit.group.id, groupAt.size + 1)
        if (!collapsed.has(unit.group.name)) for (const member of members) itemAt.set(member.id, itemAt.size + 1)
      }
    }

    return { itemAt, groupAt }
  }, [windowed, units, collapsed])
  // The rail is the map of the whole Preview: every group, with how many items it has (there is nothing done to count).
  const railEntries = useMemo<RailEntry[]>(
    () => units.flatMap(({ unit }) => (unit.kind === 'group' && unit.group.count > 0 ? [{ id: unit.group.id, name: unit.group.name, total: unit.group.count }] : [])),
    [units],
  )
  const railWindow = useRailPlacement()
  const railOutside = railWindow.placement === 'outside'
  const railMargin = cardMargin(railWindow.windowWidth)
  const showRail = railEntries.length > 1 && (active || !railOutside)
  const placeId = useId()
  const summary = summarizePreview(items, mediaType.defaultDurationMinutes)
  // A category whose convention names platforms gets chips, as wide as the widest label (as on the list).
  const platformWidthCh = useMemo(
    () =>
      mediaType.facets?.some((facet) => facet.key === 'platform')
        ? Math.max(5, ...items.map((entry) => platformChipLabel(entry.tags ?? [])?.length ?? 0))
        : undefined,
    [mediaType, items],
  )

  // The reader keeps their place when a group folds or opens: the group at the top of the view stays where it is.
  const modelSeen = useRef(model)
  const scrolledAt = useRef(0)
  useLayoutEffect(() => {
    const before = modelSeen.current
    modelSeen.current = model
    const element = body.current
    if (before === model || !element || !windowed) return
    const next = scrollAfterChange(before, model, scrolledAt.current, element.clientHeight || DEFAULT_VIEWPORT.height)
    if (Math.abs(element.scrollTop - next) >= 1) element.scrollTop = next
    windowSync.current?.()
  }, [model, windowed])

  function setRailHidden(hidden: boolean) {
    setRail((current) => ({ ...current, hidden }))
    void savePreviewRailHidden(getPreferencesStore(), hidden)
  }

  function jump(entry: RailEntry) {
    setCollapsed((current) => {
      if (!current.has(entry.name)) return current
      const next = new Set(current)
      next.delete(entry.name)

      return next
    })
    setJumpTo((current) => ({ id: entry.id, n: (current?.n ?? 0) + 1 }))
  }

  // After the rows of an opened group exist: the group's head goes to the top. Declared after the effect that keeps the reader's place, so this one wins.
  useLayoutEffect(() => {
    if (!jumpTo) return
    const element = body.current
    const top = offsetOf(model, jumpTo.id)
    if (element && top !== undefined) {
      element.scrollTop = Math.round(top)
      scrolledAt.current = element.scrollTop
      windowSync.current?.()
    }
    setJumpTo(null)
  }, [jumpTo])

  /**
   * Home / End (H-019): the rows go to the very top or bottom at once, as on the list. The Preview's rows are read-only, so there is no row to
   * move focus to; focus goes to the scroller itself. A group head that kept it would stay pinned at the other end, and WebKit then
   * sometimes scrolls back to it as the rows are redrawn (seen in the e2e, about one run in forty under load).
   */
  function onBodyKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const end = endForKey(event.key)
    const element = body.current
    if (end === null || !element || load.state !== 'done') return
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return

    event.preventDefault()
    element.scrollTop = Math.round(endScrollTop(end, element.scrollHeight))
    scrolledAt.current = element.scrollTop
    windowSync.current?.()
    element.focus({ preventScroll: true })
    announce(end === 'top' ? copy.quantum.list.ends.top : copy.quantum.list.ends.bottom)
  }

  function toggle(label: string) {
    // Where the reader is now, before the rows change under them (the browser may clamp the position once they do).
    scrolledAt.current = body.current?.scrollTop ?? 0
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  async function add() {
    setAdding(true)
    setAddError(null)

    try {
      const list = await api.createFromSource(createFromSourceInput(source))
      onBuilt(list.id)
    } catch (cause) {
      setAddError(cause instanceof Error ? cause.message : text.loadFailedHeadline)
      setAdding(false)
    }
  }

  const curated = source.externalRef.startsWith(CANONICAL_PREFIX)
  const provenance = curated
    ? copy.quantum.search.curatedProvenance
    : copy.quantum.search.sourceProvenance(sourceLabel(mediaType) ?? mediaType.label)
  const canAdd = load.state === 'done' && load.preview.items.length > 0

  return (
    <div className="q-preview">
      <div className="q-preview-head">
        <HeaderPlate side="right" seed={4} marks />
        <div className="q-preview-top">
          <div className="q-preview-titles">
            <p className="q-kicker">{text.title}</p>
            <h1 className="q-preview-title">
              {source.title}
              {load.state === 'done' && <StatusChip status={load.preview.status ?? null} />}
            </h1>
            {load.state === 'done' && (
              <p className="q-preview-summary">
                {text.summary(summary.count, formatDuration(summary.minutes), summary.estimated)}
              </p>
            )}
          </div>
          <div className="q-preview-actions">
            <Button
              variant="primary"
              disabled={!canAdd}
              busy={adding}
              busyLabel={text.adding}
              onClick={() => void add()}
            >
              {text.addButton}
            </Button>
            <IconButton label={text.closeLabel} onClick={() => layerStack.pop()}>
              <X width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      </div>

      <div className="q-preview-lower">
        <div className="q-preview-cols">
          {showRail && !railOutside && !rail.hidden && (
            <JumpRail
              entries={railEntries}
              onJump={jump}
              onHide={() => setRailHidden(true)}
              width={shownRailWidth(rail.width, railWindow)}
              onResize={(width) => {
                railWindow.release?.()
                setRail((current) => ({ ...current, width }))
              }}
              onResizeEnd={(width) => void savePreviewRailWidth(getPreferencesStore(), width)}
            />
          )}
          {showRail && !railOutside && rail.hidden && <JumpRailStub onShow={() => setRailHidden(false)} />}
          <div className="q-preview-body" ref={body} tabIndex={-1} onKeyDown={onBodyKeyDown}>
            {load.state === 'loading' && (
              <div className="q-preview-progress">
                <Spinner label={text.loading} />
                <span>{text.loading}</span>
              </div>
            )}
            {load.state === 'error' && (
              <ErrorBlock
                headline={text.loadFailedHeadline}
                explanation={load.message}
                action={{ label: text.retry, onClick: () => setAttempt((count) => count + 1) }}
              />
            )}
            {addError && (
              <ErrorBlock headline={text.loadFailedHeadline} explanation={addError} />
            )}
            {load.state === 'done' && load.preview.items.length === 0 && (
              <ErrorBlock headline={text.nothingToAdd} />
            )}
            {places && <p className="q-place">{text.place.note(places.itemAt.size)}</p>}
            {load.state === 'done' && (
              <WindowedRows
                shown={units}
                model={model}
                enabled={windowed}
                pinned={pinned}
                scroller={body}
                syncRef={windowSync}
                renderItem={(entry) => (
                  <PreviewRow
                    key={entry.id}
                    item={entry.item}
                    grouped={entry.grouped}
                    facets={mediaType.facets}
                    platformWidthCh={platformWidthCh}
                    place={places?.itemAt.has(entry.id) ? text.place.item(places.itemAt.get(entry.id)!, places.itemAt.size) : undefined}
                  />
                )}
                renderGroup={({ unit }, members) => {
                  if (unit.kind !== 'group') return null
                  const isCollapsed = collapsed.has(unit.group.name)

                  // A fragment, not a block: the Preview's markup is flat, a head and then its rows, as it always was.
                  return (
                    <Fragment key={unit.group.id}>
                      <button
                        type="button"
                        className="q-preview-group"
                        aria-expanded={!isCollapsed}
                        aria-label={isCollapsed ? text.expandGroup(unit.group.name) : text.collapseGroup(unit.group.name)}
                        onClick={() => toggle(unit.group.name)}
                        onFocus={() => setFocused(unit.group.id)}
                        aria-describedby={places ? `${placeId}${unit.group.id}` : undefined}
                      >
                        {/* One glyph, turned a quarter in CSS when folded: the list screen's group rows and the design's PreviewRow do the same. */}
                        <span className="q-chev" aria-hidden="true">
                          ▼
                        </span>
                        <span className="name">{unit.group.name}</span>
                        <span className="count">{text.groupItems(unit.group.count)}</span>
                        {places?.groupAt.has(unit.group.id) && (
                          <span className="q-place" id={`${placeId}${unit.group.id}`}>
                            {text.place.group(places.groupAt.get(unit.group.id)!, places.groupAt.size)}
                          </span>
                        )}
                      </button>
                      {members}
                    </Fragment>
                  )
                }}
              />
            )}
          </div>
        </div>
        {showRail && railOutside && (
          <JumpRail
            entries={railEntries}
            onJump={jump}
            onHide={() => setRailHidden(true)}
            width={shownRailWidth(rail.width, railWindow)}
            maxWidth={railMargin - RAIL_AIR}
            onResize={(width) => setRail((current) => ({ ...current, width }))}
            onResizeEnd={(width) => void savePreviewRailWidth(getPreferencesStore(), width)}
            placement="outside"
            folded={rail.hidden}
            onShow={() => setRailHidden(false)}
          />
        )}

        <p className="q-preview-footer t-small">{text.footer(provenance)}</p>
      </div>
    </div>
  )
}
