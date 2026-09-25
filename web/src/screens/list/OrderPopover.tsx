import { copy } from '../../locale/index.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'
import type { ResetPreview } from '../../lib/api.js'
import type { MediaList } from '../../lib/api.js'
import './ListMorePopover.css'

export type OrderMode = 'menu' | 'reset'

export type PreviewState =
  | { state: 'loading' }
  | { state: 'ready'; data: ResetPreview }
  | { state: 'failed'; message: string }

export interface OrderPopoverProps {
  mode: OrderMode
  anchorEl: HTMLElement | null
  source: MediaList['source']
  preview: PreviewState
  onSort: () => void
  onOpenReset: () => void
  /** "Reset the order": the same one-off sort as Sort chronologically. */
  onResetOrder: () => void
  onResetEverything: () => void
  onDismiss: () => void
}

/**
 * The Order popover (design: The Order menu): only one-off actions, nothing
 * that keeps running. Sort chronologically acts at once with an Undo toast.
 * Reset to the source is the heavy one, so it asks in words and states the
 * cost before the buttons — what goes, what comes back, and (the owner's ruling
 * over the design rules) how many done marks are cleared.
 */
export function OrderPopover({
  mode,
  anchorEl,
  source,
  preview,
  onSort,
  onOpenReset,
  onResetOrder,
  onResetEverything,
  onDismiss,
}: OrderPopoverProps) {
  const text = copy.quantum.list.orderMenu

  return (
    <Popover open anchorEl={anchorEl} onDismiss={onDismiss} width={mode === 'menu' ? 300 : 340}>
      {mode === 'menu' && (
        <>
          <span className="q-kicker">{text.kicker}</span>
          <div className="q-pop-menu">
            <Button onClick={onSort}>{text.sort}</Button>
            {source !== 'manual' && <Button onClick={onOpenReset}>{text.reset}</Button>}
          </div>
        </>
      )}
      {mode === 'reset' && (
        <>
          <span className="q-kicker">{text.kicker}</span>
          <span className="q-pop-q">{text.resetQuestion}</span>
          <span className="q-pop-note">{leadFor(source)}</span>
          <span className="q-pop-note">{cost(preview)}</span>
          <span className="q-pop-note">{text.undoNote}</span>
          <div className="q-pop-actions">
            <Button variant="quiet" onClick={onResetOrder}>
              {text.resetOrder}
            </Button>
            <Button variant="primary" disabled={preview.state === 'loading'} onClick={onResetEverything}>
              {text.resetEverything}
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
