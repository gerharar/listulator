import './FacetToggle.css'
import { copy } from '../../../locale/index.js'

export interface FacetOption {
  key: string
  label: string
  /** What the button's hint calls it when the label is a code (`PS3` → PlayStation 3). */
  name?: string
  /** A flag's option (Live): the row chip's dot to its left, a hint at where it shows (owner). */
  mark?: boolean
}

/** `All` is on exactly when no option is — nothing selected means nothing is hidden. */
export function isAllOn(selected: ReadonlySet<string>): boolean {
  return selected.size === 0
}

/**
 * Toggles one option key in/out of the selection, leaving the rest untouched.
 * When that puts every option on, the selection becomes All (empty): every
 * option on hides nothing, so All is the honest state (U1, owner 2026-09-26).
 */
export function toggleFacetOption(
  selected: ReadonlySet<string>,
  key: string,
  allKeys: readonly string[] = [],
): Set<string> {
  const next = new Set(selected)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  if (allKeys.length > 0 && allKeys.every((option) => next.has(option))) return new Set()
  return next
}

/** design-system/components/FacetToggle — an additive filter: `All`, then a segmented run of options. */
export interface FacetToggleProps {
  /** The mono kicker: Type, Medium, Language, Platform. Left out inside a FacetDropdown, whose popover names it. */
  label?: string
  options: FacetOption[]
  selected: ReadonlySet<string>
  onChange: (selected: ReadonlySet<string>) => void
  /**
   * Every item holds one of the options (Untagged among them), so all of them
   * on is All. Not so for a flag (Live): turning its one option on must filter.
   */
  coversAll?: boolean
}

export function FacetToggle({ label, options, selected, onChange, coversAll = true }: FacetToggleProps) {
  const allOn = isAllOn(selected)

  return (
    <div className="q-facet">
      {label && <span className="q-kicker">{label}</span>}
      <button aria-pressed={allOn} title={copy.quantum.list.filter.clearTip} onClick={() => onChange(new Set())}>
        {copy.quantum.list.filter.all}
      </button>
      <span className="q-facet-seg">
        {options.map((option) => {
          const on = selected.has(option.key)
          return (
            <button
              key={option.key}
              aria-pressed={on}
              title={
                on
                  ? copy.quantum.list.filter.hideOption(option.name ?? option.label)
                  : copy.quantum.list.filter.alsoShowOption(option.name ?? option.label)
              }
              onClick={() =>
                onChange(toggleFacetOption(selected, option.key, coversAll ? options.map((entry) => entry.key) : []))
              }
            >
              {option.mark && <span className="q-facet-mark" aria-hidden="true" />}
              {option.label}
            </button>
          )
        })}
      </span>
    </div>
  )
}
