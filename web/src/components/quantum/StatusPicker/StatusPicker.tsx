import './StatusPicker.css'
import { copy } from '../../../locale/index.js'

export type PickedStatus = 'complete' | 'ongoing' | null

export interface StatusPickerOption {
  value: PickedStatus
  label: string
  note: string
}

/**
 * Not known · Ongoing · Complete, in this exact order, always — the same
 * control in the Add-by-hand form and the Edit list popover. A function, not a
 * constant: the words follow the language, so they are read when used.
 */
export function statusPickerOptions(): readonly StatusPickerOption[] {
  const text = copy.quantum.statusPicker
  return [
    { value: null, label: text.notKnown, note: text.notKnownNote },
    { value: 'ongoing', label: copy.quantum.status.ongoing, note: text.ongoingNote },
    { value: 'complete', label: copy.quantum.status.complete, note: text.completeNote },
  ]
}

/** design-system/components/StatusPicker — three buttons, one line of consequence under them. */
export interface StatusPickerProps {
  value: PickedStatus
  onChange: (value: PickedStatus) => void
}

export function StatusPicker({ value, onChange }: StatusPickerProps) {
  const options = statusPickerOptions()
  const chosen = options.find((option) => option.value === value) ?? options[0]!

  return (
    <div className="q-status-picker-field">
      <div className="q-status-picker">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="q-status-picker-note t-small">{chosen.note}</p>
    </div>
  )
}
