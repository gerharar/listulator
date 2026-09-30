import { Tip } from '../Tooltip/Tip.js'
import './PreviewRow.css'
import { formatDuration } from '../../../formatDuration.js'
import type { PreviewItem } from '../../../lib/api.js'
import { tagChip, type FacetConvention } from '../../../../../server/src/catalog/facets.js'
import { KindTag } from '../Marks/Marks.js'
import { PlatformChip } from '../PlatformChip/PlatformChip.js'

export interface PreviewRowProps {
  item: PreviewItem
  /** Inside a group: indented under its head. */
  grouped: boolean
  /** The category's default, shown for an item with no runtime of its own. */
  defaultMinutes: number
  /** The category's tag conventions: the chip says what the created list's row will say (Mini, Comp, Live). */
  facets?: FacetConvention
  /** A category whose tags name platforms: the widest chip label (`ch`), so the column lines up. */
  platformWidthCh?: number
}

/**
 * A read-only 40px row in the Preview layer (design-system/components/
 * PreviewRow): optional kind tag, title, year, minutes. No handle, no done
 * box, no buttons — nothing here is actionable. The tag column is the list row's,
 * read-only (11.8), so the preview and the list it makes agree.
 */
export function PreviewRow({ item, grouped, defaultMinutes, facets, platformWidthCh }: PreviewRowProps) {
  const chip = tagChip(item.tags, facets)
  const kind = chip?.label ?? item.tags?.[0]
  const minutes = item.timeToConsumeMinutes ?? defaultMinutes

  return (
    <div className={['q-preview-row', grouped && 'in-group'].filter(Boolean).join(' ')}>
      {platformWidthCh !== undefined ? (
        <PlatformChip tags={item.tags ?? []} widthCh={platformWidthCh} itemTitle={item.title} />
      ) : (
        kind && <KindTag label={kind} kind flags={chip?.flags} />
      )}
      <span className="tt">
        <Tip className="title" text={item.title} whenClipped>
          {item.title}
        </Tip>
        {item.year ? <span className="q-year">({item.year})</span> : null}
      </span>
      <span className="mins">{formatDuration(minutes)}</span>
    </div>
  )
}
