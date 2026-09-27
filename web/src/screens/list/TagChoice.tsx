import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { compareShown, copy } from '../../locale/index.js'
import { aboveField, opensUp } from './dropDirection.js'
import type { Choice, TagField } from './tagFields.js'

export interface TagChoiceProps {
  field: Extract<TagField, { kind: 'choice' }>
  /** The item's pick now. */
  current: Choice
  onChange: (next: Choice) => void
}

/**
 * The tag field for a category with a short fixed set (U5, owner: "just a
 * dropdown list to select a predefined tag"): Music and Animation pick a Type,
 * Mega a Medium. None first, then the values — A–Z by shown name unless the
 * category keeps its own order (Music: Album, Mini, Compilation) — then any
 * flag to tick on top (Music: Live, owner 2026-09-27). A value picks and
 * closes; a flag toggles and leaves the list open. A press past the field or
 * Esc closes only the list — by listening on the document, because WebKit (the
 * desktop app) never focuses a clicked button, so it never blurs either.
 */
export function TagChoice({ field, current, onChange }: TagChoiceProps) {
  const text = copy.quantum.list.tags
  const shownName = (label: string) => copy.quantum.list.filter.optionLabels[label] ?? label
  const listId = useId()
  const [open, setOpen] = useState(false)
  // Below, or — at the foot of a long list — just above the field.
  const [above, setAbove] = useState<CSSProperties | null>(null)
  const fieldRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // A press past the field only closes the list, as a Popover's catcher does (owner): the press, and
    // the click it becomes, never reach what is under it. No catcher element: inside the Edit window
    // it would share the window's layer and cover the list itself.
    const swallowClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      document.removeEventListener('click', swallowClick, true)
    }
    const onPress = (event: PointerEvent) => {
      if (event.target instanceof Node && fieldRef.current?.contains(event.target)) return
      event.preventDefault() // no focus move, no mouse events after it
      event.stopPropagation()
      document.addEventListener('click', swallowClick, true)
      // The click comes straight after the release; one that never comes (a drag) must not
      // leave the next click — a key's, say — to be eaten.
      const onRelease = () => {
        document.removeEventListener('pointerup', onRelease, true)
        setTimeout(() => document.removeEventListener('click', swallowClick, true))
      }
      document.addEventListener('pointerup', onRelease, true)
      setOpen(false)
    }
    // Capture, before the Edit window's own Esc (cancel the edit): this one only closes the list.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPress, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const nameOf = (tag: string) => shownName([...field.values, ...field.flags].find((value) => value.tag === tag)?.label ?? tag)
  const picked = [...(current.main ? [current.main] : []), ...current.flags]
  const shown = picked.length > 0 ? picked.map(nameOf).join(' · ') : text.none

  const values = field.values.map((value) => ({ tag: value.tag, name: shownName(value.label) }))
  if (!field.keepOrder) values.sort((a, b) => compareShown(a.name, b.name))

  function pickMain(tag: string | null) {
    onChange({ main: tag, flags: current.flags })
    setOpen(false)
  }

  function toggleFlag(tag: string) {
    const on = new Set(current.flags)
    if (on.has(tag)) on.delete(tag)
    else on.add(tag)
    // In the facet's order, whatever the click order.
    onChange({ main: current.main, flags: field.flags.map((flag) => flag.tag).filter((flag) => on.has(flag)) })
  }

  const options: { key: string; name: string; selected: boolean; flag: boolean; pick: () => void }[] = [
    { key: '', name: text.none, selected: current.main === null, flag: false, pick: () => pickMain(null) },
    ...values.map((value) => ({
      key: value.tag,
      name: value.name,
      selected: current.main === value.tag,
      flag: false,
      pick: () => pickMain(value.tag),
    })),
    ...field.flags.map((flag) => ({
      key: `flag:${flag.tag}`,
      name: shownName(flag.label),
      selected: current.flags.includes(flag.tag),
      flag: true,
      pick: () => toggleFlag(flag.tag),
    })),
  ]
  const firstFlag = options.findIndex((option) => option.flag)

  return (
    <div className="q-field q-combo" ref={fieldRef}>
      <span className="q-kicker" aria-hidden="true">
        {field.label}
      </span>
      <button
        type="button"
        className="q-input sm q-tagchoice"
        aria-label={text.fieldLabel(field.label, shown)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={(event) => {
          const button = event.currentTarget
          setAbove(opensUp(button.getBoundingClientRect(), window.innerHeight) ? aboveField(button) : null)
          setOpen((was) => !was)
        }}
        onBlur={() => setOpen(false)}
      >
        <span className={picked.length > 0 ? 'q-tagchoice-value' : 'q-tagchoice-value empty'}>{shown}</span>
        <ChevronDown width={14} height={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <ul
          className={above ? 'q-combo-list up' : 'q-combo-list'}
          style={above ?? undefined}
          role="listbox"
          id={listId}
          aria-label={field.label}
        >
          {options.map((option, index) => (
            <li
              key={option.key}
              role="option"
              aria-selected={option.selected}
              className={[
                option.selected ? 'active' : '',
                option.flag ? 'q-tagchoice-flag' : '',
                index === firstFlag ? 'q-tagchoice-flag-first' : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined}
              // Before the button's blur, or the list would close under the click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={option.pick}
            >
              {option.flag && (
                <span className="q-tagchoice-box" aria-hidden="true">
                  {option.selected && <Check width={11} height={11} strokeWidth={3} />}
                </span>
              )}
              {option.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
