import './ListMorePopover.css'
import { copy } from '../../locale/index.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'

export type MoreMode = 'menu' | 'export' | 'delete'

export interface ListMorePopoverProps {
  mode: MoreMode
  anchorEl: HTMLElement | null
  title: string
  itemCount: number
  doneCount: number
  /** Menu: which body to swap in. */
  onMode: (mode: 'export' | 'delete') => void
  onDownload: () => void
  onCopy: () => void
  onDelete: () => void
  /** Click-away, Esc, or Keep. */
  onDismiss: () => void
}

/**
 * The ⋯ popover (design: List actions): one object whose body swaps between
 * the menu, Export and Delete while the tail stays on the button that opened
 * it. The menu is the narrow one (240), the modes the list width (320).
 * Delete asks in words and states the cost before the buttons; Undo follows.
 */
export function ListMorePopover({
  mode,
  anchorEl,
  title,
  itemCount,
  doneCount,
  onMode,
  onDownload,
  onCopy,
  onDelete,
  onDismiss,
}: ListMorePopoverProps) {
  const text = copy.quantum.list.moreMenu

  return (
    <Popover open anchorEl={anchorEl} onDismiss={onDismiss} width={mode === 'menu' ? 240 : 320}>
      {mode === 'menu' && (
        <>
          <span className="q-kicker">{text.kicker}</span>
          <div className="q-pop-menu">
            <Button onClick={() => onMode('export')}>{text.export}</Button>
            <Button className="warn" onClick={() => onMode('delete')}>
              {text.delete}
            </Button>
          </div>
        </>
      )}
      {mode === 'export' && (
        <>
          <div className="q-pop-head">
            <span className="q-kicker">{text.exportKicker}</span>
            <span className="q-kicker" style={{ letterSpacing: 0 }}>
              {text.itemCount(itemCount)}
            </span>
          </div>
          <span className="q-pop-note">{text.exportNote}</span>
          <div className="q-pop-menu">
            <Button onClick={onDownload}>{text.download}</Button>
            <Button onClick={onCopy}>{text.copy}</Button>
          </div>
        </>
      )}
      {mode === 'delete' && (
        <>
          <div className="q-pop-head">
            <span className="q-kicker">{text.deleteKicker}</span>
            <span className="q-kicker" style={{ letterSpacing: 0 }}>
              {text.itemCount(itemCount)}
            </span>
          </div>
          <span className="q-pop-q">{text.deleteQuestion(title)}</span>
          <span className="q-pop-note">{text.deleteNote(itemCount, doneCount)}</span>
          <div className="q-pop-actions">
            <Button variant="quiet" onClick={onDismiss}>
              {text.keep}
            </Button>
            <Button variant="danger" onClick={onDelete}>
              {text.confirmDelete}
            </Button>
          </div>
        </>
      )}
    </Popover>
  )
}
