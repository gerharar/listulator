import './PlatformCard.css'
import type { CSSProperties } from 'react'
import { copy } from '../../../locale/index.js'
import { Button } from '../Button/Button.js'
import { platformCodes, platformFullName } from './PlatformChip.js'

export interface PlatformCardProps {
  tags: readonly string[]
  /** The item's title, for the Edit link's name. */
  itemTitle?: string
  /** "Edit" beside the kicker (U5, owner): the item's Edit window with the Platform panel open. */
  onEdit?: () => void
}

/**
 * The platform chip's popover body (design: PlatformChip, 240px): a mono
 * kicker, then a hairline-separated row per platform — its code and its full
 * name. There is no "multi" claim (owner, U5): a bare `multi` is shown like
 * any code the table does not know.
 */
export function PlatformCard({ tags, itemTitle = '', onEdit }: PlatformCardProps) {
  const text = copy.quantum.platformCard
  const codes = platformCodes(tags)

  // The design's 5ch, grown to the longest code so XBOX360 or WINDOWS never runs into its name.
  const codeWidth = Math.max(5, ...codes.map((code) => code.length))

  return (
    <div className="q-platcard" style={{ '--code-w': `${codeWidth}ch` } as CSSProperties}>
      <div className="q-platcard-head">
        <p className="q-kicker">{codes.length === 1 ? text.one : text.many(codes.length)}</p>
        {onEdit && (
          <Button size="sm" variant="quiet" aria-label={text.editLabel(itemTitle)} onClick={onEdit}>
            {text.edit}
          </Button>
        )}
      </div>
      {codes.map((code) => (
        <div key={code} className="q-platcard-row">
          <span className="code">{code}</span>
          <span className="name">{platformFullName(code) ?? code}</span>
        </div>
      ))}
    </div>
  )
}
