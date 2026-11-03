import type { KeyboardEvent, MouseEvent } from 'react'
import './DoneCheckbox.css'
import { copy } from '../../../locale/index.js'
import { Tip } from '../Tooltip/Tip.js'

/**
 * design-system/components/DoneCheckbox — the 19×19 box that marks an
 * item done, with a 36×46 hit area (the full row band). Marks done-ness
 * only, never a list's own status.
 *
 * Toggling the whole row is the caller's concern (ItemRow, not yet
 * built) — this component only renders the box itself.
 *
 * `'mixed'` is the group head's "some are done" (H-026): a dash drawn by the stylesheet, never a
 * character (a glyph sits at a different height in every font). A click on it asks for done.
 */
export interface DoneCheckboxProps {
  checked: boolean | 'mixed'
  onChange: (checked: boolean) => void
  label?: string
  /** Extra class, e.g. `q-group-done` for the box on a group head. */
  className?: string
  /**
   * The row around the box acts on a click and on Enter / Space (a group head folds). An isolated box keeps those from it, as the
   * pencil and the trash on a head do; arrows still reach the list, which walks its rows.
   */
  isolate?: boolean
  /** The app's tooltip on the box (the group head's, which says what a click does). Item boxes have none: a row has thousands. */
  tip?: string
}

export function DoneCheckbox({ checked, onChange, label = copy.quantum.common.toggleDone, className, isolate = false, tip }: DoneCheckboxProps) {
  const props = {
    type: 'button' as const,
    className: className ? `q-done ${className}` : 'q-done',
    role: 'checkbox',
    'aria-checked': checked,
    'aria-label': label,
    onClick: (event: MouseEvent) => {
      if (isolate) event.stopPropagation()
      onChange(checked !== true)
    },
    onKeyDown: isolate
      ? (event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
        }
      : undefined,
  }
  const box = <span>{checked === true ? '✓' : ''}</span>

  return tip === undefined ? (
    <button {...props}>{box}</button>
  ) : (
    <Tip as="button" text={tip} {...props}>
      {box}
    </Tip>
  )
}
