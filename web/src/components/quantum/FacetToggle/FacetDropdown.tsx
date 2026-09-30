import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { copy } from '../../../locale/index.js'
import { Popover } from '../Popover/Popover.js'
import { FacetToggle, type FacetOption } from './FacetToggle.js'
import { Tip } from '../Tooltip/Tip.js'

/** How many picks the closed dropdown names before it counts the rest. */
const NAMED_PICKS = 3

/** The closed dropdown's words: All, or the picks in the options' order, three named and the rest counted. */
export function facetSummary(options: readonly FacetOption[], selected: ReadonlySet<string>): string {
  const t = copy.quantum.list.filter
  const picked = options.filter((option) => selected.has(option.key)).map((option) => option.label)
  if (picked.length === 0) return t.all
  return t.facetPicks(picked.slice(0, NAMED_PICKS), picked.length - NAMED_PICKS)
}

export interface FacetWidths {
  key: string
  /** The facet as inline chips. */
  inline: number
  /** The facet as a dropdown. */
  compact: number
}

/**
 * Which facets must become dropdowns for the filter bar to stay one row (U4):
 * none while the row fits; otherwise the facet that saves the most goes first,
 * until it fits or every facet is a dropdown. `fixed` are the bar's other parts
 * (text field, fold-all, note); `gap` is the bar's gap between parts.
 */
export function facetsToCompact(
  available: number,
  fixed: readonly number[],
  gap: number,
  facets: readonly FacetWidths[],
): Set<string> {
  const compact = new Set<string>()
  const parts = fixed.length + facets.length
  let width =
    fixed.reduce((sum, part) => sum + part, 0) +
    facets.reduce((sum, facet) => sum + facet.inline, 0) +
    gap * Math.max(parts - 1, 0)

  const bySaving = [...facets].sort((a, b) => b.inline - b.compact - (a.inline - a.compact))
  for (const facet of bySaving) {
    if (width <= available) break
    compact.add(facet.key)
    width -= facet.inline - facet.compact
  }
  return compact
}

export interface FacetDropdownProps {
  label: string
  options: FacetOption[]
  selected: ReadonlySet<string>
  onChange: (selected: ReadonlySet<string>) => void
  /** Rendered only to be measured (FilterBar's hidden copy): no popover. */
  measureOnly?: boolean
  /** As FacetToggle's: false for a flag, whose one option on must still filter. */
  coversAll?: boolean
}

/**
 * A facet too wide for the filter bar's row (U4, owner 2026-09-27): its kicker,
 * then one button naming the selection (filled once anything is picked, every
 * pick named in full in its hint) that opens the same chips in a popover. The
 * popover opens below, from the button's left edge, so it stays put as the button
 * grows with the picks (owner); it stays open while chips are toggled, and
 * click-away or Esc closes it.
 */
export function FacetDropdown({
  label,
  options,
  selected,
  onChange,
  measureOnly = false,
  coversAll = true,
}: FacetDropdownProps) {
  const t = copy.quantum.list.filter
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const summary = facetSummary(options, selected)
  const picked = options.filter((option) => selected.has(option.key))

  return (
    <div className="q-facet q-facet-drop">
      <span className="q-kicker">{label}</span>
      <Tip
        as="button"
        type="button"
        className="q-facet-summary"
        data-on={picked.length > 0}
        aria-label={t.facetDropdownLabel(label, summary)}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        text={picked.length > 0 ? picked.map((option) => option.name ?? option.label).join(', ') : t.facetPickTip}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        {summary}
        <ChevronDown width={13} height={13} strokeWidth={2} aria-hidden="true" />
      </Tip>
      {!measureOnly && (
        <Popover
          open={anchor !== null}
          anchorEl={anchor}
          onDismiss={() => setAnchor(null)}
          width={360}
          side="below"
        >
          <div className="q-pop-head">
            <span className="q-kicker">{t.facetCount(label, options.length)}</span>
          </div>
          <FacetToggle options={options} selected={selected} onChange={onChange} coversAll={coversAll} />
        </Popover>
      )}
    </div>
  )
}
