import { useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import './Field.css'

/** design-system/components/Field — a text input, always under a visible kicker label. */
export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string
  size?: 'sm'
}

export function Field({ label, size, className, ...rest }: FieldProps) {
  return (
    <label className="q-field">
      <span className="q-kicker">{label}</span>
      <input className={['q-input', size === 'sm' ? 'sm' : '', className].filter(Boolean).join(' ')} {...rest} />
    </label>
  )
}

/** The textarea variant — same kicker label, `resize: vertical` unless `code`. */
export interface FieldTextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  /** The Import-tab YAML box: mono 13px/1.55, `resize: none`. */
  code?: boolean
}

export function FieldTextArea({ label, code, className, ...rest }: FieldTextAreaProps) {
  return (
    <label className="q-field">
      <span className="q-kicker">{label}</span>
      <textarea className={['q-input', code ? 'code' : '', className].filter(Boolean).join(' ')} {...rest} />
    </label>
  )
}

/**
 * Text the app read, not text you typed (README) — read-only and dimmed
 * with a *Click to edit* tag until the first click, which turns it into
 * an ordinary field at full strength. Once editing starts it stays
 * editable; there's no way back to the dimmed state from here.
 */
export interface ReadOnlyBufferProps {
  label: string
  value: string
  onChange: (value: string) => void
  rows?: number
  code?: boolean
  /** Read-only even after a click — e.g. while the text is being imported. */
  locked?: boolean
}

export function ReadOnlyBuffer({ label, value, onChange, rows = 4, code, locked }: ReadOnlyBufferProps) {
  const [editing, setEditing] = useState(false)

  return (
    <label className="q-field">
      <span className="q-kicker">{label}</span>
      <div className="q-buffer">
        <textarea
          className={['q-input', code ? 'code' : ''].filter(Boolean).join(' ')}
          rows={rows}
          readOnly={locked || !editing}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onClick={() => setEditing(true)}
        />
        {!editing && <span className="q-buffer-hint">Click to edit</span>}
      </div>
    </label>
  )
}

/** A masked API-key input with an eye / eye-off reveal toggle inside the right edge. */
export interface MaskedKeyProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className' | 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
}

export function MaskedKey({ value, onChange, ...rest }: MaskedKeyProps) {
  const [revealed, setRevealed] = useState(false)
  const label = revealed ? 'Hide the key' : 'Show the key'

  return (
    <span className="q-key">
      <input
        className="q-input key"
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
      <button type="button" aria-label={label} title={label} onClick={() => setRevealed((current) => !current)}>
        {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </span>
  )
}
