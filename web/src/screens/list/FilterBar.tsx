import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, EyeOff } from 'lucide-react'
import { UNTAGGED, type FacetGroup, type FacetKey, type FacetSelection } from '../../../../server/src/catalog/facets.js'
import { compareShown, copy } from '../../locale/index.js'
import { FacetToggle, type FacetOption } from '../../components/quantum/FacetToggle/FacetToggle.js'
import { FacetDropdown, facetsToCompact } from '../../components/quantum/FacetToggle/FacetDropdown.js'
import { platformFullName } from '../../components/quantum/PlatformChip/PlatformChip.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'

export interface FilterBarProps {
  text: string
  onText: (text: string) => void
  /** The category's facets that this list has values for; empty means the text field only. */
  facets: readonly FacetGroup[]
  selection: FacetSelection
  onSelect: (facet: FacetKey, selected: ReadonlySet<string>) => void
  /** Fold-all, offered when the list has more than one group. `collapse` says which way it will go. */
  fold: { collapse: boolean; onToggle: () => void } | null
  /** Hide Completed (task 18.1): pressed while done items are hidden. */
  hideDone: { on: boolean; onToggle: () => void } | null
  /** "8 items", or "3 of 8 shown" while filtering. */
  note: string
}

/**
 * Platform is always a dropdown (owner, 2026-10-05): a games list is likely to have many platforms, and chips that
 * fold into a dropdown only when the row runs short made the bar change shape as a filter came on.
 */
function alwaysDropdown(facet: FacetGroup): boolean {
  return facet.key === 'platform'
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
 * additive facet row per facet the list has values for, then at the right
 * edge a note, Hide Completed and fold-all
 * (the note says how much of the list is showing). The facets are whatever the
 * category's convention derived; this bar knows no category.
 *
 * One row (U4, owner 2026-09-27): a facet whose chips would push the row onto
 * a second line becomes a dropdown (FacetDropdown), the one that saves most
 * first; widen the window and the chips come back. A hidden copy of each facet
 * in both forms is measured against the bar on every resize.
 */
export function FilterBar({ text, onText, facets, selection, onSelect, fold, hideDone, note }: FilterBarProps) {
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
      const widths = facets.map((facet) => {
        const compact = ghost.querySelector<HTMLElement>(`[data-compact="${facet.key}"]`)?.offsetWidth ?? 0
        const inline = ghost.querySelector<HTMLElement>(`[data-inline="${facet.key}"]`)?.offsetWidth ?? 0
        // A facet that is always a dropdown takes the dropdown's width whatever the row has room for.
        return { key: facet.key, inline: alwaysDropdown(facet) ? compact : inline, compact }
      })
      const next = facetsToCompact(available, fixed, parseFloat(style.columnGap) || 0, widths)
      setCompact((current) =>
        current.size === next.size && [...next].every((key) => current.has(key)) ? current : next,
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [facets, selection, fold, hideDone, note])

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
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={t.label}
        placeholder={t.placeholder}
        value={text}
        onChange={(event) => onText(event.target.value)}
      />
      {facets.map((facet) =>
        compact.has(facet.key) || alwaysDropdown(facet) ? (
          <FacetDropdown key={facet.key} {...facetProps(facet)} />
        ) : (
          <FacetToggle key={facet.key} {...facetProps(facet)} />
        ),
      )}
      {/* Before the buttons, which keep to the right edge: a count that changes length moves nothing (owner, 2026-10-05). */}
      <span className="q-filter-note" data-bar-fixed="">
        {note}
      </span>
      {hideDone && (
        <Tip
          as="button"
          type="button"
          className="q-hide-done"
          data-bar-fixed=""
          aria-pressed={hideDone.on}
          text={hideDone.on ? t.hideDoneTip : undefined}
          describe
          onClick={hideDone.onToggle}
        >
          <EyeOff width={13} height={13} strokeWidth={2} aria-hidden="true" />
          {t.hideDone}
        </Tip>
      )}
      {fold && (
        <Tip
          as="button"
          type="button"
          className="q-fold"
          data-bar-fixed=""
          text={fold.collapse ? t.collapseAllTip : t.expandAllTip}
          describe
          onClick={fold.onToggle}
        >
          {fold.collapse ? (
            <ChevronsDownUp width={13} height={13} strokeWidth={2} aria-hidden="true" />
          ) : (
            <ChevronsUpDown width={13} height={13} strokeWidth={2} aria-hidden="true" />
          )}
          {/* As wide as the longer word, so Collapse turning into Expand moves nothing beside it. */}
          <span className="q-steady" data-room={fold.collapse ? t.expandAll : t.collapseAll}>
            <span>{fold.collapse ? t.collapseAll : t.expandAll}</span>
          </span>
        </Tip>
      )}

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
