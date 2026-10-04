import { Button } from '../Button/Button.js'
import { copy } from '../../../locale/index.js'
import './SearchResultsStop.css'

export interface SearchResultsStopProps {
  /** How many rows are on screen: the caption names them ("End of first 40"). */
  shown: number
  /** The next rows are on their way: Show more says so and is locked. */
  loadingMore: boolean
  /** The tab is busy with an import: nothing here can be used, as nothing else in the tab can. */
  locked?: boolean
  onRefine: () => void
  onShowMore: () => void
}

/**
 * The end of a cut-off result list (design `docs/design/search-show-more`, option 5A): a status of the list, not an
 * item, so it never looks like a row (no chevron, no count, no hover). A rule in the strong ink closes the list, a
 * mono caption names how much is shown, the note says what to do, and two outline buttons act on it: Refine search
 * (focus the query) and Show more (the next page, appended).
 */
export function SearchResultsStop({ shown, loadingMore, locked = false, onRefine, onShowMore }: SearchResultsStopProps) {
  const text = copy.quantum.search.more

  return (
    <div className="q-search-stop">
      <span className="q-search-stop-caption">{text.caption(shown)}</span>
      <p className="q-search-stop-note">{text.note}</p>
      <div className="q-search-stop-actions">
        <Button onClick={onRefine} disabled={locked}>
          {text.refine}
        </Button>
        <Button onClick={onShowMore} disabled={locked} busy={loadingMore} busyLabel={text.loading}>
          {text.showMore}
        </Button>
      </div>
    </div>
  )
}
