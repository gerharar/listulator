import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Progress } from '../components/Progress.js'
import { Suggestions } from '../components/Suggestions.js'
import { api, type MediaList, type MediaType } from '../lib/api.js'
import { buildBuckets, findOrphanedLists } from '../lib/buckets.js'
import { formatDuration } from '../formatDuration.js'
import { categoryLabel, copy } from '../locale/index.js'

function ListRow({ list, updated }: { list: MediaList; updated?: boolean }) {
  const { stats } = list

  return (
    <li>
      <Link
        className="row"
        to={`/lists/${list.id}`}
        state={updated ? { updateAvailable: true } : undefined}
      >
        <span className="row__title">{list.title}</span>
        {updated && <span className="row__updated-badge">{copy.overview.updatedBadge}</span>}
        <span className="row__meta">
          <Progress
            percent={stats.completionPercent}
            label={copy.overview.percentComplete(stats.completionPercent)}
          />
          <span>
            {stats.consumedItems}/{stats.totalItems}
          </span>
          <span className="faint">
            {stats.timeRemainingMinutes > 0
              ? copy.overview.timeLeft(formatDuration(stats.timeRemainingMinutes))
              : stats.totalItems > 0
                ? copy.overview.allDone
                : copy.overview.noItems}
          </span>
        </span>
      </Link>
    </li>
  )
}

function Bucket({
  mediaType,
  lists,
  updatedListIds,
}: {
  mediaType: MediaType
  lists: MediaList[]
  updatedListIds: Set<string>
}) {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">{categoryLabel(mediaType)}</h2>
        <span className="panel__count">{copy.overview.listCount(lists.length)}</span>
      </header>
      <ul className="rows">
        {lists.map((list) => (
          <ListRow key={list.id} list={list} updated={updatedListIds.has(list.id)} />
        ))}
      </ul>
    </section>
  )
}

/** First run: every category on offer, so the app explains itself. */
function EmptyBucket({ mediaType }: { mediaType: MediaType }) {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">{categoryLabel(mediaType)}</h2>
      </header>
      <p className="panel__empty">
        <span>{copy.overview.emptyCategory}</span>
        <Link className="button" to={`/lists/new?mediaType=${mediaType.key}`}>
          {copy.overview.addList}
        </Link>
      </p>
    </section>
  )
}

/**
 * Fetches its own lists on mount rather than receiving them from the shell.
 * Client-side navigation back from a list would otherwise show the counts as
 * they were before anything was checked off — stale exactly when the user has
 * just changed something and come back to look.
 */
export function Overview({ mediaTypes }: { mediaTypes: MediaType[] }) {
  const [lists, setLists] = useState<MediaList[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Task 7.6's "this list was updated" notification. `null` means "not
  // checked yet" (no badges, no banner); an empty array means "checked,
  // nothing new". The automatic on-open check degrades silently on failure —
  // it's a nice-to-have, not core data, and a transient GitHub hiccup
  // shouldn't put a scary error on the page the app opens to. The manual
  // "Check for updates" button is an explicit action, so it does report a
  // real failure.
  const [updates, setUpdates] = useState<{ listId: string; title: string }[] | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updatesError, setUpdatesError] = useState<string | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false

    api
      .lists()
      .then((loaded) => {
        if (!cancelled) setLists(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : copy.overview.loadFailed)
      })

    api
      .checkSyncedListUpdates()
      .then(({ updates: found }) => {
        if (!cancelled) setUpdates(found)
      })
      .catch(() => {
        // Silent on purpose — see the state comment above.
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function checkUpdatesNow() {
    setCheckingUpdates(true)
    setUpdatesError(null)
    setBannerDismissed(false)

    try {
      setUpdates((await api.checkSyncedListUpdates()).updates)
    } catch (cause) {
      setUpdatesError(cause instanceof Error ? cause.message : copy.overview.checkUpdatesFailed)
    } finally {
      setCheckingUpdates(false)
    }
  }

  if (error) return <p className="notice notice--error">{error}</p>
  if (!lists) return <p className="muted">{copy.app.loading}</p>

  const { used, unused, isFirstRun } = buildBuckets(lists, mediaTypes)
  const orphaned = findOrphanedLists(lists, mediaTypes)
  const updatedListIds = new Set((updates ?? []).map((entry) => entry.listId))

  return (
    <>
      <div className="page__header">
        <h1 className="page__title">{copy.overview.title}</h1>
        <div className="page__actions">
          {!isFirstRun && (
            <button
              type="button"
              className="button"
              onClick={() => void checkUpdatesNow()}
              disabled={checkingUpdates}
            >
              {checkingUpdates ? copy.overview.checkingUpdates : copy.overview.checkUpdates}
            </button>
          )}
          <Link className="button button--primary" to="/lists/new">
            {copy.overview.newList}
          </Link>
        </div>
      </div>

      {updatesError && <p className="notice notice--error">{updatesError}</p>}

      {!bannerDismissed && updates && updates.length > 0 && (
        <div className="notice notice--info">
          <div className="notice__row">
            <span>
              {copy.overview.updatedCount(updates.length)}
              {updates.map((entry, index) => (
                <span key={entry.listId}>
                  {index > 0 && ', '}
                  <Link to={`/lists/${entry.listId}`} state={{ updateAvailable: true }}>
                    {entry.title}
                  </Link>
                </span>
              ))}
            </span>
            <button
              type="button"
              className="notice__dismiss"
              onClick={() => setBannerDismissed(true)}
            >
              {copy.overview.dismissUpdatesBanner}
            </button>
          </div>
        </div>
      )}

      {/* Hidden on first run: three buttons that can only answer "you have
          nothing" are noise when the job is to add a first list. */}
      {!isFirstRun && <Suggestions lists={lists} />}

      {isFirstRun && <p className="notice">{copy.overview.firstRun}</p>}

      {isFirstRun
        ? mediaTypes.map((mediaType) => <EmptyBucket key={mediaType.key} mediaType={mediaType} />)
        : used.map((bucket) => (
            <Bucket
              key={bucket.mediaType.key}
              mediaType={bucket.mediaType}
              lists={bucket.lists}
              updatedListIds={updatedListIds}
            />
          ))}

      {!isFirstRun && unused.length > 0 && (
        <p className="also">
          {copy.overview.alsoPrefix}
          {unused.map((mediaType, index) => (
            <span key={mediaType.key}>
              {index > 0 && ' · '}
              <Link to={`/lists/new?mediaType=${mediaType.key}`}>{categoryLabel(mediaType)}</Link>
            </span>
          ))}
          {copy.overview.alsoSuffix}
        </p>
      )}

      {orphaned.length > 0 && (
        <section className="panel">
          <header className="panel__header">
            <h2 className="panel__title">{copy.overview.orphanedTitle}</h2>
            <span className="panel__count">{copy.overview.orphanedNote}</span>
          </header>
          <ul className="rows">
            {orphaned.map((list) => (
              <ListRow key={list.id} list={list} updated={updatedListIds.has(list.id)} />
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
