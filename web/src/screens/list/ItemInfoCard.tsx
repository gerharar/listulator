import './ItemInfoCard.css'
import { Pencil } from 'lucide-react'
import type { ListItem } from '../../lib/api.js'
import { copy } from '../../locale/index.js'
import { IconButton } from '../../components/quantum/Button/Button.js'
import { itemNotes } from './itemNotes.js'

export interface ItemInfoCardProps {
  item: ListItem
  /** The ✎ on "Your note": the Edit window with the cursor in Note. */
  onEditNote: () => void
}

/**
 * The ⓘ popover's body (design: item notes, 320px). The ⓘ is only on an item with a note, so there is always one to show:
 * the curator's (read-only, from the source), the user's own (with a ✎ to edit it), or both, curator first, split by a
 * hairline. A kicker says whose it is; with one note it sits above the title, with both the title goes first. Line breaks
 * are kept, and a note is only ever drawn as text.
 */
export function ItemInfoCard({ item, onEditNote }: ItemInfoCardProps) {
  const text = copy.quantum.list.itemActions
  const { curator, mine } = itemNotes(item)
  const title = <div className="q-info-title">{item.title}</div>
  const yours = (
    <div className="q-info-head">
      <span className="q-kicker">{text.yourNote}</span>
      <IconButton label={text.editYourNote} title={text.editYourNoteTip} onClick={onEditNote}>
        <Pencil width={15} height={15} strokeWidth={1.8} aria-hidden="true" />
      </IconButton>
    </div>
  )

  return (
    <div className="q-info">
      {curator && mine ? (
        <>
          {title}
          <p className="q-kicker">{text.curatorNote}</p>
          <p className="q-info-text">{curator}</p>
          <hr />
          {yours}
          <p className="q-info-text">{mine}</p>
        </>
      ) : curator ? (
        <>
          <p className="q-kicker">{text.curatorNote}</p>
          {title}
          <p className="q-info-text">{curator}</p>
        </>
      ) : (
        <>
          {yours}
          {title}
          <p className="q-info-text">{mine}</p>
        </>
      )}
    </div>
  )
}
