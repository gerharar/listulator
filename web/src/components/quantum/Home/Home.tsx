import './Home.css'
import { useEffect, useRef, useState } from 'react'
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
import { listPath } from '../../../lib/listPath.js'
import { subscribeListsChanged } from '../../../lib/listsChanged.js'
import type { LayerDescriptor } from '../layerStack/layerStack.js'

type Phase = 'loading' | 'ready' | 'error'

function categoryPickerLayer(): LayerDescriptor<string> {
  return {
    id: 'category-picker',
    kind: 'category-picker',
    tabLabel: copy.quantum.categoryPicker.title,
    content: '/',
  }
}

function listLayer(list: MediaList, options: { update?: boolean } = {}): LayerDescriptor<string> {
  return {
    id: `list-${list.id}`,
    kind: 'list',
    tabLabel: list.title,
    content: listPath(list.id, options),
  }
}

export interface HomeProps {
  /** Lifts the loaded registry up to `AppShellBody` — the hosted legacy screens (List detail, New list) need it too, and only Home fetches it (task 10.10). */
  onMediaTypesLoaded: (mediaTypes: MediaType[]) => void
}

/**
 * My Lists (design-system, task 10.10) — replaces the old hosted `Overview`.
 * A real Quantum screen, not routed: it talks to `useLayerStack()` directly
 * instead of going through `LegacyRouteHost`'s path-based navigation.
 */
export function Home({ onMediaTypesLoaded }: HomeProps) {
  const layerStack = useLayerStack()
  const { showToast } = useToast()
  const isTop = layerStack.stack.length === 1

  const [phase, setPhase] = useState<Phase>('loading')
  const [lists, setLists] = useState<MediaList[]>([])
  const [mediaTypes, setMediaTypes] = useState<MediaType[]>([])
  const [error, setError] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  const [updates, setUpdates] = useState<{ listId: string; title: string }[]>([])
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

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

  // The automatic "did anything change upstream" check — once per session
  // (Home never unmounts, so a mount-only effect already means exactly
  // that), and silent on failure: it is a nice-to-have degrading quietly,
  // not core data. The explicit "Check for updates" button below does
  // report a real failure, via a Toast, because that action was asked for.
  useEffect(() => {
    api
      .checkSyncedListUpdates()
      .then(({ updates: found }) => setUpdates(found))
      .catch(() => {})
  }, [])

  async function checkUpdatesNow() {
    setCheckingUpdates(true)
    setBannerDismissed(false)

    try {
      setUpdates((await api.checkSyncedListUpdates()).updates)
    } catch (cause) {
      showToast({
        text: cause instanceof Error ? cause.message : copy.quantum.home.checkUpdatesFailed,
      })
    } finally {
      setCheckingUpdates(false)
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

  function openList(list: MediaList, options: { update?: boolean } = {}) {
    layerStack.push(listLayer(list, options))
  }

  return (
    <div className="q-home">
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

      {!bannerDismissed && updates.length > 0 && (
        <Banner onDismiss={() => setBannerDismissed(true)} dismissLabel={copy.quantum.home.dismissUpdatesBanner}>
          {copy.quantum.home.updatedCount(updates.length)}
          {updates.map((entry, index) => {
            const target = lists.find((candidate) => candidate.id === entry.listId)

            return (
              <span key={entry.listId}>
                {index > 0 && ', '}
                {target ? (
                  <button
                    type="button"
                    className="q-banner-link"
                    onClick={() => openList(target, { update: true })}
                  >
                    <b>{entry.title}</b>
                  </button>
                ) : (
                  <b>{entry.title}</b>
                )}
              </span>
            )
          })}
        </Banner>
      )}

      <div className="q-help-row">
        <span className="q-kicker section">{copy.quantum.home.needHelp}</span>
        {(
          [
            copy.quantum.home.helpButtons.tiredBoss,
            copy.quantum.home.helpButtons.finalizer,
            copy.quantum.home.helpButtons.justOneFix,
            copy.quantum.home.helpButtons.surpriseMe,
          ] as const
        ).map((label) => (
          <Button key={label} variant="quiet" size="sm" disabled title={copy.quantum.home.helpComingSoon(label)}>
            {label}
          </Button>
        ))}
      </div>

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
