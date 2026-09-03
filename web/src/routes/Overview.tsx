import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Progress } from '../components/Progress.js'
import { Suggestions } from '../components/Suggestions.js'
import { api, type MediaList, type MediaType } from '../lib/api.js'
import { buildBuckets, findOrphanedLists } from '../lib/buckets.js'
import { formatDuration } from '../formatDuration.js'
import { categoryLabel, copy } from '../locale/index.js'

function ListRow({ list }: { list: MediaList }) {
  const { stats } = list

  return (
    <li>
      <Link className="row" to={`/lists/${list.id}`}>
        <span className="row__title">{list.title}</span>
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

function Bucket({ mediaType, lists }: { mediaType: MediaType; lists: MediaList[] }) {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">{categoryLabel(mediaType)}</h2>
        <span className="panel__count">{copy.overview.listCount(lists.length)}</span>
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

    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p className="notice notice--error">{error}</p>
  if (!lists) return <p className="muted">{copy.app.loading}</p>

  const { used, unused, isFirstRun } = buildBuckets(lists, mediaTypes)
  const orphaned = findOrphanedLists(lists, mediaTypes)

  return (
    <>
      <div className="page__header">
        <h1 className="page__title">{copy.overview.title}</h1>
        <Link className="button button--primary" to="/lists/new">
          {copy.overview.newList}
        </Link>
      </div>

      {/* Hidden on first run: three buttons that can only answer "you have
          nothing" are noise when the job is to add a first list. */}
      {!isFirstRun && <Suggestions lists={lists} />}

      {isFirstRun && (
        <p className="notice">{copy.overview.firstRun}</p>
      )}

      {isFirstRun
        ? mediaTypes.map((mediaType) => <EmptyBucket key={mediaType.key} mediaType={mediaType} />)
        : used.map((bucket) => (
            <Bucket key={bucket.mediaType.key} mediaType={bucket.mediaType} lists={bucket.lists} />
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
              <ListRow key={list.id} list={list} />
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
