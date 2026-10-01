import './CrossHintRow.css'
import '../SearchResultRow/SearchResultRow.css'
import type { KeyboardEvent, MouseEvent } from 'react'
import { Layers } from 'lucide-react'
import { copy } from '../../../locale/index.js'
import { Button } from '../Button/Button.js'
import { shouldFoldFromDetails } from '../SearchResultRow/foldFromDetails.js'
import type { CrossHintList } from './crossHint.js'

/** How many of the lists the open row names before the rest are one click away. */
const SHOWN = 2

export interface CrossHintRowProps {
  /** Every list the library-scope category has for this search. */
  lists: readonly CrossHintList[]
  /** The library-scope category's name as the app shows it ("Mega"). */
  categoryLabel: string
  expanded: boolean
  onToggle: () => void
  /** Open that list over there, or (`null`) just the search, with no list open. */
  onOpen: (list: CrossHintList | null) => void
}

/**
 * The best-bet row above a search's results (design `search-mega-promo`, option 3A): a fuller list for this search
 * lives in another category. It is built from the result row, with no star, tint, accent or dismiss, and opens in
 * place to name the lists; only Open leaves the category, never the row itself, and never to add: adding happens
 * over there.
 */
export function CrossHintRow({ lists, categoryLabel, expanded, onToggle, onOpen }: CrossHintRowProps) {
  const text = copy.quantum.search
  const hint = text.megaHint
  const title = hint.title({ count: lists.length, category: categoryLabel })

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle()
    }
  }

  function onDetailsClick(event: MouseEvent<HTMLDivElement>) {
    if (shouldFoldFromDetails(event)) onToggle()
  }

  return (
    <>
      <div
        className="q-result q-hint"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={text.expandRow(title)}
        onClick={onToggle}
        onKeyDown={onKeyDown}
      >
        <span className="chev" aria-hidden="true">
          {expanded ? '▼' : '▶'}
        </span>
        <span className="main">
          <span className="line1">
            <Layers className="q-hint-icon" size={14} strokeWidth={2} aria-hidden="true" />
            <span className="title">{title}</span>
          </span>
          <span className="meta">{hint.subline}</span>
        </span>
        <span className="n">
          {lists.length}
          <span className="q-kicker">{hint.unit(lists.length)}</span>
        </span>
      </div>

      {expanded && (
        <div className="q-result-more q-hint-more" onClick={onDetailsClick}>
          {lists.slice(0, SHOWN).map((list) => {
            const meta = [list.description, list.itemCount !== undefined ? hint.items(list.itemCount) : undefined]
              .filter(Boolean)
              .join(' · ')

            return (
              <div key={list.externalRef} className="q-hint-list">
                <div className="info">
                  <div className="title">{list.title}</div>
                  {meta && <div className="sub">{meta}</div>}
                </div>
                <Button size="sm" aria-label={hint.openList(list.title)} onClick={() => onOpen(list)}>
                  {hint.open}
                </Button>
              </div>
            )
          })}
          {lists.length > SHOWN && (
            <div className="q-hint-all">
              <Button variant="quiet" size="sm" onClick={() => onOpen(null)}>
                {hint.seeAll({ n: lists.length, category: categoryLabel })}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
