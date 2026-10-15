import { CircleAlert } from 'lucide-react'
import './Field.css'

/**
 * The one sentence under a field that is wrong (H-004, H-006; design system card Field, state Invalid): the `circle-alert`
 * icon and the sentence in the ink colour, never red. It is an alert, so a screen reader says it when it appears; the field
 * points at it with `aria-describedby`. Rendered only while the field is wrong, and by `useFieldValidation` for the forms.
 */
export interface FieldMessageProps {
  /** What the field's `aria-describedby` names. */
  id: string
  text: string
}

export function FieldMessage({ id, text }: FieldMessageProps) {
  return (
    <span id={id} role="alert" className="q-field-msg">
      <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
      <span>{text}</span>
    </span>
  )
}
