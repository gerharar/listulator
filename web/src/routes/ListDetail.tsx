import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Progress } from '../components/Progress.js'
import { api, type ListItem, type MediaListDetail, type MediaType } from '../lib/api.js'
import { formatDuration } from '../formatDuration.js'

function Item({
  item,
  onToggle,
}: {
  item: ListItem
  onToggle: (item: ListItem) => void
}) {
  const consumed = item.consumedAt !== null

  return (
    <li>
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
    </li>
  )
}

export function ListDetail({ mediaTypes }: { mediaTypes: MediaType[] }) {
  const { listId } = useParams<{ listId: string }>()
  const navigate = useNavigate()
  const [list, setList] = useState<MediaListDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        <button type="button" className="button" onClick={() => void remove()}>
          Delete list
        </button>
      </div>

      {error && <p className="notice notice--error">{error}</p>}

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
              <Item key={item.id} item={item} onToggle={(target) => void toggle(target)} />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
