import './ItemInfoCard.css'
import { formatDuration } from '../../formatDuration.js'
import type { ListItem } from '../../lib/api.js'
import { copy } from '../../locale/index.js'

export interface ItemInfoCardProps {
  item: ListItem
}

/**
 * The ⓘ popover's body (design: item info, 320px): a dashed placeholder where
 * a cover will go (Q6, deferred) and the item's `notes` — curator prose,
 * read-only, shown only when there are some so there is never an empty slot.
 */
export function ItemInfoCard({ item }: ItemInfoCardProps) {
  const text = copy.quantum.list.itemActions
  const notes = item.notes?.trim()

  return (
    <div className="q-info">
      <p className="q-kicker">{text.infoKicker}</p>
      <div className="q-info-title">{item.title}</div>
      <div className="q-info-cover" aria-hidden="true" />
      <div className="q-info-facts">
        {item.year ? <span>{item.year}</span> : null}
        <span>{formatDuration(item.timeToConsumeMinutes)}</span>
      </div>
      {notes && <p className="q-info-notes">{notes}</p>}
      {item.timeToConsumeIsEstimated && <p className="q-info-note">{text.estimated}</p>}
    </div>
  )
}
