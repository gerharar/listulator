import { useId, useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { copy } from '../../locale/index.js'
import type { FacetValue } from '../../../../server/src/catalog/facets.js'

export interface TagChoiceProps {
  /** The facet's name: Type, Medium. */
  label: string
  values: readonly FacetValue[]
  /** The values the item carries now, in the facet's order: usually one, none, or (Music) two. */
  current: readonly string[]
  onChange: (tag: string | null) => void
}

/**
 * The Edit window's tag field for a category with a short fixed set (U5,
 * owner: "just a dropdown list to select a predefined tag"): Music and
 * Animation pick a Type, Mega a Medium. None first, then the facet's values,
 * in an in-app list like the Group field's; Esc closes only the list.
 */
export function TagChoice({ label, values, current, onChange }: TagChoiceProps) {
  const text = copy.quantum.list.tags
  const listId = useId()
  const [open, setOpen] = useState(false)

  const labelOf = (tag: string) => values.find((value) => value.tag === tag)?.label ?? tag
  const shown = current.length > 0 ? current.map(labelOf).join(', ') : text.none

  function choose(tag: string | null) {
    onChange(tag)
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && open) {
      // Before the Edit window's own Esc (cancel the edit): this one only closes the list.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
  }

  const options: { tag: string | null; label: string }[] = [
    { tag: null, label: text.none },
    ...values.map((value) => ({ tag: value.tag, label: value.label })),
  ]

  return (
    <div className="q-field q-combo">
      <span className="q-kicker" aria-hidden="true">
        {label}
      </span>
      <button
        type="button"
        className="q-input sm q-tagchoice"
        aria-label={text.fieldLabel(label, shown)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      >
        <span className={current.length > 0 ? 'q-tagchoice-value' : 'q-tagchoice-value empty'}>{shown}</span>
        <ChevronDown width={14} height={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <ul className="q-combo-list" role="listbox" id={listId} aria-label={label}>
          {options.map((option) => {
            const selected = option.tag === null ? current.length === 0 : current.includes(option.tag)
            return (
              <li
                key={option.tag ?? ''}
                role="option"
                aria-selected={selected}
                className={selected ? 'active' : undefined}
                // Before the button's blur, or the list would close under the click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.tag)}
              >
                {option.label}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
