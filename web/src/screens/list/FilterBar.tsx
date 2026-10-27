import { useRef } from 'react'
import { ChevronsDownUp, ChevronsUpDown, EyeOff, X } from 'lucide-react'
import { REST, UNTAGGED, type FacetGroup, type FacetKey, type FacetSelection } from '../../../../server/src/catalog/facets.js'
import { compareShown, copy } from '../../locale/index.js'
import type { FacetOption } from '../../components/quantum/FacetToggle/FacetToggle.js'
import { FacetDropdown } from '../../components/quantum/FacetToggle/FacetDropdown.js'
import { platformFullName } from '../../components/quantum/PlatformChip/PlatformChip.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'
import { EndsButton, type EndsButtonProps } from './EndsButton.js'

export interface FilterBarProps {
  text: string
  onText: (text: string) => void
  /** The ✕ in the field (H-008): clear the text, announce it. The cursor is put back in the field here. */
  onClear: () => void
  /** The category's facets that this list has values for; empty means the text field only. */
  facets: readonly FacetGroup[]
  selection: FacetSelection
  onSelect: (facet: FacetKey, selected: ReadonlySet<string>) => void
  /** Fold-all, offered when the list has more than one group. `collapse` says which way it will go. */
  fold: { collapse: boolean; onToggle: () => void } | null
  /** Hide Completed (task 18.1): pressed while done items are hidden. */
  hideDone: { on: boolean; onToggle: () => void } | null
  /** The split Up / Down button after the last button, for a list taller than two screens (H-019). */
  ends: EndsButtonProps | null
  /** "8 items", or "3 of 8 shown" while filtering. */
  note: string
  /** The longest form the note takes for this list ("598 of 598 shown"): the note's slot is as many characters wide, so it moves nothing (H-019). */
  noteRoom: string
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
    ...(facet.flag && !option.rest ? { mark: true } : {}),
    ...(facet.key === 'platform' && platformFullName(option.label)
      ? { name: platformFullName(option.label)! }
      : {}),
  }))
  if (facet.keepOrder) return options
  const last = (option: FacetOption) => (option.key === UNTAGGED || option.key === REST ? 1 : 0)
  return options.sort((a, b) => last(a) - last(b) || compareShown(a.label, b.label))
}

/**
 * The bar under the list header (design: "Filter bar"): a text field, one
 * dropdown per facet the list has values for (H-023: never chips, on any
 * width, so a list's content or the window moves nothing), then at the right
 * edge a note, Hide Completed, fold-all and the split Up / Down button
 * (the note says how much of the list is showing). The facets are whatever the
 * category's convention derived; this bar knows no category.
 */
export function FilterBar({ text, onText, onClear, facets, selection, onSelect, fold, hideDone, ends, note, noteRoom }: FilterBarProps) {
  const t = copy.quantum.list.filter
  const inputRef = useRef<HTMLInputElement>(null)

  const facetProps = (facet: FacetGroup) => ({
    label: t.facetLabels[facet.label] ?? facet.label,
    options: facetOptions(facet),
    selected: selection[facet.key] ?? new Set<string>(),
    onChange: (selected: ReadonlySet<string>) => onSelect(facet.key, selected),
    coversAll: !facet.flag || facet.covers === true,
  })

  return (
    <div className="q-filterbar">
      {/* The room for the ✕ is the input's own right padding, so the text never shifts when it appears (H-008). */}
      <span className="q-filter-field">
        <input
          ref={inputRef}
          className="q-filter-input"
          type="text"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          aria-label={t.label}
          placeholder={t.placeholder}
          value={text}
          onChange={(event) => onText(event.target.value)}
        />
        {text !== '' && (
          <Tip
            as="button"
            type="button"
            className="q-filter-clear"
            aria-label={t.clearText}
            text={t.clearText}
            // A press must not take the cursor off the field: the button goes as the text does.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onClear()
              inputRef.current?.focus()
            }}
          >
            <X width={14} height={14} strokeWidth={2} aria-hidden="true" />
          </Tip>
        )}
      </span>
      {facets.map((facet) => (
        <FacetDropdown key={facet.key} {...facetProps(facet)} />
      ))}
      {/* Before the buttons, which keep to the right edge: a count that changes length moves nothing (owner, 2026-10-05). */}
      <span className="q-filter-note" style={{ minWidth: `${noteRoom.length}ch` }}>
        {note}
      </span>
      {hideDone && (
        <Tip
          as="button"
          type="button"
          className="q-hide-done"
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
      {ends && <EndsButton {...ends} />}

    </div>
  )
}
