import './JumpRail.css'
import { copy } from '../../locale/index.js'

export interface RailEntry {
  id: string
  name: string
  done: number
  total: number
}

export interface JumpRailProps {
  entries: readonly RailEntry[]
  onJump: (entry: RailEntry) => void
  onHide: () => void
}

/**
 * The jump rail (design: JumpRail, 200px): every group that has items, with
 * what is done in it and a tick once all of it is. A click opens the group
 * and brings it to the top. It never follows a filter: it is the map of the
 * whole list.
 */
export function JumpRail({ entries, onJump, onHide }: JumpRailProps) {
  const text = copy.quantum.list.rail

  return (
    <nav className="q-rail" aria-label={text.title}>
      <div className="q-rail-head">
        <span className="q-kicker">{text.title}</span>
        <button type="button" className="q-rail-toggle" aria-label={text.hide} title={text.hide} onClick={onHide}>
          «
        </button>
      </div>
      {entries.map((entry) => {
        const complete = entry.total > 0 && entry.done === entry.total

        return (
          <button
            key={entry.id}
            type="button"
            className={complete ? 'q-rail-entry complete' : 'q-rail-entry'}
            onClick={() => onJump(entry)}
          >
            <span className="tick" aria-hidden="true">
              {complete ? '✓' : ''}
            </span>
            <span className="name">{entry.name}</span>
            <span className="count">
              {entry.done}/{entry.total}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

/** What is left of the rail when it is folded away: a 36px strip with a way back. */
export function JumpRailStub({ onShow }: { onShow: () => void }) {
  const text = copy.quantum.list.rail

  return (
    <div className="q-rail-stub">
      <button type="button" className="q-rail-toggle" aria-label={text.show} title={text.show} onClick={onShow}>
        »
      </button>
      <span className="label">{text.title}</span>
    </div>
  )
}
