import './DoneCheckbox.css'

/**
 * design-system/components/DoneCheckbox — the 19×19 box that marks an
 * item done, with a 36×46 hit area (the full row band). Marks done-ness
 * only, never a list's own status.
 *
 * Toggling the whole row is the caller's concern (ItemRow, not yet
 * built) — this component only renders the box itself.
 */
export interface DoneCheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
}

export function DoneCheckbox({ checked, onChange, label = 'Toggle done' }: DoneCheckboxProps) {
  return (
    <button
      type="button"
      className="q-done"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span>{checked ? '✓' : ''}</span>
    </button>
  )
}
