import { useId, useRef, useState, type ReactNode } from 'react'
import { FieldMessage } from './FieldMessage.js'

/**
 * One rule for every form (H-006; owner, 2026-10-15). A field is checked when it is left (only if it holds something) and
 * on submit, never per keystroke. Once a sentence shows it follows the value and goes when the value is valid. A submit with
 * a bad field saves nothing: every bad field, empty ones too, shows its sentence and the cursor goes to the first, with its
 * text selected. A submit button is never disabled by a value; this is what stands in for that.
 *
 * The form keeps its own values and says, per field, what is wrong with one (`problem`, a sentence or null). The order of
 * the fields given is the order the cursor goes in.
 */
export interface FieldCheck {
  value: string
  /** The sentence for a value that is wrong, null for one that is good. Called with the empty string too (on submit). */
  problem: (value: string) => string | null
}

export function useFieldValidation<K extends string>(checks: Record<K, FieldCheck>) {
  const prefix = useId()
  const [shown, setShown] = useState<ReadonlySet<K>>(new Set())
  const elements = useRef(new Map<K, HTMLInputElement | HTMLTextAreaElement>())

  const keys = Object.keys(checks) as K[]
  const idOf = (key: K): string => `${prefix}-${key}-msg`
  const current = (key: K): string | null => checks[key].problem(checks[key].value)
  const reveal = (revealed: readonly K[]): void => setShown((before) => new Set([...before, ...revealed]))
  /** The sentence to show for a field: only once it has been shown, and only while the value is still wrong. */
  const error = (key: K): string | null => (shown.has(key) ? current(key) : null)

  return {
    /** What to spread on the field: the ref the cursor needs, the check on leaving, and the accessibility attributes. */
    props: (key: K) => {
      const showing = error(key) !== null

      return {
        ref: (element: HTMLInputElement | HTMLTextAreaElement | null): void => {
          if (element) elements.current.set(key, element)
          else elements.current.delete(key)
        },
        onBlur: (): void => {
          if (checks[key].value.trim() !== '' && current(key) !== null) reveal([key])
        },
        'aria-invalid': showing ? (true as const) : undefined,
        'aria-describedby': showing ? idOf(key) : undefined,
      }
    },

    /** The field's sentence, to render where it belongs (under the field, or under a row of them); null while it is good. */
    message: (key: K): ReactNode => {
      const text = error(key)

      return text === null ? null : <FieldMessage id={idOf(key)} text={text} />
    },

    error,

    /** On submit: true when every field is good; otherwise marks every bad one and moves the cursor to the first. */
    validate: (): boolean => {
      const bad = keys.filter((key) => current(key) !== null)
      if (bad.length === 0) return true

      reveal(bad)
      const first = elements.current.get(bad[0]!)
      first?.focus()
      first?.select()

      return false
    },

    /** Hides every sentence, for a form that starts over (after an add, or when it is opened again). */
    reset: (): void => setShown(new Set()),
  }
}
