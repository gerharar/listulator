import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Progress } from '../components/Progress.js'
import { api, type ListItem, type MediaListDetail, type MediaType } from '../lib/api.js'
import { formatDuration } from '../formatDuration.js'

function Item({
  item,
  onToggle,
  onRemove,
}: {
  item: ListItem
  onToggle: (item: ListItem) => void
  onRemove: (item: ListItem) => void
}) {
  const consumed = item.consumedAt !== null

  return (
    <li className="item-row">
      <button
        type="button"
        className={consumed ? 'item item--consumed' : 'item'}
        onClick={() => onToggle(item)}
        aria-pressed={consumed}
      >
        <span className={consumed ? 'item__box item__box--checked' : 'item__box'} aria-hidden="true">
          {consumed ? '✕' : ''}
        </span>
        <span className="item__title">{item.title}</span>
        <span className="item__duration">
          {/* A leading ~ marks a guessed duration, so a number nobody verified
              never masquerades as fact. */}
          {item.timeToConsumeIsEstimated ? '~' : ''}
          {formatDuration(item.timeToConsumeMinutes)}
        </span>
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
        aria-label={`Remove ${item.title}`}
        title={`Remove ${item.title}`}
      >
        ✕
      </button>
    </li>
  )
}

export function ListDetail({ mediaTypes }: { mediaTypes: MediaType[] }) {
  const { listId } = useParams<{ listId: string }>()
  const navigate = useNavigate()
  const [list, setList] = useState<MediaListDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updates, setUpdates] = useState<Awaited<
    ReturnType<typeof api.checkForUpdates>
  > | null>(null)
  const [checking, setChecking] = useState(false)
  // Off by default: a rescan should respect what you pruned. Ticking it is
  // the undo for deleting something by accident.
  const [includeDismissed, setIncludeDismissed] = useState(false)

  const load = useCallback(async () => {
    if (!listId) return

    try {
      setList(await api.list(listId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this list')
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
                ? { ...candidate, consumedAt: candidate.consumedAt ? null : new Date().toISOString() }
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
      setError('Could not save that change')
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
      setError(`Could not remove "${item.title}"`)
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
      setError(cause instanceof Error ? cause.message : 'Could not check for updates')
    } finally {
      setChecking(false)
    }
  }

  async function addUpdates() {
    if (!listId || !updates?.newItems.length) return

    setChecking(true)

    try {
      await api.importItems(listId, updates.newItems)
      setUpdates(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add them')
    } finally {
      setChecking(false)
    }
  }

  async function remove() {
    if (!listId || !list) return
    if (!confirm(`Delete "${list.title}" and all its items?`)) return

    await api.deleteList(listId)
    void navigate('/')
  }

  if (error && !list) return <p className="notice notice--error">{error}</p>
  if (!list) return <p className="muted">Loading…</p>

  const category = mediaTypes.find((mediaType) => mediaType.key === list.mediaType)
  const { stats } = list

  return (
    <>
      <Link className="back" to="/">
        ← All lists
      </Link>

      <div className="page__header">
        <div>
          <h1 className="page__title">{list.title}</h1>
          <p className="small faint">{category?.label ?? list.mediaType}</p>
        </div>
        <div className="page__actions">
          {/* Only lists built from a source have anything to check against. */}
          {list.externalRef && (
            <>
              <label className="checkbox small faint" title="Deleting an item stops a rescan offering it back. Tick this to include everything you have deleted.">
                <input
                  type="checkbox"
                  checked={includeDismissed}
                  onChange={(event) => setIncludeDismissed(event.target.checked)}
                />
                Re-add deleted entries
              </label>
              <button
                type="button"
                className="button"
                onClick={() => void checkForUpdates()}
                disabled={checking}
              >
                {checking ? 'Checking…' : 'Check for updates'}
              </button>
            </>
          )}
          <button type="button" className="button" onClick={() => void remove()}>
            Delete list
          </button>
        </div>
      </div>

      {error && <p className="notice notice--error">{error}</p>}

      {updates && (
        <div className="notice">
          {updates.newItems.length === 0 ? (
            <p className="muted">
              Up to date — nothing new in the source's {updates.upstreamCount}.
              {!includeDismissed && updates.dismissedCount > 0 && (
                <>
                  {' '}
                  {updates.dismissedCount}{' '}
                  {updates.dismissedCount === 1 ? 'entry you deleted is' : 'entries you deleted are'}{' '}
                  being held back.
                </>
              )}
            </p>
          ) : (
            <>
              <p>
                <strong>
                  {updates.newItems.length}{' '}
                  {updates.newItems.length === 1 ? 'entry' : 'entries'}
                </strong>{' '}
                {/* With the box ticked these are things you deleted, not
                    things the source has gained. */}
                {includeDismissed ? 'to put back:' : 'new since this list was built:'}
              </p>
              <p className="small muted">
                {updates.newItems
                  .slice(0, 12)
                  .map((item) => item.title)
                  .join(' · ')}
                {updates.newItems.length > 12 ? ` … and ${updates.newItems.length - 12} more` : ''}
              </p>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void addUpdates()}
                disabled={checking}
              >
                Add {updates.newItems.length} to this list
              </button>
            </>
          )}
        </div>
      )}

      <section className="panel">
        <div className="summary">
          <Progress percent={stats.completionPercent} large label={`${stats.completionPercent}% complete`} />
          <span className="summary__figure">
            {stats.consumedItems}/{stats.totalItems}
          </span>
          <span className="muted">{stats.completionPercent}%</span>
          <span className="muted">
            {stats.timeRemainingMinutes > 0
              ? `${formatDuration(stats.timeRemainingMinutes)} left`
              : stats.totalItems > 0
                ? 'Finished'
                : 'Nothing to do yet'}
          </span>
        </div>

        {list.items.length === 0 ? (
          <p className="panel__empty">This list has no items yet.</p>
        ) : (
          <ul className="rows items">
            {list.items.map((item) => (
              <Item
                key={item.id}
                item={item}
                onToggle={(target) => void toggle(target)}
                onRemove={(target) => void removeItem(target)}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
