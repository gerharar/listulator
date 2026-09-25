import './PlatformCard.css'
import { copy } from '../../../locale/index.js'
import { platformFullName } from './PlatformChip.js'

export interface PlatformCardProps {
  tags: readonly string[]
}

/**
 * The platform chip's popover body (design: PlatformChip, 240px): a mono
 * kicker, then a hairline-separated row per platform — its code and its full
 * name. A bare `multi` says only that the game shipped everywhere and the
 * list does not name where.
 */
export function PlatformCard({ tags }: PlatformCardProps) {
  const text = copy.quantum.platformCard
  const codes = tags.map((tag) => tag.trim()).filter(Boolean)

  if (codes.length === 1 && codes[0]!.toLowerCase() === 'multi') {
    return (
      <div className="q-platcard">
        <p className="q-kicker">{text.multi}</p>
        <p className="q-platcard-note">{text.multiNote}</p>
      </div>
    )
  }

  return (
    <div className="q-platcard">
      <p className="q-kicker">{codes.length === 1 ? text.one : text.many(codes.length)}</p>
      {codes.map((code) => (
        <div key={code} className="q-platcard-row">
          <span className="code">{code.toUpperCase()}</span>
          <span className="name">{platformFullName(code) ?? code.toUpperCase()}</span>
        </div>
      ))}
    </div>
  )
}
