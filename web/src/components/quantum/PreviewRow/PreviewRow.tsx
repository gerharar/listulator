import './PreviewRow.css'
import { formatDuration } from '../../../formatDuration.js'
import type { PreviewItem } from '../../../lib/api.js'
import { KindTag } from '../Marks/Marks.js'

export interface PreviewRowProps {
  item: PreviewItem
  /** Inside a group: indented under its head. */
  grouped: boolean
  /** The category's default, shown for an item with no runtime of its own. */
  defaultMinutes: number
}

/**
 * A read-only 40px row in the Preview layer (design-system/components/
 * PreviewRow): optional kind tag, title, year, minutes. No handle, no done
 * box, no buttons — nothing here is actionable.
 */
export function PreviewRow({ item, grouped, defaultMinutes }: PreviewRowProps) {
  const kind = item.tags?.[0]
  const minutes = item.timeToConsumeMinutes ?? defaultMinutes

  return (
    <div className={['q-preview-row', grouped && 'in-group'].filter(Boolean).join(' ')}>
      {kind && <KindTag label={kind} kind />}
      <span className="tt">
        <span className="title" title={item.title}>
          {item.title}
        </span>
        {item.year ? <span className="q-year">({item.year})</span> : null}
      </span>
      <span className="mins">{formatDuration(minutes)}</span>
    </div>
  )
}
