import './HelpButton.css'
import { useState } from 'react'
import { CircleHelp } from 'lucide-react'
import { copy } from '../../../locale/index.js'
import { Popover } from '../Popover/Popover.js'
import { Tip } from '../Tooltip/Tip.js'

export interface HelpButtonProps {
  /** The setting's own label: the popover's heading, and what the (?) is named after ("About <label>"). */
  label: string
  /** The explanation, in the popover under the label. */
  text: string
}

/**
 * The (?) after a setting that has an explanation (H-031, `DESIGN.md` section 5 rule 6): (i) is about content, (?) is about the app. A 20px button with a
 * 14px `circle-help`; a click opens the small popover the API-key marks open (300px) with the label and then the explanation; Esc, a click outside or the (?)
 * again close it, and focus goes back to the (?). It never opens on hover, which shows only its name. The checkbox it follows keeps the explanation as its
 * `aria-description`.
 */
export function HelpButton({ label, text }: HelpButtonProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const name = copy.quantum.settings.aboutLabel(label)

  function close(): void {
    anchor?.focus()
    setAnchor(null)
  }

  return (
    <>
      <Tip
        as="button"
        type="button"
        className="q-help"
        text={name}
        aria-label={name}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={(event) => (anchor ? close() : setAnchor(event.currentTarget))}
      >
        <CircleHelp size={14} strokeWidth={1.8} aria-hidden="true" />
      </Tip>
      {anchor && (
        <Popover open anchorEl={anchor} onDismiss={close} width={300} label={label}>
          <div className="q-help-pop">
            <strong>{label}</strong>
            <span>{text}</span>
          </div>
        </Popover>
      )}
    </>
  )
}
