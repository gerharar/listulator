import './ListMorePopover.css'
import { copy } from '../../locale/index.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'
import type { MediaList, ResetPreview } from '../../lib/api.js'

export type MoreMode = 'menu' | 'export' | 'reorder' | 'reset' | 'delete'

export type PreviewState =
  | { state: 'loading' }
  | { state: 'ready'; data: ResetPreview }
  | { state: 'failed'; message: string }

export interface ListMorePopoverProps {
  mode: MoreMode
  anchorEl: HTMLElement | null
  source: MediaList['source']
  title: string
  itemCount: number
  doneCount: number
  /** What Reset everything would do, for its confirm sentence. */
  preview: PreviewState
  /** Menu: which body to swap in; Edit closes this popover and opens the Edit list one. */
  onMode: (mode: 'edit' | 'export' | 'reorder' | 'reset' | 'delete') => void
  onDownload: () => void
  onCopy: () => void
  onSortNow: () => void
  /** "Restore source order" (in Reorder List): the source's own order back, where Sort by release date sorts by year. */
  onResetOrder: () => void
  onResetEverything: () => void
  /** False where Reset could only fail (a file list whose file was not kept): the menu leaves both Reset entries out. */
  canReset: boolean
  onDelete: () => void
  /** Click-away, Esc, Keep or Cancel. */
  onDismiss: () => void
}

/**
 * The ⋯ popover (design prototype, "List actions"): everything rare about a
 * list behind one menu — Edit, Export, Reorder, Reset (only where there is a
 * source to return to) and Delete. One object whose body swaps between the
 * menu and each mode while the tail stays on the button; the menu is the narrow
 * one (240), the modes the list width (320). The destructive ones ask in words
 * and state the cost before the buttons; Undo follows.
 */
export function ListMorePopover({
  mode,
  anchorEl,
  source,
  title,
  itemCount,
  doneCount,
  preview,
  onMode,
  onDownload,
  onCopy,
  onSortNow,
  onResetOrder,
  onResetEverything,
  canReset,
  onDelete,
  onDismiss,
}: ListMorePopoverProps) {
  const text = copy.quantum.list.moreMenu
  const order = copy.quantum.list.orderMenu

  const head = (kicker: string) => (
    <div className="q-pop-head">
      <span className="q-kicker">{kicker}</span>
      <span className="q-kicker" style={{ letterSpacing: 0 }}>
        {text.itemCount(itemCount)}
      </span>
    </div>
  )

  return (
    <Popover open anchorEl={anchorEl} onDismiss={onDismiss} width={mode === 'menu' ? 240 : 320}>
      {mode === 'menu' && (
        <>
          <span className="q-kicker">{text.kicker}</span>
          <div className="q-pop-menu">
            <Button onClick={() => onMode('edit')}>{text.edit}</Button>
            <Button onClick={() => onMode('export')}>{text.export}</Button>
            <Button onClick={() => onMode('reorder')}>{text.reorder}</Button>
            {source !== 'manual' && canReset && <Button onClick={() => onMode('reset')}>{text.reset}</Button>}
            <Button className="warn" onClick={() => onMode('delete')}>
              {text.delete}
            </Button>
          </div>
        </>
      )}
      {mode === 'export' && (
        <>
          {head(text.exportKicker)}
          <span className="q-pop-note">{text.exportNote}</span>
          <div className="q-pop-menu">
            <Button onClick={onDownload}>{text.download}</Button>
            <Button onClick={onCopy}>{text.copy}</Button>
          </div>
        </>
      )}
      {mode === 'reorder' && (
        <>
          {head(text.reorderKicker)}
          <span className="q-pop-q">{text.reorderQuestion}</span>
          <span className="q-pop-note">{text.reorderHint}</span>
          <span className="q-pop-note">{text.reorderNote}</span>
          {/* A hand-made list has no source order to go back to, as it has nothing to Reset to. */}
          {source !== 'manual' && canReset && <span className="q-pop-note">{text.restoreHint}</span>}
          <div className="q-pop-menu">
            <Button onClick={onSortNow}>{text.sortNow}</Button>
            {source !== 'manual' && canReset && <Button onClick={onResetOrder}>{text.restoreSourceOrder}</Button>}
          </div>
          <div className="q-pop-actions">
            <Button variant="quiet" onClick={onDismiss}>
              {text.cancel}
            </Button>
          </div>
        </>
      )}
      {mode === 'reset' && (
        <>
          {head(order.kicker)}
          <span className="q-pop-q">{order.resetQuestion}</span>
          <span className="q-pop-note">{leadFor(source)}</span>
          <span className="q-pop-note">{cost(preview)}</span>
          <div className="q-pop-actions">
            <Button variant="primary" disabled={preview.state === 'loading'} onClick={onResetEverything}>
              {order.resetEverything}
            </Button>
          </div>
        </>
      )}
      {mode === 'delete' && (
        <>
          {head(text.deleteKicker)}
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

function leadFor(source: MediaList['source']): string {
  const lead = copy.quantum.list.orderMenu.resetLead

  return source === 'canonical' ? lead.canonical : source === 'file' ? lead.file : lead.api
}

function cost(preview: PreviewState): string {
  const text = copy.quantum.list.orderMenu
  if (preview.state === 'loading') return text.computing
  if (preview.state === 'failed') return text.previewFailed(preview.message)

  const { removed, restored, doneCleared } = preview.data
  const parts = [
    ...(removed > 0 ? [text.removed(removed)] : []),
    ...(restored > 0 ? [text.restored(restored)] : []),
    ...(doneCleared > 0 ? [text.cleared(doneCleared)] : []),
  ]

  return parts.length > 0 ? text.joinCost(parts) : text.noCost
}
