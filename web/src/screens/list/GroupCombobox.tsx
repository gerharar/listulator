import './GroupCombobox.css'
import { useCallback, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { copy } from '../../locale/index.js'
import { useDismissOnPress } from './dismissOnPress.js'
import { aboveField, opensUp } from './dropDirection.js'

export interface GroupComboboxProps {
  label: string
  /** The list's groups, in order. */
  groups: readonly string[]
  /** The group name typed or picked; empty means no group. */
  value: string
  onChange: (value: string) => void
  small?: boolean
}

interface Option {
  key: string
  text: string
  /** What picking it sets the field to. */
  value: string
}

/**
 * The group field of the add-item form and the edit popover: pick one of the
 * list's groups, or type a name that does not exist yet and it is created with
 * the item. A small in-app list rather than the browser's `<datalist>`, whose
 * look and behaviour differ per engine (and are poor in WKWebView).
 */
export function GroupCombobox({
  label,
  groups,
  value,
  onChange,
  small = false,
}: GroupComboboxProps) {
  const text = copy.quantum.list
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // In the field, the hint says a typed name makes a group (owner); "No group" leads the list instead.
  const [focused, setFocused] = useState(false)
  // Where the list opens: below, or — at the foot of a long list — just above the field.
  const [above, setAbove] = useState<CSSProperties | null>(null)
  // A press past the open list only closes it, like every other picker (owner): typing a new
  // name and pressing Save closes the list first, and the next press saves.
  const fieldRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismissOnPress(open, fieldRef, close)

  function openFrom(field: HTMLElement) {
    setAbove(opensUp(field.getBoundingClientRect(), window.innerHeight) ? aboveField(field) : null)
    setOpen(true)
  }

  const typed = value.trim()
  const needle = typed.toLowerCase()
  const exists = groups.some((group) => group.toLowerCase() === needle)

  // A value that is exactly a group is a pick, not a search: show them all, so
  // another can be chosen. Anything else typed narrows the list.
  const searching = typed !== '' && !exists

  const options: Option[] = [
    // "No group" leads unless a name is being typed.
    ...(!searching ? [{ key: 'none', text: text.noGroup, value: '' }] : []),
    ...groups
      .filter((group) => !searching || group.toLowerCase().includes(needle))
      .map((group) => ({ key: `g:${group}`, text: group, value: group })),
    ...(typed !== '' && !exists
      ? [{ key: 'new', text: text.createGroup(typed), value: typed }]
      : []),
  ]

  function pick(option: Option) {
    onChange(option.value)
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && open) {
      // Closing the list is the Esc; an enclosing popover stays open.
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current) => Math.min(options.length - 1, Math.max(0, current + step)))
      return
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault()
      const chosen = options[active]
      if (chosen) pick(chosen)
      else setOpen(false)
    }
  }

  return (
    <div className="q-field q-combo" ref={fieldRef}>
      <label className="q-combo-label">
        <span className="q-kicker">{label}</span>
        <input
          className={['q-input', small ? 'sm' : ''].filter(Boolean).join(' ')}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={value}
          placeholder={focused ? text.typeToCreate : text.noGroup}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            onChange(event.target.value)
            if (!open) openFrom(event.currentTarget)
            setActive(-1)
          }}
          onFocus={(event) => {
            setFocused(true)
            openFrom(event.currentTarget)
          }}
          onBlur={() => {
            setFocused(false)
            setOpen(false)
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {open && (
        <ul className={above ? 'q-combo-list up' : 'q-combo-list'} style={above ?? undefined} role="listbox" id={listId}>
          {options.map((option, index) => (
            <li
              key={option.key}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'active' : undefined}
              // Before the input's blur, or the list would close under the click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
            >
              {option.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
