import './Home.css'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { RefreshCw } from 'lucide-react'
import { api, type MediaList, type MediaType } from '../../../lib/api.js'
import { buildBuckets, findOrphanedLists, listMark } from '../../../lib/buckets.js'
import { formatDuration } from '../../../formatDuration.js'
import { categoryLabel, copy } from '../../../locale/index.js'
import { Button, IconButton } from '../Button/Button.js'
import { HeaderPlate } from '../HeaderPlate/HeaderPlate.js'
import { HomeRow } from '../HomeRow/HomeRow.js'
import { Banner } from '../Banner/Banner.js'
import { ErrorBlock } from '../ErrorBlock/ErrorBlock.js'
import { useToast } from '../Toast/Toast.js'
import { useLayerStack } from '../layerStack/LayerStackContext.js'
import { loadLastOpened } from '../../../lib/lastOpened.js'
import { subscribeListsChanged } from '../../../lib/listsChanged.js'
import { previewPath } from '../../../lib/preview.js'
import { getPreferencesStore } from '../../../lib/preferences/store.js'
import { FinalizerSheet } from '../HelperSheet/FinalizerSheet.js'
import { JustOneFixSheet } from '../HelperSheet/JustOneFixSheet.js'
import { SurpriseSheet } from '../HelperSheet/SurpriseSheet.js'
import { TiredBossSheet } from '../HelperSheet/TiredBossSheet.js'
import { getPendingUpdates, useChecking, usePendingMap, type PendingUpdates } from '../../../lib/pendingUpdates.js'
import { applyUpdate, checkLists } from '../../../lib/updateCheck.js'
import type { LibraryEntry } from '../../../../../server/src/ingestion/customLists.js'
import type { LayerDescriptor } from '../layerStack/layerStack.js'

type Phase = 'loading' | 'ready' | 'error'

function categoryPickerLayer(): LayerDescriptor<string> {
  return {
    id: 'category-picker',
    kind: 'category-picker',
    tabLabel: () => copy.quantum.categoryPicker.title,
    content: '/',
  }
}

function listLayer(list: MediaList): LayerDescriptor<string> {
  return { id: `list-${list.id}`, kind: 'list', tabLabel: list.title, content: `/lists/${list.id}` }
}

/** How far the helper sheet hangs below the help row, before it starts. */
const SHEET_DROP = 18

/** At most this many update bands at once; handling one lets the next take its place. */
const MAX_UPDATE_BANDS = 3

export interface HomeProps {
  /** For a test; the app's own store otherwise. */
  pendingUpdates?: PendingUpdates
  /** Lifts the loaded registry up to `AppShellBody` — the hosted legacy screens (List detail, New list) need it too, and only Home fetches it (task 10.10). */
  onMediaTypesLoaded: (mediaTypes: MediaType[]) => void
}

/**
 * My Lists (design-system, task 10.10) — replaces the old hosted `Overview`.
 * A real Quantum screen, not routed: it talks to `useLayerStack()` directly
 * instead of going through `LegacyRouteHost`'s path-based navigation.
 */
