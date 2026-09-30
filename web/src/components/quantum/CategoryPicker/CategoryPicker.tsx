import { Tip } from '../Tooltip/Tip.js'
import './CategoryPicker.css'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api, type MediaType } from '../../../lib/api.js'
import { categoryLabel, copy, sortCategories, sourceLabel } from '../../../locale/index.js'
import { CategoryArt } from '../art/CategoryArt.js'
import { IconButton } from '../Button/Button.js'
import { HeaderPlate } from '../HeaderPlate/HeaderPlate.js'
import { useLayerStack } from '../layerStack/LayerStackContext.js'

export interface CategoryPickerProps {
  /** The live registry, lifted up from Home (task 10.10) — the tile grid is exactly this, A–Z by the name shown. */
  mediaTypes: readonly MediaType[]
  /** True when the picker is the base layer (nothing tracked yet): no close button, no counts, first-run headline. */
  first: boolean
}

/**
 * Pick a Category (design-system/components/CategoryTile, task 10.11).
 * Driven entirely by the registry: a category added there renders a tile
 * with the fallback art and its registry label, with no code change. The
 * footer is the registry's real source name — "by hand" only when the
 * registry has no search source — never the design handoff's own table,
 * which is stale where they disagree (Wrestling and MMA read Wikipedia).
 */
export function CategoryPicker({ mediaTypes, first }: CategoryPickerProps) {
  const layerStack = useLayerStack()
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map())

  // Nothing exists on first run, so there is nothing to count or fetch. A
  // failure elsewhere degrades to no counts rather than blocking the picker:
  // the tiles are the point, the chips are a nicety.
  useEffect(() => {
    if (first) return
    let cancelled = false

    api
      .lists()
      .then((lists) => {
        if (cancelled) return
        const next = new Map<string, number>()
        for (const list of lists) next.set(list.mediaType, (next.get(list.mediaType) ?? 0) + 1)
        setCounts(next)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [first])

  const ordered = sortCategories(mediaTypes)
  const text = copy.quantum.categoryPicker

  return (
    <div className="q-picker">
      <div className="q-picker-head">
        <HeaderPlate side="left" seed={2} />
        <div className="q-picker-titles">
          <h1 className="q-picker-title">{first ? text.firstRunTitle : text.title}</h1>
          <p className="q-picker-sub">{first ? text.firstRunSubline : text.subline}</p>
        </div>
        {!first && (
          <IconButton label={text.closeLabel} onClick={() => layerStack.pop()}>
            <X width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
          </IconButton>
        )}
      </div>

      <div className="q-picker-body">
        <div className="q-tiles">
          {ordered.map((mediaType) => {
            const count = counts.get(mediaType.key) ?? 0

            return (
              <button
                key={mediaType.key}
                type="button"
                className={count > 0 ? 'q-tile used' : 'q-tile'}
                onClick={() =>
                  layerStack.push({
                    id: 'new-list',
                    kind: 'new-list',
                    tabLabel: () => copy.newList.title,
                    // The Create layer (task 10.12) reads the chosen category
                    // from its own path's query string.
                    content: `/lists/new?mediaType=${encodeURIComponent(mediaType.key)}`,
                  })
                }
              >
                <CategoryArt registryKey={mediaType.key} />
                <span className="q-tile-name">
                  <b>{categoryLabel(mediaType)}</b>
                  {count > 0 && (
                    <Tip className="q-count-chip" text={text.countTitle}>
                      {count}
                    </Tip>
                  )}
                </span>
                <span className="q-tile-src">{sourceLabel(mediaType) ?? text.byHand}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
