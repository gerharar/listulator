import './StatusPicker.css'

export type PickedStatus = 'complete' | 'ongoing' | null

export interface StatusPickerOption {
  value: PickedStatus
  label: string
  note: string
}

/**
 * Not known · Ongoing · Complete, in this exact order, always — the same
 * control in the Add-by-hand form and the Edit list popover.
 */
export const STATUS_PICKER_OPTIONS: readonly StatusPickerOption[] = [
  { value: null, label: 'Not known', note: 'Leave blank if you do not know.' },
  { value: 'ongoing', label: 'Ongoing', note: 'More may appear upstream.' },
  { value: 'complete', label: 'Complete', note: 'Finished — it will not gain items.' },
]

/** design-system/components/StatusPicker — three buttons, one line of consequence under them. */
export interface StatusPickerProps {
  value: PickedStatus
  onChange: (value: PickedStatus) => void
}

export function StatusPicker({ value, onChange }: StatusPickerProps) {
  const chosen = STATUS_PICKER_OPTIONS.find((option) => option.value === value) ?? STATUS_PICKER_OPTIONS[0]!

  return (
    <div className="q-status-picker-field">
      <div className="q-status-picker">
        {STATUS_PICKER_OPTIONS.map((option) => (
          <button
            key={option.label}
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
