import './FacetToggle.css'

export interface FacetOption {
  key: string
  label: string
}

/** `All` is on exactly when no option is — nothing selected means nothing is hidden. */
export function isAllOn(selected: ReadonlySet<string>): boolean {
  return selected.size === 0
}

/** Toggles one option key in/out of the selection, leaving the rest untouched. */
export function toggleFacetOption(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected)
  if (next.has(key)) next.delete(key)
  else next.add(key)
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
      <button aria-pressed={allOn} title="Clear the filter — show everything" onClick={() => onChange(new Set())}>
        All
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
                  ? `Hide ${option.label}`
                  : `Also show ${option.label} — any number can be on at once`
              }
              onClick={() => onChange(toggleFacetOption(selected, option.key))}
            >
              {option.label}
            </button>
          )
        })}
      </span>
    </div>
  )
}
