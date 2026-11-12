import { Tip } from '../Tooltip/Tip.js'
import { useCallback, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import './Field.css'
import { copy } from '../../../locale/index.js'
import { useTheme } from '../DocumentTheme/ThemeContext.js'

/** design-system/components/Field — a text input, always under a visible kicker label. */
export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string
  size?: 'sm'
  ref?: Ref<HTMLInputElement>
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
  ref?: Ref<HTMLTextAreaElement>
  /**
   * Something at the right end of the label row, such as a character counter (H-003). The label row is a row of its own,
   * so what goes in it never changes the field's height, and the label stays only the label (it is the field's name).
   */
  meta?: ReactNode
}

export function FieldTextArea({ label, code, className, meta, id, ref, ...rest }: FieldTextAreaProps) {
  const own = useId()
  const inputId = id ?? own
  const theme = useTheme()
  const field = useRef<HTMLTextAreaElement | null>(null)
  const bind = useCallback(
    (node: HTMLTextAreaElement | null) => {
      field.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )
  // eX-Zed (D12, design 2026-11-12): a short multi-line field (the item note's 2 lines, the list description's 3) is as tall as its content, lines x 24 + 16 inside its border, and grows
  // with what is typed (a stylesheet's max-height stops it). The tall boxes (Items, the YAML) keep their rows. Quantum's boxes are the browser's own, as they were.
  const grows = theme === 'exzed' && !code && (rest.rows ?? 2) <= 3
  useLayoutEffect(() => {
    const node = field.current
    if (!node || !grows) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight + (node.offsetHeight - node.clientHeight)}px`
  }, [grows, rest.value])
  if (meta !== undefined) {
    return (
      <div className="q-field">
        <div className="q-field-head">
          <label htmlFor={inputId} className="q-kicker">
            {label}
          </label>
          {meta}
        </div>
        <textarea id={inputId} ref={bind} className={['q-input', code ? 'code' : '', className].filter(Boolean).join(' ')} {...rest} />
      </div>
    )
  }

  return (
    <label className="q-field">
      <span className="q-kicker">{label}</span>
      <textarea id={id} ref={bind} className={['q-input', code ? 'code' : '', className].filter(Boolean).join(' ')} {...rest} />
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
          spellCheck={false}
          readOnly={locked || !editing}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onClick={() => setEditing(true)}
        />
        {!editing && <span className="q-buffer-hint">{copy.quantum.common.clickToEdit}</span>}
      </div>
    </label>
  )
}

/** A masked API-key input with an eye / eye-off reveal toggle inside the right edge. */
export interface MaskedKeyProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className' | 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  ref?: Ref<HTMLInputElement>
}

export function MaskedKey({ value, onChange, ...rest }: MaskedKeyProps) {
  const [revealed, setRevealed] = useState(false)
  const label = revealed ? copy.quantum.common.hideKey : copy.quantum.common.showKey

  return (
    <span className="q-key">
      <input
        className="q-input key"
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
      <Tip as="button" type="button" aria-label={label} text={label} onClick={() => setRevealed((current) => !current)}>
        {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
      </Tip>
    </span>
  )
}
