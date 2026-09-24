import './SearchResultRow.css'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { copy } from '../../../locale/index.js'
import type { ExpansionState } from '../SearchTab/useSourceExpansions.js'
import { Button } from '../Button/Button.js'
import { CuratedStar } from '../Marks/Marks.js'
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
}: SearchResultRowProps) {
  const text = copy.quantum.search
  const shownStatus = status ?? (expansion?.state === 'done' ? expansion.status : undefined)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle()
    }
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
        <span className="chev" aria-hidden="true">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="main">
          <span className="line1">
            {curated && (
              <span title={text.curatedTitle}>
                <CuratedStar />
              </span>
            )}
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
        <div className="q-result-more">
          {description && <div className="desc">{description}</div>}
          <div className="prov">{provenance}</div>
          {!previewable && <div className="unavailable">{text.previewUnavailable}</div>}
          <div className="actions">
            {/* Preview needs the Preview layer (task 10.15); until then it is disabled either way. */}
            <Button size="sm" disabled title={previewable ? text.previewComingSoon : undefined}>
              {text.previewButton}
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={onAdd}>
              {text.addButton}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