export function Home({ onMediaTypesLoaded, pendingUpdates }: HomeProps) {
  const layerStack = useLayerStack()
  const { showToast } = useToast()
  const isTop = layerStack.stack.length === 1

  const [phase, setPhase] = useState<Phase>('loading')
  const [lists, setLists] = useState<MediaList[]>([])
  const [mediaTypes, setMediaTypes] = useState<MediaType[]>([])
  const [error, setError] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  // The open helper sheet, if any; it starts on the list opened last.
  const [helper, setHelper] = useState<
    { kind: 'tired'; initialTarget: string | undefined } | { kind: 'finalizer' | 'justOneFix' | 'surprise' } | null
  >(null)
  // The room the sheet has: from just under the help row to the bottom of the card that clips it.
  const homeRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    if (!helper) return undefined

    function measure() {
      const home = homeRef.current
      const anchor = anchorRef.current
      if (!home || !anchor) return
      // A banner appearing above moves the anchor, so this runs after every render as well as on resize.
      const next = Math.max(120, Math.floor(home.getBoundingClientRect().bottom - anchor.getBoundingClientRect().top - SHEET_DROP))
      setRoom((current) => (current === next ? current : next))
    }

    measure()
    window.addEventListener('resize', measure)

    return () => window.removeEventListener('resize', measure)
  })

  // What explicit checks have found and nobody has applied or dismissed yet
  // (persisted; owner rulings, 10.22c). Nothing here checks by itself.
  const [pending] = useState(() => pendingUpdates ?? getPendingUpdates())
  const pendingMap = usePendingMap(pending)
  const checkingUpdates = useChecking(pending)
  const [applying, setApplying] = useState<ReadonlySet<string>>(new Set())

  // Refetches every time Home becomes the top layer again (not just on first
  // mount) — Home is never unmounted while covered, so a mount-only effect
  // would show stale counts after creating a list and returning
  // (docs/DECISIONS.md, "Hosted old screens don't refetch when a layer is
  // popped back to" — the gap 10.10 exists to close for Home itself).
  //
  // Stale-while-revalidating, not a loading flash: only the *first* fetch
  // (nothing loaded yet, or the previous one errored) shows the loading
  // state. Every later one — the whole point of refetching on return —
  // fetches quietly behind the already-rendered rows, swapping them only
  // once the new data actually arrives. Without this, `.q-home-body` swaps
  // to a different child on every return and React remounts it, so the
  // banner and help row would flash away and back on every single pop —
  // not "stale scroll position" like the hosted legacy screens' known gap,
  // a strictly worse regression of it.
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    if (!isTop) return
    let cancelled = false
    if (!hasLoadedRef.current) setPhase('loading')

    Promise.all([api.mediaTypes(), api.lists()])
      .then(([fetchedTypes, fetchedLists]) => {
        if (cancelled) return
        hasLoadedRef.current = true
        onMediaTypesLoaded(fetchedTypes)
        // A list that is gone takes its pending update with it.
        void pending.prune(fetchedLists.map((entry) => entry.id))

        if (fetchedLists.length === 0) {
          // First run: the Category picker *is* the base layer (matches the
          // design prototype's own boot stack, `[{kind:'cats', first:true}]`).
          // No way back, because there is nothing yet to go back to. Also
          // reachable by deleting the last remaining list and returning —
          // accepted, not special-cased (docs/DECISIONS.md).
          layerStack.replaceTop(categoryPickerLayer())
          return
        }

        setMediaTypes(fetchedTypes)
        setLists(fetchedLists)
        setPhase('ready')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // A revalidation failure (already showing good data) keeps that
        // data on screen rather than replacing it with an error — the same
        // "degrade quietly" call already made for the update check below.
        // Only a first-ever failure gets the real ErrorBlock.
        if (hasLoadedRef.current) return
        setError(cause instanceof Error ? cause.message : copy.quantum.home.loadFailed)
        setPhase('error')
      })

    return () => {
      cancelled = true
    }
  }, [isTop, retryToken])

  // Something elsewhere added or removed a list while Home was covered (the
  // Undo of a delete, say): the ordinary top-layer refetch will not fire.
  useEffect(() => subscribeListsChanged(() => setRetryToken((token) => token + 1)), [])

  /** Opens a helper sheet (I'm Tired, Boss on the list opened last), or closes it if it is the one already open. One at a time. */
  async function toggleHelper(kind: 'tired' | 'finalizer' | 'justOneFix' | 'surprise') {
    if (helper?.kind === kind) {
      setHelper(null)
      return
    }
    setHelper(kind === 'tired' ? { kind, initialTarget: await loadLastOpened(getPreferencesStore()) } : { kind })
  }

  /** Surprise Me's This One: the same preview a search result opens, from where you are; nothing is created until Add list. */
  const previewLibraryEntry = (entry: LibraryEntry) => {
    setHelper(null)
    layerStack.push({
      id: `preview-${entry.externalRef}`,
      kind: 'preview',
      tabLabel: () => copy.quantum.search.previewTab(entry.title),
      content: previewPath({ mediaType: entry.category, externalRef: entry.externalRef, title: entry.title, options: {} }),
    })
  }

  const openHelperList = (listId: string) => {
    const target = lists.find((entry) => entry.id === listId)
    setHelper(null)
    if (target) layerStack.push(listLayer(target))
  }

  /** Home's explicit check: every list with a source, a band appearing as each is answered. */
  async function checkUpdatesNow() {
    try {
      const summary = await checkLists(lists, { api, pending })
      if (!summary) return

      if (summary.failed.length > 0) {
        showToast({ text: copy.quantum.home.checkPartial(summary.failed.map((entry) => entry.title)) })
      } else if (summary.found === 0) {
        showToast({ text: copy.quantum.home.noNewUpstream })
      }
    } catch (cause) {
      showToast({
        text: cause instanceof Error ? cause.message : copy.quantum.home.checkUpdatesFailed,
      })
    }
  }

  /** Update List from its band: adds what is new as arrivals, right here, without opening the list. */
  async function applyFromBand(target: MediaList) {
    setApplying((current) => new Set(current).add(target.id))

    try {
      const added = await applyUpdate(target.id, { api, pending })
      showToast({
        text:
          added === 0
            ? copy.quantum.home.noNewUpstream
            : copy.quantum.home.updateApplied(added, target.title),
      })
      // The row's N NEW badge comes from a fresh read.
      setRetryToken((token) => token + 1)
    } catch (cause) {
      showToast({ text: cause instanceof Error ? cause.message : copy.quantum.home.updateFailed })
    } finally {
      setApplying((current) => {
        const next = new Set(current)
        next.delete(target.id)
        return next
      })
    }
  }

  if (phase === 'loading') {
    return (
      <div className="q-home">
        <HomeHeader onCheckUpdates={undefined} checking={false} />
        <div className="q-home-body">
          <p>{copy.app.loading}</p>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="q-home">
        <HomeHeader onCheckUpdates={undefined} checking={false} />
        <div className="q-home-body">
          <ErrorBlock
            headline={copy.quantum.home.loadFailed}
            explanation={error ?? copy.quantum.home.loadFailed}
            action={{ label: copy.quantum.home.retry, onClick: () => setRetryToken((n) => n + 1) }}
          />
        </div>
      </div>
    )
  }

  const { used } = buildBuckets(lists, mediaTypes)
  const orphaned = findOrphanedLists(lists, mediaTypes)
  const totals = lists.reduce(
    (sum, entry) => ({
      done: sum.done + entry.stats.consumedItems,
      total: sum.total + entry.stats.totalItems,
      left: sum.left + entry.stats.timeRemainingMinutes,
    }),
    { done: 0, total: 0, left: 0 },
  )

  function openList(list: MediaList) {
    layerStack.push(listLayer(list))
  }

  // The lists in the order they are shown, so "the first three" is what the reader sees first.
  const shownOrder = [...used.flatMap((bucket) => bucket.lists), ...orphaned]
  const bandIds = pending.visible(
    shownOrder.map((entry) => entry.id),
    MAX_UPDATE_BANDS,
  )

  return (
    <div className="q-home" ref={homeRef}>
      <HomeHeader
        onCheckUpdates={() => void checkUpdatesNow()}
        checking={checkingUpdates}
        summary={copy.quantum.home.summary(
          copy.quantum.home.listCount(lists.length),
          totals.done,
          totals.total,
          totals.left > 0 ? formatDuration(totals.left) : null,
        )}
        onNew={() => layerStack.push(categoryPickerLayer())}
      />

      {bandIds.map((id) => {
        const target = shownOrder.find((entry) => entry.id === id)!
        const count = pendingMap[id]!.count

        return (
          <Banner
            key={id}
            dismissLabel={copy.quantum.home.dismissUpdate}
            onDismiss={() => void pending.remove(id)}
            action={{
              label: copy.quantum.home.updateList,
              onClick: () => void applyFromBand(target),
              busy: applying.has(id),
            }}
          >
            <b>{target.title}</b>
            {copy.quantum.home.pendingBand(count)}
          </Banner>
        )
      })}

      <div className="q-help-row">
        <span className="q-kicker section">{copy.quantum.home.needHelp}</span>
        {/* The lit button says which sheet is open; a press on it must not also count as "outside" and close the sheet first. */}
        {(
          [
            ['tired', copy.quantum.home.helpButtons.tiredBoss],
            ['finalizer', copy.quantum.home.helpButtons.finalizer],
            ['justOneFix', copy.quantum.home.helpButtons.justOneFix],
            ['surprise', copy.quantum.home.helpButtons.surpriseMe],
          ] as const
        ).map(([kind, label]) => (
          <Button
            key={kind}
            variant="quiet"
            size="sm"
            className={helper?.kind === kind ? 'on' : undefined}
            aria-pressed={helper?.kind === kind}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void toggleHelper(kind)}
          >
            {label}
          </Button>
        ))}
      </div>
      {helper && (
        <div className="q-help-anchor" ref={anchorRef} style={{ '--help-room': room === undefined ? undefined : `${room}px` } as CSSProperties}>
          {helper.kind === 'tired' ? (
            <TiredBossSheet
              open
              onClose={() => setHelper(null)}
              lists={lists}
              initialTarget={helper.initialTarget}
              onOpenList={openHelperList}
            />
          ) : helper.kind === 'finalizer' ? (
            <FinalizerSheet open onClose={() => setHelper(null)} onOpenList={openHelperList} />
          ) : helper.kind === 'justOneFix' ? (
            <JustOneFixSheet open onClose={() => setHelper(null)} onOpenList={openHelperList} />
          ) : (
            <SurpriseSheet open onClose={() => setHelper(null)} mediaTypes={mediaTypes} onTake={previewLibraryEntry} />
          )}
        </div>
      )}

      <div className="q-home-body">
        {used.map((bucket) => (
          <section key={bucket.mediaType.key} className="q-bucket">
            <div className="q-kicker-bar">
              <span className="q-kicker strong">{categoryLabel(bucket.mediaType)}</span>
            </div>
            {bucket.lists.map((list) => (
              <HomeRow
                key={list.id}
                title={list.title}
                description={list.description}
                mark={listMark(list)}
                status={list.status}
                done={list.stats.consumedItems}
                total={list.stats.totalItems}
                minutesLeft={list.stats.timeRemainingMinutes}
                newCount={list.stats.newItems}
                onOpen={() => openList(list)}
              />
            ))}
          </section>
        ))}

        {orphaned.length > 0 && (
          <section className="q-bucket">
            <div className="q-kicker-bar">
              <span className="q-kicker strong">{copy.quantum.home.orphanedTitle}</span>
              <span className="q-kicker">{copy.quantum.home.orphanedNote}</span>
            </div>
            {orphaned.map((list) => (
              <HomeRow
                key={list.id}
                title={list.title}
                description={list.description}
                mark={listMark(list)}
                status={list.status}
                done={list.stats.consumedItems}
                total={list.stats.totalItems}
                minutesLeft={list.stats.timeRemainingMinutes}
                newCount={list.stats.newItems}
                onOpen={() => openList(list)}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

interface HomeHeaderProps {
  summary?: string
  checking: boolean
  onCheckUpdates: (() => void) | undefined
  onNew?: () => void
}

function HomeHeader({ summary, checking, onCheckUpdates, onNew }: HomeHeaderProps) {
  return (
    <div className="q-home-head">
      <HeaderPlate side="left" seed={0} />
      <div>
        <h1 className="q-home-title">{copy.quantum.home.title}</h1>
        {summary !== undefined && <div className="q-home-summary">{summary}</div>}
      </div>
      {onCheckUpdates && onNew && (
        <div className="q-home-actions">
          <IconButton
            label={copy.quantum.home.checkForUpdates}
            onClick={onCheckUpdates}
            disabled={checking}
          >
            <RefreshCw
              width={17}
              height={17}
              strokeWidth={1.9}
              aria-hidden="true"
              className={checking ? 'q-spin' : undefined}
            />
          </IconButton>
          <Button variant="primary" onClick={onNew}>
            {copy.quantum.home.newList}
          </Button>
        </div>
      )}
    </div>
  )
}
