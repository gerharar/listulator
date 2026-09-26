import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import type { FacetGroup, FacetKey, FacetSelection } from '../../../../server/src/catalog/facets.js'
import { copy } from '../../locale/index.js'
import { FacetToggle } from '../../components/quantum/FacetToggle/FacetToggle.js'
import { platformFullName } from '../../components/quantum/PlatformChip/PlatformChip.js'

export interface FilterBarProps {
  text: string
  onText: (text: string) => void
  /** The category's facets that this list has values for; empty means the text field only. */
  facets: readonly FacetGroup[]
  selection: FacetSelection
  onSelect: (facet: FacetKey, selected: ReadonlySet<string>) => void
  /** Fold-all, offered when the list has more than one group. `collapse` says which way it will go. */
  fold: { collapse: boolean; onToggle: () => void } | null
  /** "8 items", or "3 of 8 shown" while filtering. */
  note: string
}

/**
 * The bar under the list header (design: "Filter bar"): a text field, one
 * additive facet row per facet the list has values for, fold-all, and a note
 * that says how much of the list is showing. The facets are whatever the
 * category's convention derived; this bar knows no category.
 */
export function FilterBar({ text, onText, facets, selection, onSelect, fold, note }: FilterBarProps) {
  const t = copy.quantum.list.filter

  return (
    <div className="q-filterbar">
      <input
        className="q-filter-input"
        type="text"
        aria-label={t.label}
        placeholder={t.placeholder}
        value={text}
        onChange={(event) => onText(event.target.value)}
      />
      {facets.map((facet) => (
        <FacetToggle
          key={facet.key}
          label={t.facetLabels[facet.label] ?? facet.label}
          options={facet.options.map((option) => ({
            key: option.key,
            label: t.optionLabels[option.label] ?? option.label,
            ...(facet.key === 'platform' && platformFullName(option.label)
              ? { name: platformFullName(option.label)! }
              : {}),
          }))}
          selected={selection[facet.key] ?? new Set()}
          onChange={(selected) => onSelect(facet.key, selected)}
        />
      ))}
      {fold && (
        <button
          type="button"
          className="q-fold"
          title={fold.collapse ? t.collapseAllTip : t.expandAllTip}
          onClick={fold.onToggle}
        >
          {fold.collapse ? (
            <ChevronsDownUp width={13} height={13} strokeWidth={2} aria-hidden="true" />
          ) : (
            <ChevronsUpDown width={13} height={13} strokeWidth={2} aria-hidden="true" />
          )}
          {fold.collapse ? t.collapseAll : t.expandAll}
        </button>
      )}
      <span className={fold ? 'q-filter-note' : 'q-filter-note push'}>{note}</span>
    </div>
  )
}
