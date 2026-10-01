import './SearchResultRow.css'
import type { KeyboardEvent, MouseEvent } from 'react'
import { copy } from '../../../locale/index.js'
import type { ExpansionState } from '../SearchTab/useSourceExpansions.js'
import { Button } from '../Button/Button.js'
import { CuratedStar } from '../Marks/Marks.js'
import { shouldFoldFromDetails } from './foldFromDetails.js'
import { Spinner } from '../Spinner/Spinner.js'
import { StatusChip } from '../StatusChip/StatusChip.js'

export interface SearchResultRowProps {
  title: string
  /** The 13px `ink2` line: what disambiguates near-identical results. */
  meta?: string | undefined
  /** A community-library list: gets the ★. */
  curated: boolean
  /** The result's own status (a curated file's), which wins over the expansion's. */
  status?: 'complete' | 'ongoing' | undefined
  /** The per-result count/status, loaded after the row rendered (Q11). */
  expansion?: ExpansionState | undefined
  expanded: boolean
  onToggle: () => void
  description?: string | undefined
  provenance: string
  /** False for a source that can't list its items before import. */
  previewable: boolean
  /** An import is running: everything locks (Q12). */
  busy: boolean
  onAdd: () => void
  /** Opens the Preview layer (task 10.15). */
  onPreview: () => void
}

/**
 * One candidate list from a source search (design-system/components/
 * SearchResultRow). Collapsed it is a scannable title with its meta line and
 * count; expanded it shows the description, provenance, and the button pair.
 * Buttons act and the row states — there is no bare `→`.
 */
export function SearchResultRow({
  title,
  meta,
  curated,
  status,
  expansion,
  expanded,
  onToggle,
  description,
  provenance,
  previewable,
  busy,
  onAdd,
  onPreview,
}: SearchResultRowProps) {
  const text = copy.quantum.search
  // A count of zero is a guaranteed "nothing to import" from the server; say so up front.
  const isEmpty = expansion?.state === 'done' && expansion.itemCount === 0
  const shownStatus = status ?? (expansion?.state === 'done' ? expansion.status : undefined)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle()
    }
  }

  // Open, the details are one block with the row (one tint), so a click in it folds the row like a click on the title
  // does (see `shouldFoldFromDetails`). The row above stays the keyboard way to fold.
  function onDetailsClick(event: MouseEvent<HTMLDivElement>) {
    if (shouldFoldFromDetails(event)) onToggle()
  }

  return (
    <>
      <div
        className="q-result"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={text.expandRow(title)}
        onClick={onToggle}
        onKeyDown={onKeyDown}
      >
        {/* The design's filled triangles (▼ open, ▶ folded); a 12px Lucide chevron drew a thin 6 x 3 px mark. */}
        <span className="chev" aria-hidden="true">
          {expanded ? '▼' : '▶'}
        </span>
        <span className="main">
          <span className="line1">
            {curated && <CuratedStar />}
            <span className="title">{title}</span>
            <StatusChip status={shownStatus ?? null} short />
          </span>
          {meta && <span className="meta">{meta}</span>}
        </span>
        <span className="n">
          {expansion?.state === 'loading' && <Spinner label={text.countLoading} />}
          {expansion?.state === 'done' && (
            <>
              {expansion.itemCount}
              <span className="q-kicker">{text.itemsKicker}</span>
            </>
          )}
        </span>
      </div>

      {expanded && (
        <div className="q-result-more" onClick={onDetailsClick}>
          {description && <div className="desc">{description}</div>}
          <div className="prov">{provenance}</div>
          {!previewable && <div className="unavailable">{text.previewUnavailable}</div>}
          <div className="actions">
            <Button size="sm" disabled={!previewable || busy} onClick={onPreview}>
              {text.previewButton}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || isEmpty}
              title={isEmpty ? text.nothingToAdd : undefined}
              onClick={onAdd}
            >
              {text.addButton}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
