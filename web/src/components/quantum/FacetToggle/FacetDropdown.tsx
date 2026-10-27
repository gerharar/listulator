import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { copy } from '../../../locale/index.js'
import { Popover } from '../Popover/Popover.js'
import { FacetToggle, type FacetOption } from './FacetToggle.js'
import { Tip } from '../Tooltip/Tip.js'

/** How many picks the closed dropdown names before it only counts them. */
const NAMED_PICKS = 2

/** The closed dropdown's words (H-023): All, one or two picks by name in the options' order, or "n of total" for three or more. */
export function facetSummary(options: readonly FacetOption[], selected: ReadonlySet<string>): string {
  const t = copy.quantum.list.filter
  const picked = options.filter((option) => selected.has(option.key)).map((option) => option.label)
  if (picked.length === 0) return t.all
  if (picked.length > NAMED_PICKS) return t.facetSome(picked.length, options.length)
  return t.facetPicks(picked)
}

export interface FacetDropdownProps {
  label: string
  options: FacetOption[]
  selected: ReadonlySet<string>
  onChange: (selected: ReadonlySet<string>) => void
  /** As FacetToggle's: false for a flag, whose one option on must still filter. */
  coversAll?: boolean
}

/**
 * Every value facet of the filter bar (H-023; before it, U4's overflow form): its kicker, then one button naming the selection (filled once
 * anything is picked, its accessible name and hint spelling every pick out) that opens the chips in a popover. The button is as wide as its
 * words up to 180px. The popover opens below, from the button's left edge, so it stays put as the button grows with the picks (owner); it stays
 * open while chips are toggled, and click-away or Esc closes it.
 */
export function FacetDropdown({
  label,
  options,
  selected,
  onChange,
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
        aria-label={t.facetDropdownLabel(label, picked.length > 0 ? t.facetPicks(picked.map((option) => option.label)) : t.all)}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        text={picked.length > 0 ? picked.map((option) => option.name ?? option.label).join(', ') : t.facetPickTip}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <span className="q-facet-summary-text">{summary}</span>
        <ChevronDown width={13} height={13} strokeWidth={2} aria-hidden="true" />
      </Tip>
      <Popover open={anchor !== null} anchorEl={anchor} onDismiss={() => setAnchor(null)} width={360} side="below">
        <div className="q-pop-head">
          <span className="q-kicker">{t.facetCount(label, options.length)}</span>
        </div>
        <FacetToggle options={options} selected={selected} onChange={onChange} coversAll={coversAll} />
      </Popover>
    </div>
  )
}
