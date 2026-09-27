import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { UNTAGGED, type FacetGroup, type FacetKey, type FacetSelection } from '../../../../server/src/catalog/facets.js'
import { compareShown, copy } from '../../locale/index.js'
import { FacetToggle, type FacetOption } from '../../components/quantum/FacetToggle/FacetToggle.js'
import { FacetDropdown, facetsToCompact } from '../../components/quantum/FacetToggle/FacetDropdown.js'
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
 * Its options as the facet components take them: labels translated, platforms
 * named in full, and A–Z by the name shown, Untagged last, unless the facet
 * keeps its own order (owner, 2026-09-27: Music's Album, Mini, Compilation).
 */
function facetOptions(facet: FacetGroup): FacetOption[] {
  const t = copy.quantum.list.filter
  const options = facet.options.map((option) => ({
    key: option.key,
    label: t.optionLabels[option.label] ?? option.label,
    ...(facet.flag ? { mark: true } : {}),
    ...(facet.key === 'platform' && platformFullName(option.label)
      ? { name: platformFullName(option.label)! }
      : {}),
  }))
  if (facet.keepOrder) return options
  const last = (option: FacetOption) => (option.key === UNTAGGED ? 1 : 0)
  return options.sort((a, b) => last(a) - last(b) || compareShown(a.label, b.label))
}

/**
 * The bar under the list header (design: "Filter bar"): a text field, one
 * additive facet row per facet the list has values for, fold-all, and a note
 * that says how much of the list is showing. The facets are whatever the
 * category's convention derived; this bar knows no category.
 *
 * One row (U4, owner 2026-09-27): a facet whose chips would push the row onto
 * a second line becomes a dropdown (FacetDropdown), the one that saves most
 * first; widen the window and the chips come back. A hidden copy of each facet
 * in both forms is measured against the bar on every resize.
 */
export function FilterBar({ text, onText, facets, selection, onSelect, fold, note }: FilterBarProps) {
  const t = copy.quantum.list.filter
  const barRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState<ReadonlySet<string>>(new Set())

  useLayoutEffect(() => {
    const bar = barRef.current
    const ghost = ghostRef.current
    // No layout to measure (jsdom): every facet stays inline.
    if (!bar || !ghost || typeof ResizeObserver === 'undefined') return

    const measure = () => {
      const style = getComputedStyle(bar)
      const available = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const fixed = [...bar.querySelectorAll<HTMLElement>('[data-bar-fixed]')].map((part) => part.offsetWidth)
      const widths = facets.map((facet) => ({
        key: facet.key,
        inline: ghost.querySelector<HTMLElement>(`[data-inline="${facet.key}"]`)?.offsetWidth ?? 0,
        compact: ghost.querySelector<HTMLElement>(`[data-compact="${facet.key}"]`)?.offsetWidth ?? 0,
      }))
      const next = facetsToCompact(available, fixed, parseFloat(style.columnGap) || 0, widths)
      setCompact((current) =>
        current.size === next.size && [...next].every((key) => current.has(key)) ? current : next,
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [facets, selection, fold, note])

  const facetProps = (facet: FacetGroup) => ({
    label: t.facetLabels[facet.label] ?? facet.label,
    options: facetOptions(facet),
    selected: selection[facet.key] ?? new Set<string>(),
    onChange: (selected: ReadonlySet<string>) => onSelect(facet.key, selected),
    coversAll: !facet.flag,
  })

  return (
    <div className="q-filterbar" ref={barRef}>
      <input
        className="q-filter-input"
        data-bar-fixed=""
        type="text"
        aria-label={t.label}
        placeholder={t.placeholder}
        value={text}
        onChange={(event) => onText(event.target.value)}
      />
      {facets.map((facet) =>
        compact.has(facet.key) ? (
          <FacetDropdown key={facet.key} {...facetProps(facet)} />
        ) : (
          <FacetToggle key={facet.key} {...facetProps(facet)} />
        ),
      )}
      {fold && (
        <button
          type="button"
          className="q-fold"
          data-bar-fixed=""
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
      <span className={fold ? 'q-filter-note' : 'q-filter-note push'} data-bar-fixed="">
        {note}
      </span>

      {/* Both forms of every facet at their natural width, for measuring only;
          only where there is layout to measure (not jsdom). */}
      {facets.length > 0 && typeof ResizeObserver !== 'undefined' && (
        <div className="q-filterbar-ghost" ref={ghostRef} aria-hidden="true" inert>
          {facets.map((facet) => (
            <div key={facet.key} className="q-filterbar-ghost-pair">
              <div data-inline={facet.key}>
                <FacetToggle {...facetProps(facet)} />
              </div>
              <div data-compact={facet.key}>
                <FacetDropdown {...facetProps(facet)} measureOnly />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
