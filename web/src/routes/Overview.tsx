import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Progress } from '../components/Progress.js'
import { api, type MediaList, type MediaType } from '../lib/api.js'
import { buildBuckets, findOrphanedLists } from '../lib/buckets.js'
import { formatDuration } from '../formatDuration.js'

function ListRow({ list }: { list: MediaList }) {
  const { stats } = list

  return (
    <li>
      <Link className="row" to={`/lists/${list.id}`}>
        <span className="row__title">{list.title}</span>
        <span className="row__meta">
          <Progress
            percent={stats.completionPercent}
            label={`${stats.completionPercent}% complete`}
          />
          <span>
            {stats.consumedItems}/{stats.totalItems}
          </span>
          <span className="faint">
            {stats.timeRemainingMinutes > 0
              ? `${formatDuration(stats.timeRemainingMinutes)} left`
              : stats.totalItems > 0
                ? 'done'
                : 'empty'}
          </span>
        </span>
      </Link>
    </li>
  )
}

function Bucket({ mediaType, lists }: { mediaType: MediaType; lists: MediaList[] }) {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">{mediaType.label}</h2>
        <span className="panel__count">
          {lists.length} {lists.length === 1 ? 'list' : 'lists'}
        </span>
      </header>
      <ul className="rows">
        {lists.map((list) => (
          <ListRow key={list.id} list={list} />
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
        <h2 className="panel__title">{mediaType.label}</h2>
      </header>
      <p className="panel__empty">
        <span>Nothing here yet.</span>
        <Link className="button" to={`/lists/new?mediaType=${mediaType.key}`}>
          Add a list
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

  useEffect(() => {
    let cancelled = false

    api
      .lists()
      .then((loaded) => {
        if (!cancelled) setLists(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load lists')
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p className="notice notice--error">{error}</p>
  if (!lists) return <p className="muted">Loading…</p>

  const { used, unused, isFirstRun } = buildBuckets(lists, mediaTypes)
  const orphaned = findOrphanedLists(lists, mediaTypes)

  return (
    <>
      <div className="page__header">
        <h1 className="page__title">Your lists</h1>
        <Link className="button button--primary" to="/lists/new">
          New list
        </Link>
      </div>

      {isFirstRun && (
        <p className="notice">
          Nothing tracked yet. Pick a category and add your first list — all the Jackie Chan
          movies, a discography, a game franchise. The point is finishing them.
        </p>
      )}

      {isFirstRun
        ? mediaTypes.map((mediaType) => <EmptyBucket key={mediaType.key} mediaType={mediaType} />)
        : used.map((bucket) => (
            <Bucket key={bucket.mediaType.key} mediaType={bucket.mediaType} lists={bucket.lists} />
          ))}

      {!isFirstRun && unused.length > 0 && (
        <p className="also">
          also:{' '}
          {unused.map((mediaType, index) => (
            <span key={mediaType.key}>
              {index > 0 && ' · '}
              <Link to={`/lists/new?mediaType=${mediaType.key}`}>{mediaType.label}</Link>
            </span>
          ))}
          {' — nothing tracked in these yet'}
        </p>
      )}

      {orphaned.length > 0 && (
        <section className="panel">
          <header className="panel__header">
            <h2 className="panel__title">Uncategorised</h2>
            <span className="panel__count">category no longer exists</span>
          </header>
          <ul className="rows">
            {orphaned.map((list) => (
              <ListRow key={list.id} list={list} />
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
