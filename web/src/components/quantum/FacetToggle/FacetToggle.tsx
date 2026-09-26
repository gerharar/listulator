import './FacetToggle.css'
import { copy } from '../../../locale/index.js'

export interface FacetOption {
  key: string
  label: string
  /** What the button's hint calls it when the label is a code (`PS3` → PlayStation 3). */
  name?: string
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
  /** The mono kicker: Type, Medium, Language, Platform. */
  label: string
  options: FacetOption[]
  selected: ReadonlySet<string>
  onChange: (selected: ReadonlySet<string>) => void
}

export function FacetToggle({ label, options, selected, onChange }: FacetToggleProps) {
  const allOn = isAllOn(selected)

  return (
    <div className="q-facet">
      <span className="q-kicker">{label}</span>
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
              onClick={() => onChange(toggleFacetOption(selected, option.key, options.map((entry) => entry.key)))}
            >
              {option.label}
            </button>
          )
        })}
      </span>
    </div>
  )
}
